import { describe, expect, it } from "vitest";
import { buildSegments, compileMatcher } from "./highlight";

describe("compileMatcher", () => {
  it("matches everything when the query is empty", () => {
    const matcher = compileMatcher({ query: "", regex: false, caseSensitive: false });
    expect(matcher.test("anything at all")).toBe(true);
    expect(matcher.matchAll("anything at all")).toEqual([]);
  });

  it("performs a case-insensitive plain-text search by default", () => {
    const matcher = compileMatcher({ query: "error", regex: false, caseSensitive: false });
    expect(matcher.test("an ERROR occurred")).toBe(true);
    expect(matcher.matchAll("an ERROR occurred")).toEqual([{ start: 3, end: 8 }]);
  });

  it("respects case sensitivity when enabled", () => {
    const matcher = compileMatcher({ query: "Error", regex: false, caseSensitive: true });
    expect(matcher.test("an error occurred")).toBe(false);
    expect(matcher.test("an Error occurred")).toBe(true);
  });

  it("escapes regex metacharacters in plain-text mode", () => {
    const matcher = compileMatcher({ query: "a.b[c]", regex: false, caseSensitive: false });
    expect(matcher.test("literal a.b[c] here")).toBe(true);
    expect(matcher.test("axbxcx here")).toBe(false);
  });

  it("supports regex mode and finds multiple matches per line", () => {
    const matcher = compileMatcher({ query: "\\d+", regex: true, caseSensitive: false });
    expect(matcher.matchAll("request 12 took 345ms")).toEqual([
      { start: 8, end: 10 },
      { start: 16, end: 19 },
    ]);
  });

  it("never throws on invalid regex - degrades to match-everything with an error message", () => {
    const matcher = compileMatcher({ query: "(unclosed", regex: true, caseSensitive: false });
    expect(matcher.error).toBeTruthy();
    expect(() => matcher.test("anything")).not.toThrow();
    expect(matcher.test("anything")).toBe(true);
    expect(matcher.matchAll("anything")).toEqual([]);
  });

  it("does not loop forever on zero-width matches", () => {
    const matcher = compileMatcher({ query: "a*", regex: true, caseSensitive: false });
    expect(() => matcher.matchAll("bbb")).not.toThrow();
  });
});

describe("buildSegments", () => {
  it("returns the whole line unmatched when there are no spans", () => {
    expect(buildSegments("hello world", [])).toEqual([{ text: "hello world", matched: false }]);
  });

  it("splits the line around a single match", () => {
    expect(buildSegments("hello world", [{ start: 6, end: 11 }])).toEqual([
      { text: "hello ", matched: false },
      { text: "world", matched: true },
    ]);
  });

  it("handles a match at the very start of the line", () => {
    expect(buildSegments("world hello", [{ start: 0, end: 5 }])).toEqual([
      { text: "world", matched: true },
      { text: " hello", matched: false },
    ]);
  });

  it("handles multiple non-adjacent matches", () => {
    expect(
      buildSegments("foo bar foo", [
        { start: 0, end: 3 },
        { start: 8, end: 11 },
      ]),
    ).toEqual([
      { text: "foo", matched: true },
      { text: " bar ", matched: false },
      { text: "foo", matched: true },
    ]);
  });
});
