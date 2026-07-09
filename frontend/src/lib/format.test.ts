import { describe, expect, it } from "vitest";
import { formatBytes } from "./format";

describe("formatBytes", () => {
  it("formats zero and small byte counts", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
  });

  it("formats kilobytes/megabytes with one decimal by default", () => {
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("returns a placeholder for missing or invalid input", () => {
    expect(formatBytes(undefined)).toBe("-");
    expect(formatBytes(null)).toBe("-");
    expect(formatBytes(-1)).toBe("-");
  });
});
