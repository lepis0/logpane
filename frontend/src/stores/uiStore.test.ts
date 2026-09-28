import { beforeEach, describe, expect, it } from "vitest";
import { MAX_PANES, defaultPaneSearch, restorePanes, useUiStore } from "./uiStore";

const STORAGE_KEY = "logpane-ui";

function storedState(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}").state;
}

async function rehydrateFrom(state: unknown) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ state, version: 1 }));
  await useUiStore.persist.rehydrate();
}

describe("uiStore layout persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState({ panes: [], activePaneId: null, theme: "dark", sidebarCollapsed: false });
  });

  it("saves open panes and the active pane, but not search or autoscroll state", () => {
    const { openSource, openSourceInNewPane, updatePaneSearch, setPaneAutoscrollPaused } =
      useUiStore.getState();
    openSource("src-a");
    openSourceInNewPane("src-b");
    const [a, b] = useUiStore.getState().panes;
    updatePaneSearch(b.id, { query: "error" });
    setPaneAutoscrollPaused(b.id, true);

    expect(storedState()).toEqual({
      theme: "dark",
      sidebarCollapsed: false,
      panes: [
        { id: a.id, sourceId: "src-a" },
        { id: b.id, sourceId: "src-b" },
      ],
      activePaneId: b.id,
    });
  });

  it("restores the previous session's panes on reload", async () => {
    await rehydrateFrom({
      theme: "light",
      sidebarCollapsed: true,
      panes: [
        { id: "pane-1", sourceId: "src-a" },
        { id: "pane-2", sourceId: "src-b" },
      ],
      activePaneId: "pane-1",
    });

    const state = useUiStore.getState();
    expect(state.theme).toBe("light");
    expect(state.sidebarCollapsed).toBe(true);
    expect(state.activePaneId).toBe("pane-1");
    expect(state.panes).toEqual([
      { id: "pane-1", sourceId: "src-a", search: defaultPaneSearch(), autoscrollPaused: false },
      { id: "pane-2", sourceId: "src-b", search: defaultPaneSearch(), autoscrollPaused: false },
    ]);
  });

  it("keeps defaults for panes when storage predates layout persistence", async () => {
    await rehydrateFrom({ theme: "light", sidebarCollapsed: false });

    const state = useUiStore.getState();
    expect(state.theme).toBe("light");
    expect(state.panes).toEqual([]);
    expect(state.activePaneId).toBeNull();
  });
});

describe("restorePanes", () => {
  it("drops malformed entries and caps at MAX_PANES", () => {
    const { panes } = restorePanes({
      panes: [
        { id: "p1", sourceId: "a" },
        { id: "p2" },
        "junk",
        null,
        { id: "p3", sourceId: "b" },
        { id: "p4", sourceId: "c" },
        { id: "p5", sourceId: "d" },
        { id: "p6", sourceId: "e" },
      ],
    });
    expect(panes.map((p) => p.id)).toEqual(["p1", "p3", "p4", "p5"]);
    expect(panes).toHaveLength(MAX_PANES);
  });

  it("falls back to the last pane when the saved active pane is gone", () => {
    const restored = restorePanes({
      panes: [
        { id: "p1", sourceId: "a" },
        { id: "p2", sourceId: "b" },
      ],
      activePaneId: "p9",
    });
    expect(restored.activePaneId).toBe("p2");
  });

  it("handles missing or non-object input", () => {
    expect(restorePanes(undefined)).toEqual({ panes: [], activePaneId: null });
    expect(restorePanes({ panes: "nope" })).toEqual({ panes: [], activePaneId: null });
  });
});

describe("closePanesForMissingSources", () => {
  beforeEach(() => {
    useUiStore.setState({ panes: [], activePaneId: null });
  });

  it("closes panes whose source was deleted and refocuses a remaining pane", () => {
    const { openSource, openSourceInNewPane, closePanesForMissingSources } = useUiStore.getState();
    openSource("src-a");
    openSourceInNewPane("src-gone");
    const [a] = useUiStore.getState().panes;

    closePanesForMissingSources(["src-a", "src-other"]);

    const state = useUiStore.getState();
    expect(state.panes.map((p) => p.sourceId)).toEqual(["src-a"]);
    expect(state.activePaneId).toBe(a.id);
  });

  it("leaves state untouched when every source still exists", () => {
    const { openSource, closePanesForMissingSources } = useUiStore.getState();
    openSource("src-a");
    const before = useUiStore.getState().panes;

    closePanesForMissingSources(["src-a"]);

    expect(useUiStore.getState().panes).toBe(before);
  });
});
