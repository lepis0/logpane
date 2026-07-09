import { useEffect, useState } from "react";
import type { Source } from "../../types/source";
import { formatBytes, formatRelativeTime } from "../../lib/format";
import { isSourceLive, useLogStore } from "../../stores/logStore";
import { cn } from "../../lib/cn";

export interface SourceListItemProps {
  source: Source;
  active: boolean;
  onOpen: (sourceId: string) => void;
  onOpenInNewPane?: (sourceId: string) => void;
}

export function SourceListItem({ source, active, onOpen, onOpenInNewPane }: SourceListItemProps) {
  const logState = useLogStore((s) => s.bySource[source.id]);
  const [now, setNow] = useState(() => Date.now());

  // Re-render periodically so the live/idle indicator fades out a few seconds
  // after the last line, without needing a line-driven event to trigger it.
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 2000);
    return () => clearInterval(interval);
  }, []);

  const live = isSourceLive(logState, now);
  const errorMessage = logState?.lastError || (source.status.readable === false ? source.status.lastError : "");
  const hasError = !!errorMessage || source.status.readable === false;

  const indicatorClassName = hasError
    ? "bg-red-500"
    : live
      ? "bg-emerald-500 animate-live-pulse"
      : "bg-slate-300 dark:bg-slate-600";

  const indicatorLabel = hasError ? errorMessage || "Error" : live ? "Live" : "Idle";

  return (
    <button
      type="button"
      onClick={() => onOpen(source.id)}
      onAuxClick={(event) => {
        if (event.button === 1) onOpenInNewPane?.(source.id);
      }}
      title={errorMessage || source.path}
      className={cn(
        "group flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors",
        active
          ? "bg-sky-500/10 text-sky-700 dark:text-sky-300"
          : "text-slate-700 hover:bg-slate-200/60 dark:text-slate-300 dark:hover:bg-slate-800/70",
        !source.enabled && "opacity-50",
      )}
    >
      <span
        className="size-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: source.color || "#64748b" }}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{source.name}</span>
        <span className="block truncate text-xs text-slate-500 dark:text-slate-500">
          {formatBytes(source.status?.size)} &middot; {formatRelativeTime(source.status?.modTime)}
        </span>
      </span>
      <span
        className={cn("size-2 shrink-0 rounded-full", indicatorClassName)}
        aria-hidden="true"
        title={indicatorLabel}
      />
    </button>
  );
}
