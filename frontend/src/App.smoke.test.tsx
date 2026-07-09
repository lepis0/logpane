import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

describe("App", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders without crashing when the backend is unreachable", async () => {
    // Simulate "backend unreachable": every fetch rejects, exactly like a real
    // network failure would (refused connection, DNS failure, etc.).
    vi.spyOn(global, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>,
    );

    // The shell renders immediately, before the failed sources fetch resolves.
    expect(screen.getByText("Logpane")).toBeInTheDocument();
    expect(screen.getByText("No panes open")).toBeInTheDocument();

    // Once the sources query fails, the reconnect banner appears instead of a crash.
    expect(await screen.findByText(/Backend unreachable/i)).toBeInTheDocument();
  });
});
