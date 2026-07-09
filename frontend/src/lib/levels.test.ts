import { describe, expect, it } from "vitest";
import { detectLogLevel } from "./levels";

describe("detectLogLevel", () => {
  it("matches bare severity words", () => {
    expect(detectLogLevel("2024-01-01T00:00:00Z ERROR something broke")).toBe("error");
    expect(detectLogLevel("a warning was logged: WARN disk almost full")).toBe("warn");
    expect(detectLogLevel("INFO server started on :8080")).toBe("info");
    expect(detectLogLevel("DEBUG cache miss for key foo")).toBe("debug");
  });

  it("matches bracketed tags", () => {
    expect(detectLogLevel("[ERROR] connection refused")).toBe("error");
    expect(detectLogLevel("[WARNING] retrying request")).toBe("warn");
    expect(detectLogLevel("[TRACE] entering function")).toBe("debug");
  });

  it("matches key=value and JSON-ish level fields", () => {
    expect(detectLogLevel("level=error msg=\"boom\"")).toBe("error");
    expect(detectLogLevel('{"level":"info","msg":"hello"}')).toBe("info");
    expect(detectLogLevel('{"level":"warning","msg":"careful"}')).toBe("warn");
  });

  it("treats FATAL and PANIC as error severity", () => {
    expect(detectLogLevel("FATAL: could not bind port")).toBe("error");
    expect(detectLogLevel("panic: runtime error: index out of range")).toBe("error");
  });

  it("is case-insensitive", () => {
    expect(detectLogLevel("error: lowercase still counts")).toBe("error");
  });

  it("returns null when no level keyword is present", () => {
    expect(detectLogLevel("just a plain line with no level")).toBeNull();
  });

  it("resolves ties by severity order when multiple keywords appear", () => {
    // "error" should win over "info" regardless of position.
    expect(detectLogLevel("INFO retrying after ERROR")).toBe("error");
  });
});
