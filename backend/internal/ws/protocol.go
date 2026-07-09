// Package ws implements the WebSocket live-tail feed at /api/v1/ws. One
// socket serves an entire browser tab: the client subscribes/unsubscribes
// to any number of source ids over time, and the server fans out new
// lines and lifecycle events for exactly the sources each connection
// currently cares about. There is no server-side replay buffer — history
// is always fetched via the REST /sources/{id}/lines endpoint; the socket
// only ever carries what happens from "now" forward.
//
// The message shapes below are load-bearing: they mirror
// frontend/src/types/wsMessages.ts field-for-field, since the frontend is
// built independently against this exact contract.
package ws

// ClientMessageType enumerates the messages a browser tab can send.
type ClientMessageType string

const (
	ClientSubscribe   ClientMessageType = "subscribe"
	ClientUnsubscribe ClientMessageType = "unsubscribe"
	ClientPing        ClientMessageType = "ping"
)

// ClientMessage is the envelope for every inbound message. SourceIDs is
// used by subscribe/unsubscribe and ignored (may be absent) for ping.
type ClientMessage struct {
	Type      ClientMessageType `json:"type"`
	SourceIDs []string          `json:"sourceIds,omitempty"`
}

// ServerMessageType enumerates the messages the server can send.
type ServerMessageType string

const (
	ServerSubscribed         ServerMessageType = "subscribed"
	ServerLines              ServerMessageType = "lines"
	ServerRotated            ServerMessageType = "rotated"
	ServerTruncated          ServerMessageType = "truncated"
	ServerDropped            ServerMessageType = "dropped"
	ServerSourceError        ServerMessageType = "sourceError"
	ServerSourcesChangedType ServerMessageType = "sourcesChanged"
	ServerPong               ServerMessageType = "pong"
)

// LineEntryDTO mirrors frontend LogLineEntry: {offset, ts, text, file}.
type LineEntryDTO struct {
	Offset int64  `json:"offset"`
	Ts     string `json:"ts"`
	Text   string `json:"text"`
	File   string `json:"file"`
}

// ServerMessage is the single outbound envelope; only the fields relevant
// to a given Type are populated (via the constructors below), matching the
// frontend's discriminated-union parsing of `type`.
type ServerMessage struct {
	Type      ServerMessageType `json:"type"`
	SourceIDs []string          `json:"sourceIds,omitempty"`
	SourceID  string            `json:"sourceId,omitempty"`
	Entries   []LineEntryDTO    `json:"entries,omitempty"`
	File      string            `json:"file,omitempty"`
	Message   string            `json:"message,omitempty"`
	Count     int               `json:"count,omitempty"`
}

func Subscribed(sourceIDs []string) ServerMessage {
	return ServerMessage{Type: ServerSubscribed, SourceIDs: sourceIDs}
}

func Lines(sourceID string, entries []LineEntryDTO) ServerMessage {
	return ServerMessage{Type: ServerLines, SourceID: sourceID, Entries: entries}
}

func Rotated(sourceID, file, message string) ServerMessage {
	return ServerMessage{Type: ServerRotated, SourceID: sourceID, File: file, Message: message}
}

func Truncated(sourceID, file string) ServerMessage {
	return ServerMessage{Type: ServerTruncated, SourceID: sourceID, File: file}
}

func Dropped(sourceID string, count int) ServerMessage {
	return ServerMessage{Type: ServerDropped, SourceID: sourceID, Count: count}
}

func SourceError(sourceID, message string) ServerMessage {
	return ServerMessage{Type: ServerSourceError, SourceID: sourceID, Message: message}
}

func SourcesChangedMsg() ServerMessage {
	return ServerMessage{Type: ServerSourcesChangedType}
}

func Pong() ServerMessage {
	return ServerMessage{Type: ServerPong}
}
