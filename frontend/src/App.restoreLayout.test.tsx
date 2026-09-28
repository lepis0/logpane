import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { useUiStore } from "./stores/uiStore";
import type { Source } from "./types/source";

const sourceA: Source = {
  id: "src-a",
  name: "app.log",
  type: "file",
  path: "/var/log/app.log",
  color: "#0ea5e9",
  tags: [],
  excludePatterns: [],
  allowRoll: false,
  enabled: true,
  status: { activeFile: "", matchedFileCount: 1, size: 0, modTime: "", readable: true, lastError: "" },
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("App layout restore", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("reopens the previous session's panes and closes ones whose source was deleted", async () => {
    // jsdom has no ResizeObserver; react-resizable-panels needs one to mount a split Group.
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/lines")) return jsonResponse({ entries: [], hasMore: false });
      if (url.endsWith("/api/v1/sources")) return jsonResponse([sourceA]);
      throw new TypeError(`unexpected fetch ${url}`);
    });

    localStorage.setItem(
      "logpane-ui",
      JSON.stringify({
        state: {
          theme: "dark",
          sidebarCollapsed: false,
          panes: [
            { id: "pane-a", sourceId: "src-a" },
            { id: "pane-gone", sourceId: "src-deleted" },
          ],
          activePaneId: "pane-gone",
        },
        version: 1,
      }),
    );
    await useUiStore.persist.rehydrate();
    expect(useUiStore.getState().panes).toHaveLength(2);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>,
    );

    // The pane for the deleted source is closed and focus moves to the remaining one.
    await waitFor(() => expect(useUiStore.getState().panes.map((p) => p.id)).toEqual(["pane-a"]));
    expect(useUiStore.getState().activePaneId).toBe("pane-a");

    // The surviving pane is rendered with its source loaded.
    expect(await screen.findByRole("button", { name: "Close pane" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Search this pane/)).toBeInTheDocument();
  });
});
