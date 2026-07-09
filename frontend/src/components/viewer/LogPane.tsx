import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Download, RotateCw, X } from "lucide-react";
import type { PaneState } from "../../stores/uiStore";
import { useUiStore } from "../../stores/uiStore";
import { useLogStore, isSourceLive } from "../../stores/logStore";
import { useSources, useRollSource, sourceDownloadUrl, fetchSourceLines } from "../../api/sources";
import { logStore } from "../../stores/logStore";
import { compileMatcher } from "../../lib/highlight";
import { formatBytes } from "../../lib/format";
import { cn } from "../../lib/cn";
import { setPaneSearchInputRef } from "../../lib/paneSearchRefs";
import { useWebSocketFeed } from "../../hooks/useWebSocketFeed";
import { Button } from "../common/Button";
import { Tooltip } from "../common/Tooltip";
import { EmptyState } from "../common/EmptyState";
import { SearchBar } from "./SearchBar";
import { VirtualizedLogList, type VirtualizedLogListHandle } from "./VirtualizedLogList";
import type { LogLineEntry } from "../../types/logLine";

const EMPTY_ENTRIES: LogLineEntry[] = [];

export interface LogPaneProps {
  pane: PaneState;
}

export function LogPane({ pane }: LogPaneProps) {
  const { data: sources } = useSources();
  const source = sources?.find((s) => s.id === pane.sourceId);

  const activePaneId = useUiStore((s) => s.activePaneId);
  const setActivePane = useUiStore((s) => s.setActivePane);
  const closePane = useUiStore((s) => s.closePane);
  const isActive = activePaneId === pane.id;

  useWebSocketFeed(pane.sourceId ?? undefined);

  const logState = useLogStore((s) => (pane.sourceId ? s.bySource[pane.sourceId] : undefined));
  const entries = logState?.entries ?? EMPTY_ENTRIES;

  // Re-render periodically so the "live" indicator fades back to idle a few
  // seconds after the last line, without reading Date.now() during render.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 2000);
    return () => clearInterval(interval);
  }, []);

  const matcher = useMemo(
    () => compileMatcher(pane.search),
    // Deliberately excludes `pane.search.onlyMatching`, which compileMatcher never reads -
    // recompiling on every filter toggle would be wasted work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pane.search.query, pane.search.regex, pane.search.caseSensitive],
  );

  const displayEntries = useMemo(() => {
    if (!pane.search.query || !pane.search.onlyMatching) return entries;
    return entries.filter((entry) => matcher.test(entry.text));
  }, [entries, matcher, pane.search.query, pane.search.onlyMatching]);

  // Positions (within displayEntries) of matching lines - computed once per buffer/filter change,
  // then reused for both the match-count display and prev/next navigation.
  const matchIndices = useMemo(() => {
    if (!pane.search.query) return [];
    const indices: number[] = [];
    for (let i = 0; i < displayEntries.length; i++) {
      if (matcher.test(displayEntries[i].text)) indices.push(i);
    }
    return indices;
  }, [displayEntries, matcher, pane.search.query]);

  const [matchCursor, setMatchCursor] = useState(0);
  const clampedCursor = matchIndices.length > 0 ? matchCursor % matchIndices.length : -1;

  const listRef = useRef<VirtualizedLogListHandle>(null);

  const goToMatch = (cursor: number) => {
    setMatchCursor(cursor);
    if (matchIndices.length === 0) return;
    const wrapped = ((cursor % matchIndices.length) + matchIndices.length) % matchIndices.length;
    listRef.current?.scrollToIndex(matchIndices[wrapped]);
  };

  const rollMutation = useRollSource();

  const handleLoadMore = () => {
    if (!pane.sourceId || !logState || logState.loadingHistory || !logState.hasMoreHistory) return;
    const sourceId = pane.sourceId;
    logStore.getState().setLoadingHistory(sourceId, true);
    fetchSourceLines(sourceId, { before: logState.minOffsetSeen ?? undefined, limit: 1000 })
      .then((page) => {
        logStore.getState().prependHistory(sourceId, page.entries, page.hasMore);
      })
      .catch(() => {
        logStore.getState().setLoadingHistory(sourceId, false);
      });
  };

  const handleRoll = () => {
    if (!source) return;
    if (!window.confirm(`Roll "${source.name}"? This truncates the active log file after archiving it.`)) {
      return;
    }
    rollMutation.mutate(source.id, {
      onSuccess: () => toast.success(`Rolled ${source.name}`),
      onError: (err) => {
        const message = err instanceof Error ? err.message : "Roll failed";
        toast.error(message);
      },
    });
  };

  if (!pane.sourceId || !source) {
    return (
      <div
        className="flex h-full flex-col"
        onMouseDown={() => setActivePane(pane.id)}
      >
        <EmptyState title="No source selected" description="Pick a source from the sidebar." />
      </div>
    );
  }

  const live = isSourceLive(logState, now);
  const hasError = !!logState?.lastError || source.status.readable === false;

  return (
    <div
      className={cn(
        "flex h-full flex-col overflow-hidden bg-white dark:bg-slate-950",
        isActive && "ring-1 ring-inset ring-sky-500/40",
      )}
      onMouseDown={() => setActivePane(pane.id)}
    >
      <div className="flex items-center gap-2 border-b border-slate-200 px-2.5 py-1.5 dark:border-slate-800">
        <span
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: source.color || "#64748b" }}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={source.path}>
          {source.name}
        </span>
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            hasError ? "bg-red-500" : live ? "bg-emerald-500 animate-live-pulse" : "bg-slate-300 dark:bg-slate-600",
          )}
          aria-hidden="true"
        />
        <span className="shrink-0 text-xs text-slate-400 dark:text-slate-500">
          {formatBytes(source.status?.size)}
        </span>

        {source.allowRoll && (
          <Tooltip content="Roll (archive + truncate)">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleRoll}
              loading={rollMutation.isPending}
              aria-label="Roll source"
            >
              <RotateCw className="size-4" />
            </Button>
          </Tooltip>
        )}

        {source.status.activeFile && (
          <Tooltip content="Download current file">
            <a
              href={sourceDownloadUrl(source.id, source.status.activeFile)}
              download
              className="inline-flex size-8 items-center justify-center rounded-md text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              aria-label="Download current file"
            >
              <Download className="size-4" />
            </a>
          </Tooltip>
        )}

        <Tooltip content="Close pane">
          <Button variant="ghost" size="icon" onClick={() => closePane(pane.id)} aria-label="Close pane">
            <X className="size-4" />
          </Button>
        </Tooltip>
      </div>

      <SearchBar
        ref={(el) => setPaneSearchInputRef(pane.id, el)}
        paneId={pane.id}
        matchCount={matchIndices.length}
        currentMatchIndex={clampedCursor}
        onPrevMatch={() => goToMatch(matchCursor - 1)}
        onNextMatch={() => goToMatch(matchCursor + 1)}
        error={matcher.error}
      />

      {logState?.trimmed && (
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-2.5 py-1 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="flex-1">Older lines were dropped to limit memory usage.</span>
          <button
            type="button"
            onClick={() => pane.sourceId && logStore.getState().dismissTrimmed(pane.sourceId)}
            className="shrink-0 underline underline-offset-2"
          >
            Dismiss
          </button>
        </div>
      )}

      {logState?.lastError && (
        <div className="flex items-center gap-2 border-b border-red-200 bg-red-50 px-2.5 py-1 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate" title={logState.lastError}>
            {logState.lastError}
          </span>
          <button
            type="button"
            onClick={() => pane.sourceId && logStore.getState().markError(pane.sourceId, "")}
            className="shrink-0 underline underline-offset-2"
          >
            Dismiss
          </button>
        </div>
      )}

      <VirtualizedLogList
        ref={listRef}
        paneId={pane.id}
        entries={displayEntries}
        matcher={matcher}
        hasMoreHistory={logState?.hasMoreHistory ?? false}
        loadingHistory={logState?.loadingHistory ?? false}
        onLoadMore={handleLoadMore}
      />
    </div>
  );
}
