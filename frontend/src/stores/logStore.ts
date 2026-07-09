import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import type { LogLineEntry } from "../types/logLine";

/** Max lines kept in memory per source. Oldest lines are dropped once exceeded. */
export const RING_BUFFER_CAP = 20_000;
/** A source counts as "live" (actively receiving lines) if it appended one within this window. */
export const LIVE_ACTIVITY_WINDOW_MS = 5_000;

export interface SourceLogState {
  /** Ordered oldest -> newest. */
  entries: LogLineEntry[];
  /** True once older live lines have been dropped to respect RING_BUFFER_CAP. */
  trimmed: boolean;
  /** Whether more (older) history is potentially available via the REST lines endpoint. */
  hasMoreHistory: boolean;
  loadingHistory: boolean;
  minOffsetSeen: number | null;
  maxOffsetSeen: number | null;
  /** Date.now() of the most recently appended live line - drives the "live" indicator. */
  lastLineAt: number | null;
  lastError: string | null;
}

function emptySourceState(): SourceLogState {
  return {
    entries: [],
    trimmed: false,
    hasMoreHistory: true,
    loadingHistory: false,
    minOffsetSeen: null,
    maxOffsetSeen: null,
    lastLineAt: null,
    lastError: null,
  };
}

interface CapResult {
  entries: LogLineEntry[];
  trimmed: boolean;
}

/** Keep at most `cap` entries, dropping from the front (oldest) when over. */
function capFront(entries: LogLineEntry[], cap: number, alreadyTrimmed: boolean): CapResult {
  if (entries.length <= cap) return { entries, trimmed: alreadyTrimmed };
  return { entries: entries.slice(entries.length - cap), trimmed: true };
}

export interface LogStoreState {
  bySource: Record<string, SourceLogState>;
}

export interface LogStoreActions {
  /** Seed/gap-fill from a REST tail-page fetch: merges in any entries newer than what we've already seen. */
  mergeTail: (sourceId: string, entries: LogLineEntry[], hasMoreHistory: boolean) => void;
  /** Append a batch of live lines received over the WebSocket. */
  appendLines: (sourceId: string, entries: LogLineEntry[]) => void;
  /** Prepend an older page of history (scroll-up pagination). Never evicts the live tail. */
  prependHistory: (sourceId: string, entries: LogLineEntry[], hasMoreHistory: boolean) => void;
  setLoadingHistory: (sourceId: string, loading: boolean) => void;
  markError: (sourceId: string, message: string) => void;
  /** The underlying file was truncated externally (e.g. rolled) - drop buffered lines and start over. */
  resetSource: (sourceId: string) => void;
  clearSource: (sourceId: string) => void;
  dismissTrimmed: (sourceId: string) => void;
  getSourceState: (sourceId: string) => SourceLogState;
}

export type LogStore = LogStoreState & LogStoreActions;

export const logStore = createStore<LogStore>()((set, get) => ({
  bySource: {},

  mergeTail: (sourceId, entries, hasMoreHistory) =>
    set((state) => {
      const existing = state.bySource[sourceId] ?? emptySourceState();
      const fresh =
        existing.maxOffsetSeen === null
          ? entries
          : entries.filter((e) => e.offset > existing.maxOffsetSeen!);

      if (fresh.length === 0) {
        return {
          bySource: { ...state.bySource, [sourceId]: { ...existing, hasMoreHistory } },
        };
      }

      const merged = [...existing.entries, ...fresh];
      const { entries: capped, trimmed } = capFront(merged, RING_BUFFER_CAP, existing.trimmed);
      return {
        bySource: {
          ...state.bySource,
          [sourceId]: {
            ...existing,
            entries: capped,
            trimmed,
            hasMoreHistory,
            minOffsetSeen: capped[0]?.offset ?? existing.minOffsetSeen,
            maxOffsetSeen: capped[capped.length - 1]?.offset ?? existing.maxOffsetSeen,
          },
        },
      };
    }),

  appendLines: (sourceId, entries) =>
    set((state) => {
      if (entries.length === 0) return state;
      const existing = state.bySource[sourceId] ?? emptySourceState();
      const merged = [...existing.entries, ...entries];
      const { entries: capped, trimmed } = capFront(merged, RING_BUFFER_CAP, existing.trimmed);
      return {
        bySource: {
          ...state.bySource,
          [sourceId]: {
            ...existing,
            entries: capped,
            trimmed,
            minOffsetSeen: capped[0]?.offset ?? existing.minOffsetSeen,
            maxOffsetSeen: capped[capped.length - 1]?.offset ?? existing.maxOffsetSeen,
            lastLineAt: Date.now(),
          },
        },
      };
    }),

  prependHistory: (sourceId, entries, hasMoreHistory) =>
    set((state) => {
      const existing = state.bySource[sourceId] ?? emptySourceState();
      const room = RING_BUFFER_CAP - existing.entries.length;
      const toAdd = room > 0 ? entries.slice(Math.max(0, entries.length - room)) : [];
      const merged = [...toAdd, ...existing.entries];
      return {
        bySource: {
          ...state.bySource,
          [sourceId]: {
            ...existing,
            entries: merged,
            loadingHistory: false,
            hasMoreHistory: room > 0 ? hasMoreHistory : false,
            minOffsetSeen: merged[0]?.offset ?? existing.minOffsetSeen,
            maxOffsetSeen: existing.maxOffsetSeen ?? merged[merged.length - 1]?.offset ?? null,
          },
        },
      };
    }),

  setLoadingHistory: (sourceId, loading) =>
    set((state) => {
      const existing = state.bySource[sourceId] ?? emptySourceState();
      return { bySource: { ...state.bySource, [sourceId]: { ...existing, loadingHistory: loading } } };
    }),

  markError: (sourceId, message) =>
    set((state) => {
      const existing = state.bySource[sourceId] ?? emptySourceState();
      return { bySource: { ...state.bySource, [sourceId]: { ...existing, lastError: message } } };
    }),

  resetSource: (sourceId) =>
    set((state) => ({
      bySource: { ...state.bySource, [sourceId]: emptySourceState() },
    })),

  clearSource: (sourceId) =>
    set((state) => {
      const rest = { ...state.bySource };
      delete rest[sourceId];
      return { bySource: rest };
    }),

  dismissTrimmed: (sourceId) =>
    set((state) => {
      const existing = state.bySource[sourceId];
      if (!existing) return state;
      return { bySource: { ...state.bySource, [sourceId]: { ...existing, trimmed: false } } };
    }),

  getSourceState: (sourceId) => get().bySource[sourceId] ?? emptySourceState(),
}));

/** React binding for the vanilla logStore - pass a selector to subscribe to just the slice you need. */
export function useLogStore<T>(selector: (state: LogStore) => T): T {
  return useStore(logStore, selector);
}

export function isSourceLive(state: SourceLogState | undefined, now: number = Date.now()): boolean {
  return !!state?.lastLineAt && now - state.lastLineAt <= LIVE_ACTIVITY_WINDOW_MS;
}
