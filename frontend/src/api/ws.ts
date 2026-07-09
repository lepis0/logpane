import { useSyncExternalStore } from "react";
import type { ClientMessage, ServerMessage } from "../types/wsMessages";

export type ConnectionStatus = "connecting" | "open" | "reconnecting" | "closed";

const WS_PATH = "/api/v1/ws";
const MIN_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30_000;
/** If we were connected at least this long, treat the next disconnect as "fresh" and reset backoff. */
const BACKOFF_RESET_AFTER_MS = 10_000;
const PING_INTERVAL_MS = 25_000;

type MessageListener = (msg: ServerMessage) => void;
type StatusListener = (status: ConnectionStatus) => void;

/**
 * Single module-level WebSocket connection for the whole app (one socket, many
 * source subscriptions), with ref-counted subscribe/unsubscribe and
 * exponential-backoff reconnection.
 */
class WsClient {
  private socket: WebSocket | null = null;
  private status: ConnectionStatus = "closed";
  private backoffMs = MIN_BACKOFF_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private connectedAt: number | null = null;
  private manuallyClosed = true;
  private readonly messageListeners = new Set<MessageListener>();
  private readonly statusListeners = new Set<StatusListener>();
  /** sourceId -> number of active subscribers (components) */
  private readonly subscriptions = new Map<string, number>();

  connect(): void {
    if (typeof WebSocket === "undefined") return; // SSR/test guard
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.manuallyClosed = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.setStatus(this.status === "closed" ? "connecting" : "reconnecting");

    const wsOrigin = window.location.origin.replace(/^http/, "ws");
    const socket = new WebSocket(`${wsOrigin}${WS_PATH}`);
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.connectedAt = Date.now();
      this.setStatus("open");
      this.resubscribeAll();
      this.startPing();
    });

    socket.addEventListener("message", (event) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data as string) as ServerMessage;
      } catch {
        return;
      }
      for (const listener of this.messageListeners) listener(msg);
    });

    socket.addEventListener("close", () => {
      this.stopPing();
      if (this.socket === socket) this.socket = null;
      if (this.connectedAt !== null && Date.now() - this.connectedAt >= BACKOFF_RESET_AFTER_MS) {
        this.backoffMs = MIN_BACKOFF_MS;
      }
      this.connectedAt = null;
      if (this.manuallyClosed) {
        this.setStatus("closed");
        return;
      }
      this.setStatus("reconnecting");
      this.scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      // The "close" event always follows an error on WebSocket; reconnect logic lives there.
    });
  }

  disconnect(): void {
    this.manuallyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopPing();
    this.socket?.close();
    this.socket = null;
    this.setStatus("closed");
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  onMessage(listener: MessageListener): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  /** Ref-counted: only sends `subscribe` to the server on the 0 -> 1 transition for this sourceId. */
  subscribe(sourceId: string): void {
    const count = this.subscriptions.get(sourceId) ?? 0;
    this.subscriptions.set(sourceId, count + 1);
    if (count === 0) {
      this.send({ type: "subscribe", sourceIds: [sourceId] });
    }
  }

  /** Ref-counted: only sends `unsubscribe` once the last subscriber for this sourceId goes away. */
  unsubscribe(sourceId: string): void {
    const count = this.subscriptions.get(sourceId) ?? 0;
    if (count <= 1) {
      this.subscriptions.delete(sourceId);
      this.send({ type: "unsubscribe", sourceIds: [sourceId] });
    } else {
      this.subscriptions.set(sourceId, count - 1);
    }
  }

  private resubscribeAll(): void {
    const sourceIds = [...this.subscriptions.keys()];
    if (sourceIds.length > 0) {
      this.send({ type: "subscribe", sourceIds });
    }
  }

  private send(message: ClientMessage): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => this.send({ type: "ping" }), PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const jitterFactor = 0.85 + Math.random() * 0.3; // +/- 15%
    const delay = Math.min(this.backoffMs, MAX_BACKOFF_MS) * jitterFactor;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
  }
}

export const wsClient = new WsClient();

/** React binding for the current connection status, e.g. to drive a "reconnecting..." banner. */
export function useConnectionStatus(): ConnectionStatus {
  return useSyncExternalStore(
    (onStoreChange) => wsClient.onStatusChange(onStoreChange),
    () => wsClient.getStatus(),
  );
}
