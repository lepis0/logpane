import type { LogLineEntry } from "./logLine";

export interface ClientSubscribeMessage {
  type: "subscribe";
  sourceIds: string[];
}

export interface ClientUnsubscribeMessage {
  type: "unsubscribe";
  sourceIds: string[];
}

export interface ClientPingMessage {
  type: "ping";
}

export type ClientMessage =
  | ClientSubscribeMessage
  | ClientUnsubscribeMessage
  | ClientPingMessage;

export interface ServerSubscribedMessage {
  type: "subscribed";
  sourceIds: string[];
}

export interface ServerLinesMessage {
  type: "lines";
  sourceId: string;
  entries: LogLineEntry[];
}

export interface ServerRotatedMessage {
  type: "rotated";
  sourceId: string;
  file: string;
  message: string;
}

export interface ServerTruncatedMessage {
  type: "truncated";
  sourceId: string;
  file: string;
}

export interface ServerDroppedMessage {
  type: "dropped";
  sourceId: string;
  count: number;
}

export interface ServerSourceErrorMessage {
  type: "sourceError";
  sourceId: string;
  message: string;
}

export interface ServerSourcesChangedMessage {
  type: "sourcesChanged";
}

export interface ServerPongMessage {
  type: "pong";
}

export type ServerMessage =
  | ServerSubscribedMessage
  | ServerLinesMessage
  | ServerRotatedMessage
  | ServerTruncatedMessage
  | ServerDroppedMessage
  | ServerSourceErrorMessage
  | ServerSourcesChangedMessage
  | ServerPongMessage;
