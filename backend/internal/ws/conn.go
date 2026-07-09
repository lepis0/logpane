package ws

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// outboundBufferSize bounds each connection's outbound queue. Once full,
// enqueue drops the oldest queued message to make room rather than
// blocking the caller (the tail fan-out goroutine), per the backpressure
// policy described in package ws's overview.
const outboundBufferSize = 1000

// writeTimeout bounds a single frame write so a stalled client can't hang
// the write pump indefinitely.
const writeTimeout = 10 * time.Second

type outboundMsg struct {
	// sourceID attributes payload to a source for drop accounting; empty
	// for connection-level control messages (subscribed/sourcesChanged/
	// pong), which are never dropped in preference to dropping data.
	sourceID string
	payload  []byte
}

// Conn wraps one accepted WebSocket connection. Serve runs a read pump
// (inbound control messages) and a write pump (outbound queue drain)
// concurrently and blocks until the connection ends for any reason.
type Conn struct {
	ws  *websocket.Conn
	hub *Hub

	send chan outboundMsg

	mu      sync.Mutex
	dropped map[string]int
}

func newConn(wsConn *websocket.Conn, hub *Hub) *Conn {
	return &Conn{
		ws:      wsConn,
		hub:     hub,
		send:    make(chan outboundMsg, outboundBufferSize),
		dropped: make(map[string]int),
	}
}

// Serve registers the connection with the hub, runs both pumps, and
// unregisters on the way out. It returns once the socket is done, for any
// reason (client disconnect, write error, or ctx cancellation on server
// shutdown).
func (c *Conn) Serve(ctx context.Context) {
	c.hub.Register(c)
	defer c.hub.Unregister(c)

	writeDone := make(chan struct{})
	go func() {
		defer close(writeDone)
		c.writePump(ctx)
	}()

	c.readPump(ctx)
	_ = c.ws.Close(websocket.StatusNormalClosure, "")
	<-writeDone
}

func (c *Conn) readPump(ctx context.Context) {
	for {
		_, data, err := c.ws.Read(ctx)
		if err != nil {
			return
		}
		var msg ClientMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			// Ignore malformed frames rather than killing the connection
			// over one bad message.
			continue
		}
		switch msg.Type {
		case ClientSubscribe:
			c.hub.Subscribe(c, msg.SourceIDs)
		case ClientUnsubscribe:
			c.hub.Unsubscribe(c, msg.SourceIDs)
		case ClientPing:
			if payload, err := json.Marshal(Pong()); err == nil {
				c.enqueue("", payload)
			}
		}
	}
}

func (c *Conn) writePump(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-c.send:
			if !ok {
				return
			}
			if err := c.writeRaw(ctx, msg.payload); err != nil {
				return
			}
			// Once the queue has drained, this is a good moment to flush
			// any "you missed N lines" markers accumulated while we were
			// under backpressure.
			if len(c.send) == 0 {
				for _, dm := range c.drainDropped() {
					if err := c.writeRaw(ctx, dm.payload); err != nil {
						return
					}
				}
			}
		}
	}
}

func (c *Conn) writeRaw(ctx context.Context, payload []byte) error {
	wctx, cancel := context.WithTimeout(ctx, writeTimeout)
	defer cancel()
	return c.ws.Write(wctx, websocket.MessageText, payload)
}

// enqueue queues payload for delivery, never blocking the caller. Under
// backpressure (a full outbound queue — a slow reader) it drops the oldest
// queued message to make room. sourceID attributes the message for drop
// accounting; pass "" for connection-level control messages.
func (c *Conn) enqueue(sourceID string, payload []byte) {
	msg := outboundMsg{sourceID: sourceID, payload: payload}
	select {
	case c.send <- msg:
		return
	default:
	}

	select {
	case old := <-c.send:
		if old.sourceID != "" {
			c.recordDropped(old.sourceID, 1)
		}
	default:
	}

	select {
	case c.send <- msg:
	default:
		// Another producer raced us for the slot we just freed. Rather
		// than block or spin, count this message as dropped too.
		if sourceID != "" {
			c.recordDropped(sourceID, 1)
		}
	}
}

func (c *Conn) recordDropped(sourceID string, n int) {
	c.mu.Lock()
	c.dropped[sourceID] += n
	c.mu.Unlock()
}

func (c *Conn) drainDropped() []outboundMsg {
	c.mu.Lock()
	if len(c.dropped) == 0 {
		c.mu.Unlock()
		return nil
	}
	pending := c.dropped
	c.dropped = make(map[string]int)
	c.mu.Unlock()

	msgs := make([]outboundMsg, 0, len(pending))
	for sourceID, count := range pending {
		payload, err := json.Marshal(Dropped(sourceID, count))
		if err != nil {
			continue
		}
		msgs = append(msgs, outboundMsg{payload: payload})
	}
	return msgs
}
