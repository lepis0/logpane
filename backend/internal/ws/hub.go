package ws

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"

	"github.com/lepis0/logpane/backend/internal/tail"
)

// Hub is the connection registry and fan-out engine for the live-tail
// feed. It tracks, per source id, which connections are currently
// subscribed, and lazily registers exactly one internal/tail.Manager line
// listener per source id (ref-counted across however many connections
// care about it) rather than one per connection.
//
// New lines for a (connection, source) pair are coalesced for
// coalesceWindow before being flushed as a single "lines" message, so a
// noisy source doesn't turn into one WS frame per line.
type Hub struct {
	logger         *slog.Logger
	manager        *tail.Manager
	coalesceWindow time.Duration

	mu           sync.Mutex
	conns        map[*Conn]struct{}
	subs         map[string]map[*Conn]struct{} // sourceID -> subscribed connections
	managerUnsub map[string]func()             // sourceID -> unsubscribe from manager.OnLine

	coalesceMu sync.Mutex
	pending    map[*Conn]map[string]*coalesceBucket // conn -> sourceID -> buffered entries
}

type coalesceBucket struct {
	entries []LineEntryDTO
	timer   *time.Timer
}

// NewHub builds a Hub and registers its single global tail.Manager event
// listener (rotated/truncated/sourceError), which it fans out to whichever
// connections are currently subscribed to the affected source.
func NewHub(manager *tail.Manager, coalesceWindowMs int, logger *slog.Logger) *Hub {
	if logger == nil {
		logger = slog.Default()
	}
	if coalesceWindowMs <= 0 {
		coalesceWindowMs = 50
	}
	h := &Hub{
		logger:         logger,
		manager:        manager,
		coalesceWindow: time.Duration(coalesceWindowMs) * time.Millisecond,
		conns:          make(map[*Conn]struct{}),
		subs:           make(map[string]map[*Conn]struct{}),
		managerUnsub:   make(map[string]func()),
		pending:        make(map[*Conn]map[string]*coalesceBucket),
	}
	manager.OnEvent(h.handleSourceEvent)
	return h
}

// ServeHTTP upgrades the request to a WebSocket and runs the connection
// until it ends. Origin checking is intentionally disabled: Logpane has no
// auth/CORS boundary at all (see package docs on the REST API), and
// disabling it avoids Vite's dev-mode proxy — where the browser's Origin
// legitimately differs from what the backend sees — rejecting the
// handshake.
func (h *Hub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: []string{"*"},
	})
	if err != nil {
		h.logger.Warn("websocket accept failed", "error", err)
		return
	}
	conn := newConn(c, h)
	conn.Serve(r.Context())
}

// Register adds a newly-accepted connection to the registry.
func (h *Hub) Register(c *Conn) {
	h.mu.Lock()
	h.conns[c] = struct{}{}
	h.mu.Unlock()
}

// Unregister removes a connection from the registry and from every
// source's subscriber set, releasing the manager listener for any source
// this was the last subscriber of, and cancels any pending coalesce timers
// for it.
func (h *Hub) Unregister(c *Conn) {
	var toUnregister []func()

	h.mu.Lock()
	delete(h.conns, c)
	for sourceID, conns := range h.subs {
		if _, ok := conns[c]; !ok {
			continue
		}
		delete(conns, c)
		if len(conns) == 0 {
			delete(h.subs, sourceID)
			if unsub, ok := h.managerUnsub[sourceID]; ok {
				delete(h.managerUnsub, sourceID)
				toUnregister = append(toUnregister, unsub)
			}
		}
	}
	h.mu.Unlock()

	for _, unsub := range toUnregister {
		unsub()
	}

	h.coalesceMu.Lock()
	perConn := h.pending[c]
	delete(h.pending, c)
	h.coalesceMu.Unlock()
	for _, bucket := range perConn {
		if bucket.timer != nil {
			bucket.timer.Stop()
		}
	}
}

// Close closes every currently-registered connection (used during server
// shutdown, since http.Server.Shutdown does not itself close hijacked
// WebSocket connections).
func (h *Hub) Close() {
	h.mu.Lock()
	conns := make([]*Conn, 0, len(h.conns))
	for c := range h.conns {
		conns = append(conns, c)
	}
	h.mu.Unlock()
	for _, c := range conns {
		_ = c.ws.Close(websocket.StatusServiceRestart, "server shutting down")
	}
}

// Subscribe adds c as a subscriber of every id in sourceIDs and, for any
// id with no prior subscriber, registers a manager line listener for it.
// Always acks with a "subscribed" message.
func (h *Hub) Subscribe(c *Conn, sourceIDs []string) {
	var newlyRegistered []string

	h.mu.Lock()
	for _, id := range sourceIDs {
		conns, ok := h.subs[id]
		if !ok {
			conns = make(map[*Conn]struct{})
			h.subs[id] = conns
		}
		conns[c] = struct{}{}
		if _, exists := h.managerUnsub[id]; !exists {
			newlyRegistered = append(newlyRegistered, id)
		}
	}
	h.mu.Unlock()

	for _, id := range newlyRegistered {
		unsub := h.manager.OnLine(id, h.makeLineHandler(id))
		h.mu.Lock()
		if _, exists := h.managerUnsub[id]; exists {
			// Lost a race with another Subscribe for the same id; keep
			// the first registration, drop this one to avoid a leak.
			h.mu.Unlock()
			unsub()
			continue
		}
		h.managerUnsub[id] = unsub
		h.mu.Unlock()
	}

	if payload, err := json.Marshal(Subscribed(sourceIDs)); err == nil {
		c.enqueue("", payload)
	}
}

// Unsubscribe removes c as a subscriber of every id in sourceIDs,
// releasing the manager listener for any id this was the last subscriber
// of, and drops any not-yet-flushed coalesced entries for those ids.
func (h *Hub) Unsubscribe(c *Conn, sourceIDs []string) {
	var toUnregister []func()

	h.mu.Lock()
	for _, id := range sourceIDs {
		conns, ok := h.subs[id]
		if !ok {
			continue
		}
		delete(conns, c)
		if len(conns) == 0 {
			delete(h.subs, id)
			if unsub, ok := h.managerUnsub[id]; ok {
				delete(h.managerUnsub, id)
				toUnregister = append(toUnregister, unsub)
			}
		}
	}
	h.mu.Unlock()

	for _, unsub := range toUnregister {
		unsub()
	}

	h.coalesceMu.Lock()
	if perConn, ok := h.pending[c]; ok {
		for _, id := range sourceIDs {
			if bucket, ok := perConn[id]; ok {
				if bucket.timer != nil {
					bucket.timer.Stop()
				}
				delete(perConn, id)
			}
		}
	}
	h.coalesceMu.Unlock()
}

// BroadcastSourcesChanged notifies every currently-connected connection
// (regardless of subscriptions) that the source list changed, so clients
// can refetch GET /sources. Wire this to config.Store.Subscribe.
func (h *Hub) BroadcastSourcesChanged() {
	h.mu.Lock()
	conns := make([]*Conn, 0, len(h.conns))
	for c := range h.conns {
		conns = append(conns, c)
	}
	h.mu.Unlock()

	payload, err := json.Marshal(SourcesChangedMsg())
	if err != nil {
		return
	}
	for _, c := range conns {
		c.enqueue("", payload)
	}
}

// makeLineHandler returns a tail.LineListener that coalesces entries for
// sourceID per subscribed connection before flushing.
func (h *Hub) makeLineHandler(sourceID string) tail.LineListener {
	return func(e tail.Entry) {
		h.mu.Lock()
		conns := make([]*Conn, 0, len(h.subs[sourceID]))
		for c := range h.subs[sourceID] {
			conns = append(conns, c)
		}
		h.mu.Unlock()
		if len(conns) == 0 {
			return
		}

		dto := LineEntryDTO{Offset: e.Offset, Ts: e.Ts.UTC().Format(time.RFC3339Nano), Text: e.Text, File: e.File}
		for _, c := range conns {
			h.coalesce(c, sourceID, dto)
		}
	}
}

func (h *Hub) coalesce(c *Conn, sourceID string, dto LineEntryDTO) {
	h.coalesceMu.Lock()
	defer h.coalesceMu.Unlock()

	perConn, ok := h.pending[c]
	if !ok {
		perConn = make(map[string]*coalesceBucket)
		h.pending[c] = perConn
	}
	bucket, ok := perConn[sourceID]
	if !ok {
		bucket = &coalesceBucket{}
		perConn[sourceID] = bucket
	}
	bucket.entries = append(bucket.entries, dto)
	if bucket.timer == nil {
		bucket.timer = time.AfterFunc(h.coalesceWindow, func() {
			h.flush(c, sourceID)
		})
	}
}

func (h *Hub) flush(c *Conn, sourceID string) {
	h.coalesceMu.Lock()
	var entries []LineEntryDTO
	if perConn, ok := h.pending[c]; ok {
		if bucket, ok := perConn[sourceID]; ok {
			entries = bucket.entries
			delete(perConn, sourceID)
		}
	}
	h.coalesceMu.Unlock()

	if len(entries) == 0 {
		return
	}
	payload, err := json.Marshal(Lines(sourceID, entries))
	if err != nil {
		return
	}
	c.enqueue(sourceID, payload)
}

func (h *Hub) handleSourceEvent(ev tail.SourceEvent) {
	h.mu.Lock()
	conns := make([]*Conn, 0, len(h.subs[ev.SourceID]))
	for c := range h.subs[ev.SourceID] {
		conns = append(conns, c)
	}
	h.mu.Unlock()
	if len(conns) == 0 {
		return
	}

	var msg ServerMessage
	switch ev.Type {
	case tail.SourceEventRotated:
		msg = Rotated(ev.SourceID, ev.File, ev.Message)
	case tail.SourceEventTruncated:
		msg = Truncated(ev.SourceID, ev.File)
	case tail.SourceEventError:
		msg = SourceError(ev.SourceID, ev.Message)
	default:
		return
	}

	payload, err := json.Marshal(msg)
	if err != nil {
		return
	}
	for _, c := range conns {
		c.enqueue(ev.SourceID, payload)
	}
}
