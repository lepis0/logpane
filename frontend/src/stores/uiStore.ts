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
}

export type UiStore = UiState & UiActions;

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
    }),
    {
      name: "logpane-ui",
      storage: createJSONStorage(() => localStorage),
      // Only theme/sidebar survive a reload; pane layout is intentionally ephemeral
      // since it references live source ids and search state that shouldn't outlive the tab.
      partialize: (state) => ({ theme: state.theme, sidebarCollapsed: state.sidebarCollapsed }),
      version: 1,
    },
  ),
);
