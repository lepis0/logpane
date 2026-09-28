import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { SearchOptions } from "../lib/highlight";

export type Theme = "dark" | "light";

export interface PaneSearchState extends SearchOptions {
  onlyMatching: boolean;
}

export interface PaneState {
  id: string;
  sourceId: string | null;
  search: PaneSearchState;
  autoscrollPaused: boolean;
}

export const MAX_PANES = 4;

function makePaneId(): string {
  return `pane-${Math.random().toString(36).slice(2, 10)}`;
}

export function defaultPaneSearch(): PaneSearchState {
  return { query: "", regex: false, caseSensitive: false, onlyMatching: false };
}

function makePane(sourceId: string | null = null): PaneState {
  return { id: makePaneId(), sourceId, search: defaultPaneSearch(), autoscrollPaused: false };
}

interface UiState {
  theme: Theme;
  panes: PaneState[];
  activePaneId: string | null;
  sidebarCollapsed: boolean;
}

interface UiActions {
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
  /** Open a source in the active pane (or a new one, up to MAX_PANES); focuses it if already open. */
  openSource: (sourceId: string) => void;
  openSourceInNewPane: (sourceId: string) => void;
  closePane: (paneId: string) => void;
  setActivePane: (paneId: string) => void;
  updatePaneSearch: (paneId: string, patch: Partial<PaneSearchState>) => void;
  setPaneAutoscrollPaused: (paneId: string, paused: boolean) => void;
  toggleSidebar: () => void;
  /** Close panes whose source no longer exists (e.g. deleted since the layout was saved). */
  closePanesForMissingSources: (existingSourceIds: string[]) => void;
}

export type UiStore = UiState & UiActions;

/** What survives a reload: which sources were open, in which order, and which pane had focus. */
interface PersistedPane {
  id: string;
  sourceId: string;
}

interface PersistedUiState {
  theme: Theme;
  sidebarCollapsed: boolean;
  panes: PersistedPane[];
  activePaneId: string | null;
}

function isPersistedPane(value: unknown): value is PersistedPane {
  if (typeof value !== "object" || value === null) return false;
  const pane = value as Record<string, unknown>;
  return typeof pane.id === "string" && typeof pane.sourceId === "string";
}

/**
 * Rebuild live pane state from whatever was in localStorage. Storage may hold an older
 * shape (before panes were persisted) or be hand-edited, so everything is validated;
 * per-pane search and autoscroll state always start fresh.
 */
export function restorePanes(persisted: unknown): Pick<UiState, "panes" | "activePaneId"> {
  const stored = (persisted ?? {}) as Partial<Record<keyof PersistedUiState, unknown>>;
  const panes: PaneState[] = (Array.isArray(stored.panes) ? stored.panes : [])
    .filter(isPersistedPane)
    .slice(0, MAX_PANES)
    .map((p) => ({ id: p.id, sourceId: p.sourceId, search: defaultPaneSearch(), autoscrollPaused: false }));
  const activePaneId = panes.some((p) => p.id === stored.activePaneId)
    ? (stored.activePaneId as string)
    : panes[panes.length - 1]?.id ?? null;
  return { panes, activePaneId };
}

export const useUiStore = create<UiStore>()(
  persist(
    (set) => ({
      theme: "dark",
      panes: [],
      activePaneId: null,
      sidebarCollapsed: false,

      toggleTheme: () => set((s) => ({ theme: s.theme === "dark" ? "light" : "dark" })),
      setTheme: (theme) => set({ theme }),

      openSource: (sourceId) =>
        set((s) => {
          const already = s.panes.find((p) => p.sourceId === sourceId);
          if (already) return { activePaneId: already.id };

          const activeIndex = s.panes.findIndex((p) => p.id === s.activePaneId);
          if (activeIndex !== -1) {
            const panes = [...s.panes];
            panes[activeIndex] = { ...panes[activeIndex], sourceId, search: defaultPaneSearch() };
            return { panes, activePaneId: panes[activeIndex].id };
          }
          if (s.panes.length === 0 || s.panes.length < MAX_PANES) {
            const pane = makePane(sourceId);
            return { panes: [...s.panes, pane], activePaneId: pane.id };
          }
          const panes = [...s.panes];
          panes[0] = { ...panes[0], sourceId, search: defaultPaneSearch() };
          return { panes, activePaneId: panes[0].id };
        }),

      openSourceInNewPane: (sourceId) =>
        set((s) => {
          const already = s.panes.find((p) => p.sourceId === sourceId);
          if (already) return { activePaneId: already.id };
          if (s.panes.length >= MAX_PANES) {
            const panes = [...s.panes];
            panes[panes.length - 1] = {
              ...panes[panes.length - 1],
              sourceId,
              search: defaultPaneSearch(),
            };
            return { panes, activePaneId: panes[panes.length - 1].id };
          }
          const pane = makePane(sourceId);
          return { panes: [...s.panes, pane], activePaneId: pane.id };
        }),

      closePane: (paneId) =>
        set((s) => {
          const panes = s.panes.filter((p) => p.id !== paneId);
          const activePaneId =
            s.activePaneId === paneId ? panes[panes.length - 1]?.id ?? null : s.activePaneId;
          return { panes, activePaneId };
        }),

      setActivePane: (paneId) => set({ activePaneId: paneId }),

      updatePaneSearch: (paneId, patch) =>
        set((s) => ({
          panes: s.panes.map((p) => (p.id === paneId ? { ...p, search: { ...p.search, ...patch } } : p)),
        })),

      setPaneAutoscrollPaused: (paneId, paused) =>
        set((s) => ({
          panes: s.panes.map((p) => (p.id === paneId ? { ...p, autoscrollPaused: paused } : p)),
        })),

      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

      closePanesForMissingSources: (existingSourceIds) =>
        set((s) => {
          const existing = new Set(existingSourceIds);
          const panes = s.panes.filter((p) => p.sourceId === null || existing.has(p.sourceId));
          if (panes.length === s.panes.length) return {};
          const activePaneId = panes.some((p) => p.id === s.activePaneId)
            ? s.activePaneId
            : panes[panes.length - 1]?.id ?? null;
          return { panes, activePaneId };
        }),
    }),
    {
      name: "logpane-ui",
      storage: createJSONStorage(() => localStorage),
      // The open panes survive a reload so the previous session's layout comes back.
      // Only each pane's source is kept; search and autoscroll state are per-session.
      partialize: (state): PersistedUiState => ({
        theme: state.theme,
        sidebarCollapsed: state.sidebarCollapsed,
        panes: state.panes.flatMap((p) => (p.sourceId ? [{ id: p.id, sourceId: p.sourceId }] : [])),
        activePaneId: state.activePaneId,
      }),
      merge: (persisted, current) => {
        const stored = (persisted ?? {}) as Partial<PersistedUiState>;
        return {
          ...current,
          ...(stored.theme === "dark" || stored.theme === "light" ? { theme: stored.theme } : {}),
          ...(typeof stored.sidebarCollapsed === "boolean" ? { sidebarCollapsed: stored.sidebarCollapsed } : {}),
          ...restorePanes(persisted),
        };
      },
      version: 1,
    },
  ),
);
