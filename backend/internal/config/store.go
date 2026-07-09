package config

import (
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"gopkg.in/yaml.v3"
)

// Sentinel errors returned by Store methods. API handlers can use
// errors.Is to map these onto HTTP status codes.
var (
	// ErrNotFound is returned when an operation references a source id that
	// doesn't exist.
	ErrNotFound = errors.New("config: source not found")
	// ErrImmutable is returned when a caller attempts to change a source's
	// id or type after creation.
	ErrImmutable = errors.New("config: field is immutable")
	// ErrInvalid is returned (wrapped, via %w) when a config or source
	// fails validation.
	ErrInvalid = errors.New("config: invalid")
)

// slugPattern is the required shape for a source id.
var slugPattern = regexp.MustCompile(`^[a-z0-9-]+$`)

// Store is a concurrency-safe, hot-reloadable holder of the Logpane
// configuration. It reads from and writes to a single YAML file on disk,
// and notifies subscribers whenever the effective config changes, whether
// that change originated from this process (Upsert/Delete) or from an
// external hand-edit of the file (detected via fsnotify).
type Store struct {
	path   string
	logger *slog.Logger

	mu  sync.RWMutex
	cfg Config

	subMu sync.Mutex
	subs  []func(Config)

	watcher    *fsnotify.Watcher
	watchDone  chan struct{}
	watchClose chan struct{}
}

// NewStore loads (or initializes) the config at path and starts watching its
// containing directory for external changes. The returned Store is ready to
// use immediately; watch failures are logged but non-fatal (hot-reload of
// hand-edits simply won't work, the app otherwise runs fine).
func NewStore(path string, logger *slog.Logger) (*Store, error) {
	if logger == nil {
		logger = slog.Default()
	}
	s := &Store{
		path:   path,
		logger: logger,
	}
	if err := s.Load(); err != nil {
		return nil, err
	}
	if err := s.startWatch(); err != nil {
		s.logger.Warn("config file watch could not be started; external hand-edits won't hot-reload", "error", err)
	}
	return s, nil
}

// Path returns the config file path this store reads/writes.
func (s *Store) Path() string {
	return s.path
}

// Get returns a deep copy of the current in-memory config.
func (s *Store) Get() Config {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.cfg.Clone()
}

// GetSource returns a single source by id.
func (s *Store) GetSource(id string) (Source, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, src := range s.cfg.Sources {
		if src.ID == id {
			return src.Clone(), nil
		}
	}
	return Source{}, ErrNotFound
}

// Load reads, parses, and validates the config file from disk, replacing
// the in-memory config on success. If the file doesn't exist, a minimal
// default config is initialized and written out. Load does not itself
// notify subscribers (callers that care — e.g. the fsnotify watch loop —
// do so explicitly after a successful Load), since NewStore's initial load
// happens before anyone has subscribed.
func (s *Store) Load() error {
	data, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		s.logger.Info("no config file found, initializing default", "path", s.path)
		cfg := DefaultConfig()
		s.mu.Lock()
		s.cfg = cfg
		s.mu.Unlock()
		return s.Save()
	}
	if err != nil {
		return fmt.Errorf("config: reading %s: %w", s.path, err)
	}

	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return fmt.Errorf("config: parsing %s: %w", s.path, err)
	}
	applyDefaults(&cfg)
	if err := validateConfig(cfg); err != nil {
		return fmt.Errorf("config: %s failed validation: %w", s.path, err)
	}

	s.mu.Lock()
	s.cfg = cfg
	s.mu.Unlock()
	return nil
}

// applyDefaults backfills zero-valued top-level fields on a config freshly
// parsed from disk (e.g. a hand-edited file that omits `settings`).
func applyDefaults(cfg *Config) {
	if cfg.SchemaVersion == 0 {
		cfg.SchemaVersion = currentSchemaVersion
	}
	if cfg.Settings.MaxInitialLines == 0 {
		cfg.Settings.MaxInitialLines = DefaultSettings().MaxInitialLines
	}
	if cfg.Settings.CoalesceWindowMs == 0 {
		cfg.Settings.CoalesceWindowMs = DefaultSettings().CoalesceWindowMs
	}
	if cfg.Sources == nil {
		cfg.Sources = []Source{}
	}
}

// Save atomically persists the current in-memory config to disk: it
// marshals to a temp file in the same directory, fsyncs it, then renames it
// over the destination (an atomic replace on the same filesystem).
//
// Known limitation: yaml.v3 does not preserve comments or formatting on
// round-trip, so any hand-added YAML comments will be stripped the next
// time a UI-driven change causes a Save. This is accepted, not a bug.
func (s *Store) Save() error {
	s.mu.RLock()
	cfg := s.cfg.Clone()
	s.mu.RUnlock()
	return s.saveConfig(cfg)
}

func (s *Store) saveConfig(cfg Config) error {
	dir := filepath.Dir(s.path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("config: creating %s: %w", dir, err)
	}

	data, err := yaml.Marshal(cfg)
	if err != nil {
		return fmt.Errorf("config: marshaling: %w", err)
	}

	tmp, err := os.CreateTemp(dir, filepath.Base(s.path)+".*.tmp")
	if err != nil {
		return fmt.Errorf("config: creating temp file: %w", err)
	}
	tmpPath := tmp.Name()
	// Best-effort cleanup if we bail before the rename below.
	defer os.Remove(tmpPath)

	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return fmt.Errorf("config: writing temp file: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return fmt.Errorf("config: syncing temp file: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("config: closing temp file: %w", err)
	}
	if err := os.Rename(tmpPath, s.path); err != nil {
		return fmt.Errorf("config: renaming temp file into place: %w", err)
	}
	return nil
}

// Upsert creates a new source (when src.ID is empty) or updates an existing
// one in place (when src.ID names an existing source). On create, an id is
// generated by slugifying src.Name, suffixing "-2", "-3", ... on collision.
// On update, src.Type must equal the existing source's type (empty is
// treated as "unchanged"); the id itself cannot change since it's the
// lookup key. The persisted (and possibly id-assigned) Source is returned.
func (s *Store) Upsert(src Source) (Source, error) {
	s.mu.Lock()
	cfg := s.cfg.Clone()

	if src.ID == "" {
		existing := make(map[string]bool, len(cfg.Sources))
		for _, e := range cfg.Sources {
			existing[e.ID] = true
		}
		src.ID = generateID(src.Name, existing)
		if err := validateSource(src); err != nil {
			s.mu.Unlock()
			return Source{}, err
		}
		cfg.Sources = append(cfg.Sources, src.Clone())
	} else {
		idx := indexOf(cfg.Sources, src.ID)
		if idx == -1 {
			s.mu.Unlock()
			return Source{}, ErrNotFound
		}
		current := cfg.Sources[idx]
		if src.Type != "" && src.Type != current.Type {
			s.mu.Unlock()
			return Source{}, fmt.Errorf("%w: type cannot be changed", ErrImmutable)
		}
		src.Type = current.Type
		if err := validateSource(src); err != nil {
			s.mu.Unlock()
			return Source{}, err
		}
		cfg.Sources[idx] = src.Clone()
	}

	s.cfg = cfg
	out := src.Clone()
	s.mu.Unlock()

	if err := s.saveConfig(cfg); err != nil {
		return Source{}, err
	}
	s.notify(cfg)
	return out, nil
}

// Delete removes a source by id, persists, and notifies subscribers. It
// returns ErrNotFound if no such source exists.
func (s *Store) Delete(id string) error {
	s.mu.Lock()
	cfg := s.cfg.Clone()
	idx := indexOf(cfg.Sources, id)
	if idx == -1 {
		s.mu.Unlock()
		return ErrNotFound
	}
	cfg.Sources = append(cfg.Sources[:idx], cfg.Sources[idx+1:]...)
	s.cfg = cfg
	s.mu.Unlock()

	if err := s.saveConfig(cfg); err != nil {
		return err
	}
	s.notify(cfg)
	return nil
}

// Subscribe registers fn to be called whenever the effective config
// changes (whether via Upsert/Delete or an externally detected hand-edit).
// fn is called with a fresh copy of the config; it must not block for long,
// since it runs synchronously from the goroutine that made the change.
func (s *Store) Subscribe(fn func(Config)) {
	s.subMu.Lock()
	defer s.subMu.Unlock()
	s.subs = append(s.subs, fn)
}

func (s *Store) notify(cfg Config) {
	s.subMu.Lock()
	subs := make([]func(Config), len(s.subs))
	copy(subs, s.subs)
	s.subMu.Unlock()

	for _, fn := range subs {
		fn(cfg.Clone())
	}
}

// startWatch watches the config file's containing directory (not the file
// itself — editors and config-management tools frequently replace a file
// by writing a temp file and renaming over the original, which orphans a
// direct file-handle watch) and reloads on any create/write/rename event
// whose filename matches the config's basename. Rapid-fire events (many
// editors emit several per save) are debounced by 250ms.
func (s *Store) startWatch() error {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return err
	}
	dir := filepath.Dir(s.path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		watcher.Close()
		return err
	}
	if err := watcher.Add(dir); err != nil {
		watcher.Close()
		return err
	}

	s.watcher = watcher
	s.watchDone = make(chan struct{})
	s.watchClose = make(chan struct{})
	base := filepath.Base(s.path)

	go func() {
		defer close(s.watchDone)
		const debounce = 250 * time.Millisecond
		var timer *time.Timer
		var timerC <-chan time.Time

		for {
			select {
			case <-s.watchClose:
				if timer != nil {
					timer.Stop()
				}
				return
			case ev, ok := <-watcher.Events:
				if !ok {
					return
				}
				if filepath.Base(ev.Name) != base {
					continue
				}
				if ev.Op&(fsnotify.Write|fsnotify.Create|fsnotify.Rename) == 0 {
					continue
				}
				if timer == nil {
					timer = time.NewTimer(debounce)
				} else {
					timer.Reset(debounce)
				}
				timerC = timer.C
			case <-timerC:
				timerC = nil
				s.reloadFromWatch()
			case err, ok := <-watcher.Errors:
				if !ok {
					return
				}
				s.logger.Warn("config watcher error", "error", err)
			}
		}
	}()
	return nil
}

func (s *Store) reloadFromWatch() {
	if err := s.Load(); err != nil {
		s.logger.Error("failed to reload config after external change", "error", err)
		return
	}
	s.logger.Info("reloaded config after external change", "path", s.path)
	s.notify(s.Get())
}

// Close stops the fsnotify watch goroutine. Safe to call even if the watch
// never started.
func (s *Store) Close() error {
	if s.watcher == nil {
		return nil
	}
	close(s.watchClose)
	<-s.watchDone
	return s.watcher.Close()
}

// indexOf returns the index of the source with the given id, or -1.
func indexOf(sources []Source, id string) int {
	for i, s := range sources {
		if s.ID == id {
			return i
		}
	}
	return -1
}

// generateID slugifies name into a URL-safe id and, if that id is already
// present in existing, suffixes "-2", "-3", ... until it finds a free one.
func generateID(name string, existing map[string]bool) string {
	base := slugify(name)
	if base == "" {
		base = "source"
	}
	if !existing[base] {
		return base
	}
	for i := 2; ; i++ {
		candidate := fmt.Sprintf("%s-%d", base, i)
		if !existing[candidate] {
			return candidate
		}
	}
}

// slugify lower-cases name and replaces every run of characters outside
// [a-z0-9] with a single hyphen, trimming leading/trailing hyphens.
func slugify(name string) string {
	lower := strings.ToLower(name)
	var b strings.Builder
	prevDash := false
	for _, r := range lower {
		switch {
		case r >= 'a' && r <= 'z' || r >= '0' && r <= '9':
			b.WriteRune(r)
			prevDash = false
		default:
			if !prevDash && b.Len() > 0 {
				b.WriteByte('-')
				prevDash = true
			}
		}
	}
	out := strings.TrimSuffix(b.String(), "-")
	return out
}

// validateConfig checks structural invariants across the whole config:
// unique ids and per-source validity.
func validateConfig(cfg Config) error {
	seen := make(map[string]bool, len(cfg.Sources))
	for _, src := range cfg.Sources {
		if seen[src.ID] {
			return fmt.Errorf("%w: duplicate source id %q", ErrInvalid, src.ID)
		}
		seen[src.ID] = true
		if err := validateSource(src); err != nil {
			return err
		}
	}
	return nil
}

// validateSource checks a single source's invariants: a well-formed slug
// id, a known type, and a non-empty path.
func validateSource(src Source) error {
	if src.ID == "" || !slugPattern.MatchString(src.ID) {
		return fmt.Errorf("%w: source id %q must match %s", ErrInvalid, src.ID, slugPattern.String())
	}
	if src.Type != SourceTypeFile && src.Type != SourceTypeGlob {
		return fmt.Errorf("%w: source %q has unknown type %q", ErrInvalid, src.ID, src.Type)
	}
	if strings.TrimSpace(src.Path) == "" {
		return fmt.Errorf("%w: source %q has an empty path", ErrInvalid, src.ID)
	}
	return nil
}
