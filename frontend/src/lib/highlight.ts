/** Search configuration for a pane's search bar. */
export interface SearchOptions {
  query: string;
  regex: boolean;
  caseSensitive: boolean;
}

export interface MatchSpan {
  start: number;
  end: number;
}

export interface Segment {
  text: string;
  matched: boolean;
}

export interface CompiledMatcher {
  /** Cheap whole-line predicate, used to filter/count matches across the whole buffer. */
  test: (line: string) => boolean;
  /** Match spans for a single line, used only for rendering highlights on mounted rows. */
  matchAll: (line: string) => MatchSpan[];
  /** Set when `regex` mode produced an invalid pattern; matching degrades to "match everything". */
  error?: string;
}

const MAX_MATCHES_PER_LINE = 2000; // safety valve against pathological patterns

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Compile a `SearchOptions` into a reusable matcher. Never throws - invalid regex is reported via `.error`. */
export function compileMatcher({ query, regex, caseSensitive }: SearchOptions): CompiledMatcher {
  if (!query) {
    return { test: () => true, matchAll: () => [] };
  }

  const source = regex ? query : escapeRegExp(query);
  let re: RegExp;
  try {
    re = new RegExp(source, caseSensitive ? "g" : "gi");
  } catch (err) {
    return {
      test: () => true,
      matchAll: () => [],
      error: err instanceof Error ? err.message : "Invalid pattern",
    };
  }

  return {
    test: (line) => {
      re.lastIndex = 0;
      return re.test(line);
    },
    matchAll: (line) => {
      re.lastIndex = 0;
      const spans: MatchSpan[] = [];
      let match: RegExpExecArray | null;
      let guard = 0;
      while ((match = re.exec(line)) !== null) {
        const text = match[0];
        if (text.length === 0) {
          // Zero-width match (e.g. pattern `a*`) - advance manually to avoid looping forever.
          re.lastIndex += 1;
          if (re.lastIndex > line.length) break;
          continue;
        }
        spans.push({ start: match.index, end: match.index + text.length });
        if (++guard >= MAX_MATCHES_PER_LINE) break;
      }
      return spans;
    },
  };
}

/** Turn match spans into ordered renderable segments covering the entire line. */
export function buildSegments(line: string, spans: MatchSpan[]): Segment[] {
  if (spans.length === 0) return [{ text: line, matched: false }];
  const segments: Segment[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor) {
      segments.push({ text: line.slice(cursor, span.start), matched: false });
    }
    if (span.end > span.start) {
      segments.push({ text: line.slice(span.start, span.end), matched: true });
    }
    cursor = Math.max(cursor, span.end);
  }
  if (cursor < line.length) {
    segments.push({ text: line.slice(cursor), matched: false });
  }
  return segments;
}
