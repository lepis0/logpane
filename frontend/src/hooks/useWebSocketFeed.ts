import { useEffect } from "react";
import { toast } from "sonner";
import { wsClient } from "../api/ws";
import { fetchSourceLines } from "../api/sources";
import { logStore } from "../stores/logStore";
import type { LogLineEntry } from "../types/logLine";
import type { ServerMessage } from "../types/wsMessages";

/**
 * Subscribes a component to a source's live line feed for as long as it's mounted.
 *
 * Subscribing over the WebSocket does not itself deliver history, so this also
 * fetches the tail-most REST page (a) on first mount to seed the buffer, and
 * (b) whenever the shared socket (re)connects, merging in anything newer than
 * what's already buffered to fill the gap left by the disconnect.
 */
export function useWebSocketFeed(sourceId: string | undefined): void {
  useEffect(() => {
    if (!sourceId) return;

    let cancelled = false;
    let pendingBatch: LogLineEntry[] = [];
    let rafHandle: number | null = null;

    const flush = () => {
      rafHandle = null;
      if (pendingBatch.length === 0) return;
      const batch = pendingBatch;
      pendingBatch = [];
      logStore.getState().appendLines(sourceId, batch);
    };

    const scheduleFlush = () => {
      if (rafHandle === null) {
        rafHandle = requestAnimationFrame(flush);
      }
    };

    const syncTail = async () => {
      try {
        const page = await fetchSourceLines(sourceId, { limit: 1000 });
        if (!cancelled) {
          logStore.getState().mergeTail(sourceId, page.entries, page.hasMore);
        }
      } catch {
        // Backend unreachable - the pane itself surfaces a disconnected state;
        // the next successful reconnect will retry this sync.
      }
    };

    const offMessage = wsClient.onMessage((msg: ServerMessage) => {
      if (!("sourceId" in msg) || msg.sourceId !== sourceId) return;
      switch (msg.type) {
        case "lines":
          pendingBatch.push(...msg.entries);
          scheduleFlush();
          break;
        case "sourceError":
          logStore.getState().markError(sourceId, msg.message);
          break;
        case "truncated":
          logStore.getState().resetSource(sourceId);
          void syncTail();
          break;
        case "rotated":
          // New underlying file selected by the backend; keep existing lines and
          // keep tailing - nothing to reconcile client-side.
          break;
        case "dropped":
          toast.warning(`Dropped ${msg.count} line${msg.count === 1 ? "" : "s"} due to backpressure`);
          break;
        default:
          break;
      }
    });

    const offStatus = wsClient.onStatusChange((status) => {
      if (status === "open") {
        void syncTail();
      }
    });

    wsClient.subscribe(sourceId);
    wsClient.connect();
    void syncTail();

    return () => {
      cancelled = true;
      if (rafHandle !== null) cancelAnimationFrame(rafHandle);
      offMessage();
      offStatus();
      wsClient.unsubscribe(sourceId);
    };
  }, [sourceId]);
}
