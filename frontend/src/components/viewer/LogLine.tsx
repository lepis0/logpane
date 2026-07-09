import { memo } from "react";
import type { LogLineEntry } from "../../types/logLine";
import type { CompiledMatcher } from "../../lib/highlight";
import { buildSegments } from "../../lib/highlight";
import { detectLogLevel, LEVEL_TEXT_CLASSNAME } from "../../lib/levels";
import { formatClockTime } from "../../lib/format";
import { LevelBadge } from "./LevelBadge";
import { cn } from "../../lib/cn";

export interface LogLineProps {
  entry: LogLineEntry;
  matcher: CompiledMatcher;
  showBadge?: boolean;
}

export const LogLine = memo(function LogLine({ entry, matcher, showBadge = true }: LogLineProps) {
  const level = detectLogLevel(entry.text);
  const spans = matcher.matchAll(entry.text);
  const segments = buildSegments(entry.text, spans);

  return (
    <div className="flex items-start gap-2 px-3 py-0.5 font-mono text-[13px] leading-5 hover:bg-slate-100/70 dark:hover:bg-slate-800/40">
      <span className="shrink-0 select-none pt-px tabular-nums text-slate-400 dark:text-slate-600">
        {formatClockTime(entry.ts)}
      </span>
      {showBadge && level && <LevelBadge level={level} className="mt-px" />}
      <span
        className={cn(
          "min-w-0 flex-1 whitespace-pre-wrap break-all",
          level ? LEVEL_TEXT_CLASSNAME[level] : "text-slate-800 dark:text-slate-200",
        )}
      >
        {segments.map((segment, index) =>
          segment.matched ? (
            <mark
              key={index}
              className="rounded-sm bg-amber-300/70 text-slate-900 dark:bg-amber-500/40 dark:text-amber-50"
            >
              {segment.text}
            </mark>
          ) : (
            <span key={index}>{segment.text}</span>
          ),
        )}
      </span>
    </div>
  );
});
