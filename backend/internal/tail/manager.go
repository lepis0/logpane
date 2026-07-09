package tail

import (
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"

	"github.com/lepis0/logpane/backend/internal/config"
	"github.com/lepis0/logpane/backend/internal/logsource"
)

// sweepInterval governs how often the Manager retries resolving sources
// that currently have no active tailer (e.g. a configured file that
// doesn't exist yet, or a glob with zero matches), so they start being
// tailed automatically once they become resolvable — without needing a
// config change to trigger reconciliation.
const sweepInterval = 5 * time.Second

// globWatchDebounce coalesces bursts of fsnotify events (many editors and
// log writers emit several per meaningful change) before re-checking a
// glob source for a newer active file.
const globWatchDebounce = 250 * time.Millisecond

var (
	// ErrRollNotAllowed is returned by Roll when the source's AllowRoll
	// flag is false. The API layer maps this to 404 (the roll action
	// doesn't exist for this source).
	ErrRollNotAllowed = errors.New("tail: roll is not allowed for this source")
	// ErrRollPermissionDenied is returned by Roll when a write-permission
	// probe or the truncate itself fails (e.g. a read-only bind mount).
	// The API layer maps this to 409.
	ErrRollPermissionDenied = errors.New("tail: insufficient permission to roll this file")
	// ErrNoActiveFile is returned when an operation needs a resolved,
	// readable active file but none is currently available.
	ErrNoActiveFile = errors.New("tail: source has no currently readable active file")
)

// SourceStatus is the current runtime state of one configured source, as
// observed by the Manager — this is what the REST API embeds as `status`
// in a source's JSON representation.
type SourceStatus struct {
	ActiveFile       string
	MatchedFileCount int
	Size             int64
	ModTime          time.Time
	Readable         bool
	LastError        string
}

// SourceEventType enumerates the discrete, non-line-data events the
// Manager can report about a source.
type SourceEventType string

const (
	SourceEventRotated   SourceEventType = "rotated"
	SourceEventTruncated SourceEventType = "truncated"
	SourceEventError     SourceEventType = "sourceError"
)

// SourceEvent is a discrete lifecycle event for one source, destined for
// that source's WS subscribers.
type SourceEvent struct {
	SourceID string
	Type     SourceEventType
	File     string
	Message  string
}

// LineListener receives every new line tailed for one source. Registered
// per source id via OnLine — internal/ws.Hub uses this to fan new lines
// out to exactly the WS connections currently subscribed to that source.
type LineListener func(entry Entry)

// EventListener receives every SourceEvent, for every source. It's the
// caller's job (internal/ws.Hub) to filter by SourceID before deciding
// which connections to notify.
type EventListener func(SourceEvent)

// sourceState is the Manager's live bookkeeping for one enabled source.
// Disabled/unconfigured sources have no sourceState at all.
type sourceState struct {
	cfg config.Source

	tailer     *Tailer
	activeFile string

	matched   int
	size      int64
	modTime   time.Time
	readable  bool
	lastError string

	globWatcher *fsnotify.Watcher
	globStop    chan struct{}
	globDone    chan struct{}
}

// Manager owns the lifecycle of one Tailer per currently-resolvable
// enabled source (keyed by source id) and republishes their line/event
// streams to registered listeners. It tails all enabled sources
// unconditionally, independent of whether any WS client has a subscription
// open, so sidebar stats (size, mtime, active file) stay accurate with no
// pane open at all.
type Manager struct {
	logger *slog.Logger

	mu              sync.RWMutex
	sources         map[string]*sourceState
	defaultBackfill int

	lineListenersMu sync.Mutex
	lineListeners   map[string][]lineListenerEntry
	nextListenerID  int64

	eventListenersMu sync.RWMutex
	eventListeners   []EventListener

	sweepStop chan struct{}
	sweepDone chan struct{}
}

type lineListenerEntry struct {
	id int64
	fn LineListener
}

// NewManager builds a Manager and immediately starts tailing every enabled
// source in initial. Wire it to hot-reloads via
// configStore.Subscribe(mgr.OnConfigChanged).
func NewManager(initial config.Config, logger *slog.Logger) *Manager {
	if logger == nil {
		logger = slog.Default()
	}
	m := &Manager{
		logger:          logger,
		sources:         make(map[string]*sourceState),
		lineListeners:   make(map[string][]lineListenerEntry),
		defaultBackfill: initial.Settings.MaxInitialLines,
		sweepStop:       make(chan struct{}),
		sweepDone:       make(chan struct{}),
	}

	m.mu.Lock()
	for _, src := range initial.Sources {
		if src.Enabled {
			m.startSourceLocked(src)
		}
	}
	m.mu.Unlock()

	go m.sweepLoop()
	return m
}

// Close stops every tailer, glob watch, and the background sweep — no
// goroutine leaks.
func (m *Manager) Close() {
	close(m.sweepStop)
	<-m.sweepDone

	m.mu.Lock()
	all := make([]*sourceState, 0, len(m.sources))
	for id, st := range m.sources {
		all = append(all, st)
		delete(m.sources, id)
	}
	m.mu.Unlock()

	for _, st := range all {
		m.teardown(st)
	}
}

// OnConfigChanged reconciles the Manager's running tailers against a new
// config snapshot: starts tailers for added/now-enabled sources, stops
// them for removed/now-disabled sources, and restarts them when a
// source's path/type/excludePatterns changed. Pass this as the callback to
// config.Store.Subscribe.
func (m *Manager) OnConfigChanged(cfg config.Config) {
	m.mu.Lock()
	m.defaultBackfill = cfg.Settings.MaxInitialLines

	newByID := make(map[string]config.Source, len(cfg.Sources))
	for _, s := range cfg.Sources {
		newByID[s.ID] = s
	}

	var toTeardown []*sourceState

	for id, st := range m.sources {
		newSrc, stillExists := newByID[id]
		if !stillExists || !newSrc.Enabled {
			delete(m.sources, id)
			toTeardown = append(toTeardown, st)
		}
	}

	for _, newSrc := range cfg.Sources {
		if !newSrc.Enabled {
			continue
		}
		existing, exists := m.sources[newSrc.ID]
		if !exists {
			m.startSourceLocked(newSrc)
			continue
		}
		if existing.cfg.Path != newSrc.Path ||
			existing.cfg.Type != newSrc.Type ||
			!equalStrSlices(existing.cfg.ExcludePatterns, newSrc.ExcludePatterns) {
			delete(m.sources, newSrc.ID)
			toTeardown = append(toTeardown, existing)
			m.startSourceLocked(newSrc)
		} else {
			// Cosmetic-only change (name/color/tags/allowRoll): just
			// refresh the stored config, no tailer disruption needed.
			existing.cfg = newSrc
		}
	}
	m.mu.Unlock()

	// Tear down everything that needs stopping OUTSIDE the lock: Stop()
	// blocks on goroutine shutdown, and the line/event dispatch paths those
	// goroutines may currently be blocked inside re-acquire m.mu — holding
	// the lock here while waiting for them would deadlock.
	for _, st := range toTeardown {
		m.teardown(st)
	}
}

// Status returns the current runtime status for src. If src isn't
// currently tracked (e.g. it's disabled, so nothing is tailing it), status
// is computed fresh on the spot via logsource.Resolve rather than reported
// as an error — a disabled or newly-added source should still show
// sensible file/size/readable info in the UI.
func (m *Manager) Status(src config.Source) SourceStatus {
	m.mu.RLock()
	st, ok := m.sources[src.ID]
	if ok {
		status := SourceStatus{
			ActiveFile:       st.activeFile,
			MatchedFileCount: st.matched,
			Size:             st.size,
			ModTime:          st.modTime,
			Readable:         st.readable,
			LastError:        st.lastError,
		}
		m.mu.RUnlock()
		return status
	}
	m.mu.RUnlock()

	res := logsource.Resolve(src)
	return resolutionToStatus(res)
}

// Backfill delegates to reader.ReadLastLines against src's current active
// file (falling back to a fresh resolution if src isn't currently tracked,
// e.g. it's disabled).
func (m *Manager) Backfill(src config.Source, n int, beforeOffset int64) (ReadResult, error) {
	activeFile, err := m.resolveActiveFile(src)
	if err != nil {
		return ReadResult{}, err
	}
	return ReadLastLines(activeFile, n, beforeOffset)
}

// DefaultBackfillLines returns the configured default line count for an
// initial backfill (settings.maxInitialLines).
func (m *Manager) DefaultBackfillLines() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.defaultBackfill
}

// Roll truncates src's active file to zero length (logrotate-style
// copytruncate), which requires no coordination with whatever process is
// still writing to it. It rejects outright (no probe at all) if
// src.AllowRoll is false, and otherwise probes for real write permission
// before truncating, so a read-only mount produces a clear, distinct error
// rather than a confusing partial failure.
func (m *Manager) Roll(src config.Source) error {
	if !src.AllowRoll {
		return ErrRollNotAllowed
	}

	activeFile, err := m.resolveActiveFile(src)
	if err != nil {
		return err
	}

	probe, err := os.OpenFile(activeFile, os.O_WRONLY, 0)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrRollPermissionDenied, err)
	}
	_ = probe.Close()

	if err := os.Truncate(activeFile, 0); err != nil {
		return fmt.Errorf("%w: %v", ErrRollPermissionDenied, err)
	}

	m.refreshLiveStats(src.ID)
	return nil
}

// OnLine registers fn to be called for every new line tailed for
// sourceID, from now until the returned unsubscribe func is called.
func (m *Manager) OnLine(sourceID string, fn LineListener) (unsubscribe func()) {
	m.lineListenersMu.Lock()
	id := m.nextListenerID
	m.nextListenerID++
	m.lineListeners[sourceID] = append(m.lineListeners[sourceID], lineListenerEntry{id: id, fn: fn})
	m.lineListenersMu.Unlock()

	return func() {
		m.lineListenersMu.Lock()
		defer m.lineListenersMu.Unlock()
		list := m.lineListeners[sourceID]
		for i, e := range list {
			if e.id == id {
				m.lineListeners[sourceID] = append(list[:i:i], list[i+1:]...)
				return
			}
		}
	}
}

// OnEvent registers fn to be called for every SourceEvent, across all
// sources; the caller filters by SourceEvent.SourceID as needed.
func (m *Manager) OnEvent(fn EventListener) (unsubscribe func()) {
	m.eventListenersMu.Lock()
	m.eventListeners = append(m.eventListeners, fn)
	idx := len(m.eventListeners) - 1
	m.eventListenersMu.Unlock()

	return func() {
		m.eventListenersMu.Lock()
		defer m.eventListenersMu.Unlock()
		if idx < len(m.eventListeners) {
			m.eventListeners[idx] = nil
		}
	}
}

// resolveActiveFile returns src's currently readable active file, either
// from live tracked state or a fresh resolution.
func (m *Manager) resolveActiveFile(src config.Source) (string, error) {
	m.mu.RLock()
	st, ok := m.sources[src.ID]
	if ok && st.activeFile != "" && st.readable {
		activeFile := st.activeFile
		m.mu.RUnlock()
		return activeFile, nil
	}
	m.mu.RUnlock()

	res := logsource.Resolve(src)
	if !res.Readable {
		return "", fmt.Errorf("%w: %s", ErrNoActiveFile, res.LastError)
	}
	return res.ActiveFile, nil
}

// --- internal wiring ---------------------------------------------------

// startSourceLocked resolves src, records its state, and starts a tailer
// (and, for glob sources, a directory watch) if it's currently readable.
// Callers must hold m.mu.
func (m *Manager) startSourceLocked(src config.Source) {
	st := &sourceState{cfg: src}
	m.sources[src.ID] = st

	res := logsource.Resolve(src)
	m.applyResolutionLocked(st, res)

	if res.Readable {
		m.startTailerLocked(st)
	}
	if src.Type == config.SourceTypeGlob {
		m.startGlobWatchLocked(st)
	}
}

// applyResolutionLocked copies a fresh logsource.Resolution into st and
// returns whether this transitioned the source from readable to
// unreadable (so callers can emit a sourceError event once, outside the
// lock). Callers must hold m.mu.
func (m *Manager) applyResolutionLocked(st *sourceState, res logsource.Resolution) (becameUnreadable bool) {
	wasReadable := st.readable
	st.matched = len(res.Matched)
	st.readable = res.Readable
	st.lastError = res.LastError
	if res.Readable {
		st.activeFile = res.ActiveFile
		for _, mf := range res.Matched {
			if mf.File == res.ActiveFile {
				st.size = mf.Size
				st.modTime = mf.ModTime
			}
		}
	} else {
		st.size = 0
		st.modTime = time.Time{}
	}
	return wasReadable && !res.Readable
}

// startTailerLocked starts (or restarts) the tailer for st.activeFile,
// seeded to start following from the file's current end — exactly what an
// initial ReadLastLines(path, n, 0) backfill would consider EOF, so there
// is neither a gap nor a duplicate between a client's backfill and the
// live stream. Callers must hold m.mu.
func (m *Manager) startTailerLocked(st *sourceState) {
	if st.activeFile == "" {
		return
	}
	var startOffset int64
	if info, err := os.Stat(st.activeFile); err == nil {
		startOffset = info.Size()
	}

	sourceID := st.cfg.ID
	tl, err := NewTailer(st.activeFile, startOffset,
		func(e Entry) { m.dispatchLine(sourceID, e) },
		func(n Notification) { m.handleTailerNotification(sourceID, n) },
		m.logger,
	)
	if err != nil {
		st.readable = false
		st.lastError = err.Error()
		m.logger.Warn("failed to start tailer", "source", sourceID, "file", st.activeFile, "error", err)
		return
	}
	st.tailer = tl
}

func (m *Manager) handleTailerNotification(sourceID string, n Notification) {
	m.dispatchEvent(SourceEvent{SourceID: sourceID, Type: SourceEventType(n.Type), File: n.File, Message: n.Message})
	if n.Type == NotificationTruncated {
		m.refreshLiveStats(sourceID)
	}
}

func (m *Manager) startGlobWatchLocked(st *sourceState) {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		m.logger.Warn("could not start glob directory watch", "source", st.cfg.ID, "error", err)
		return
	}
	dir := filepath.Dir(st.cfg.Path)
	if err := watcher.Add(dir); err != nil {
		m.logger.Warn("could not watch glob source directory", "source", st.cfg.ID, "dir", dir, "error", err)
		_ = watcher.Close()
		return
	}

	st.globWatcher = watcher
	st.globStop = make(chan struct{})
	st.globDone = make(chan struct{})
	sourceID := st.cfg.ID

	go func() {
		defer close(st.globDone)
		var timer *time.Timer
		var timerC <-chan time.Time
		for {
			select {
			case <-st.globStop:
				if timer != nil {
					timer.Stop()
				}
				return
			case _, ok := <-watcher.Events:
				if !ok {
					return
				}
				if timer == nil {
					timer = time.NewTimer(globWatchDebounce)
				} else {
					timer.Reset(globWatchDebounce)
				}
				timerC = timer.C
			case <-timerC:
				timerC = nil
				m.checkGlobRotation(sourceID)
			case err, ok := <-watcher.Errors:
				if !ok {
					return
				}
				m.logger.Warn("glob directory watch error", "source", sourceID, "error", err)
			}
		}
	}()
}

// checkGlobRotation re-resolves a glob source and, if a newer active file
// has appeared, switches the tailer over to it (fresh backfill from its
// end) and emits a "rotated" event explaining the jump. It also picks up
// a source that just became readable for the first time.
func (m *Manager) checkGlobRotation(sourceID string) {
	m.mu.RLock()
	st, ok := m.sources[sourceID]
	if !ok {
		m.mu.RUnlock()
		return
	}
	src := st.cfg
	m.mu.RUnlock()

	res := logsource.Resolve(src)

	m.mu.Lock()
	st, ok = m.sources[sourceID]
	if !ok {
		m.mu.Unlock()
		return
	}
	currentActive := st.activeFile
	hasTailer := st.tailer != nil
	becameUnreadable := m.applyResolutionLocked(st, res)
	needsSwitch := res.Readable && hasTailer && res.ActiveFile != "" && res.ActiveFile != currentActive
	needsFirstStart := res.Readable && !hasTailer
	if needsFirstStart {
		m.startTailerLocked(st)
	}
	m.mu.Unlock()

	if becameUnreadable {
		m.dispatchEvent(SourceEvent{SourceID: sourceID, Type: SourceEventError, Message: res.LastError})
	}
	if needsSwitch {
		m.switchActiveFile(sourceID, res.ActiveFile)
	}
}

// switchActiveFile stops the current tailer for sourceID (if any) and
// starts a fresh one against newActiveFile, then announces the jump.
func (m *Manager) switchActiveFile(sourceID, newActiveFile string) {
	m.mu.Lock()
	st, ok := m.sources[sourceID]
	if !ok {
		m.mu.Unlock()
		return
	}
	oldTailer := st.tailer
	st.tailer = nil
	st.activeFile = newActiveFile
	m.mu.Unlock()

	if oldTailer != nil {
		if err := oldTailer.Stop(); err != nil {
			m.logger.Warn("error stopping tailer during rotation", "source", sourceID, "error", err)
		}
	}

	m.mu.Lock()
	if st, ok := m.sources[sourceID]; ok {
		m.startTailerLocked(st)
	}
	m.mu.Unlock()

	m.dispatchEvent(SourceEvent{
		SourceID: sourceID,
		Type:     SourceEventRotated,
		File:     newActiveFile,
		Message:  "switched to " + newActiveFile,
	})
}

// refreshLiveStats re-resolves a tracked source and updates its cached
// status, without touching its tailer. Used after a roll and after a
// truncation notification, so the UI isn't stale waiting for the next
// sweep.
func (m *Manager) refreshLiveStats(sourceID string) {
	m.mu.Lock()
	st, ok := m.sources[sourceID]
	if !ok {
		m.mu.Unlock()
		return
	}
	src := st.cfg
	m.mu.Unlock()

	res := logsource.Resolve(src)

	m.mu.Lock()
	st, ok = m.sources[sourceID]
	var becameUnreadable bool
	if ok {
		becameUnreadable = m.applyResolutionLocked(st, res)
	}
	m.mu.Unlock()

	if becameUnreadable {
		m.dispatchEvent(SourceEvent{SourceID: sourceID, Type: SourceEventError, Message: res.LastError})
	}
}

// sweepLoop periodically retries resolution for tracked sources that
// currently have no active tailer, so a source that was missing/unreadable
// at startup (or went unreadable and later recovered) starts being tailed
// again without requiring a config change.
func (m *Manager) sweepLoop() {
	defer close(m.sweepDone)
	ticker := time.NewTicker(sweepInterval)
	defer ticker.Stop()
	for {
		select {
		case <-m.sweepStop:
			return
		case <-ticker.C:
			m.sweepOnce()
		}
	}
}

func (m *Manager) sweepOnce() {
	m.mu.RLock()
	var ids []string
	for id, st := range m.sources {
		if st.tailer == nil {
			ids = append(ids, id)
		}
	}
	m.mu.RUnlock()

	for _, id := range ids {
		m.mu.RLock()
		st, ok := m.sources[id]
		if !ok {
			m.mu.RUnlock()
			continue
		}
		src := st.cfg
		m.mu.RUnlock()

		res := logsource.Resolve(src)

		m.mu.Lock()
		st, ok = m.sources[id]
		if ok {
			m.applyResolutionLocked(st, res)
			if res.Readable && st.tailer == nil {
				m.startTailerLocked(st)
			}
		}
		m.mu.Unlock()
	}
}

// teardown stops a sourceState's tailer and glob watch. Must be called
// without holding m.mu, since both block on goroutine shutdown.
func (m *Manager) teardown(st *sourceState) {
	if st.tailer != nil {
		if err := st.tailer.Stop(); err != nil {
			m.logger.Warn("error stopping tailer", "source", st.cfg.ID, "error", err)
		}
	}
	if st.globWatcher != nil {
		close(st.globStop)
		<-st.globDone
		_ = st.globWatcher.Close()
	}
}

func (m *Manager) dispatchLine(sourceID string, e Entry) {
	m.mu.Lock()
	if st, ok := m.sources[sourceID]; ok {
		if end := e.Offset + int64(len(e.Text)) + 1; end > st.size {
			st.size = end
		}
		st.modTime = e.Ts
	}
	m.mu.Unlock()

	m.lineListenersMu.Lock()
	list := m.lineListeners[sourceID]
	fns := make([]LineListener, len(list))
	for i, e2 := range list {
		fns[i] = e2.fn
	}
	m.lineListenersMu.Unlock()

	for _, fn := range fns {
		fn(e)
	}
}

func (m *Manager) dispatchEvent(ev SourceEvent) {
	m.eventListenersMu.RLock()
	fns := make([]EventListener, 0, len(m.eventListeners))
	for _, fn := range m.eventListeners {
		if fn != nil {
			fns = append(fns, fn)
		}
	}
	m.eventListenersMu.RUnlock()

	for _, fn := range fns {
		fn(ev)
	}
}

func resolutionToStatus(res logsource.Resolution) SourceStatus {
	status := SourceStatus{
		ActiveFile:       res.ActiveFile,
		MatchedFileCount: len(res.Matched),
		Readable:         res.Readable,
		LastError:        res.LastError,
	}
	for _, mf := range res.Matched {
		if mf.File == res.ActiveFile {
			status.Size = mf.Size
			status.ModTime = mf.ModTime
		}
	}
	return status
}

func equalStrSlices(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
