import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LogLine } from "./LogLine";
import { compileMatcher } from "../../lib/highlight";
import type { LogLineEntry } from "../../types/logLine";

function entry(text: string, overrides: Partial<LogLineEntry> = {}): LogLineEntry {
  return { offset: 0, ts: "2024-01-01T00:00:00Z", text, file: "app.log", ...overrides };
}

describe("LogLine", () => {
  it("renders the line text and a level badge for a detected level", () => {
    const matcher = compileMatcher({ query: "", regex: false, caseSensitive: false });
    render(<LogLine entry={entry("[ERROR] connection refused")} matcher={matcher} />);

    expect(screen.getByText(/connection refused/)).toBeInTheDocument();
    expect(screen.getByText("ERROR")).toBeInTheDocument();
  });

  it("does not render a badge when no level is detected", () => {
    const matcher = compileMatcher({ query: "", regex: false, caseSensitive: false });
    render(<LogLine entry={entry("just a plain message")} matcher={matcher} />);

    expect(screen.queryByText("ERROR")).not.toBeInTheDocument();
    expect(screen.queryByText("INFO")).not.toBeInTheDocument();
  });

  it("wraps search matches in a <mark> element", () => {
    const matcher = compileMatcher({ query: "refused", regex: false, caseSensitive: false });
    render(<LogLine entry={entry("connection refused by peer")} matcher={matcher} />);

    const mark = screen.getByText("refused");
    expect(mark.tagName).toBe("MARK");
  });

  it("can hide the level badge via showBadge=false", () => {
    const matcher = compileMatcher({ query: "", regex: false, caseSensitive: false });
    render(<LogLine entry={entry("[WARN] disk almost full")} matcher={matcher} showBadge={false} />);

    expect(screen.queryByText("WARN")).not.toBeInTheDocument();
  });
});
