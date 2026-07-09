import { forwardRef, useImperativeHandle, useRef } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { ArrowDown, Loader2 } from "lucide-react";
import type { LogLineEntry } from "../../types/logLine";
import type { CompiledMatcher } from "../../lib/highlight";
import { LogLine } from "./LogLine";
import { useAutoscroll } from "../../hooks/useAutoscroll";
import { Button } from "../common/Button";

export interface VirtualizedLogListProps {
  paneId: string;
  entries: LogLineEntry[];
  matcher: CompiledMatcher;
  hasMoreHistory: boolean;
  loadingHistory: boolean;
  onLoadMore: () => void;
}

export interface VirtualizedLogListHandle {
  /** Scrolls to a specific entry index (used for search prev/next navigation). */
  scrollToIndex: (index: number) => void;
}

/**
 * Renders a pane's log lines with virtualization, autoscroll-follow behavior,
 * a "jump to latest" pill when scrolled away from the bottom, and top-reached
 * triggering of older-history pagination.
 */
export const VirtualizedLogList = forwardRef<VirtualizedLogListHandle, VirtualizedLogListProps>(
  function VirtualizedLogList(
    { paneId, entries, matcher, hasMoreHistory, loadingHistory, onLoadMore },
    ref,
  ) {
    const virtuosoRef = useRef<VirtuosoHandle>(null);
    const { paused, pendingCount, followOutput, handleAtBottomStateChange, resume } = useAutoscroll(
      paneId,
      entries.length,
    );

    useImperativeHandle(
      ref,
      () => ({
        scrollToIndex: (index) => {
          virtuosoRef.current?.scrollToIndex({ index, align: "center" });
        },
      }),
      [],
    );

    const jumpToLatest = () => {
      resume();
      virtuosoRef.current?.scrollToIndex({
        index: entries.length - 1,
        align: "end",
        behavior: "smooth",
      });
    };

    if (entries.length === 0) {
      return (
        <div className="flex flex-1 items-center justify-center text-sm text-slate-400 dark:text-slate-500">
          No lines to show yet.
        </div>
      );
    }

    return (
      <div className="relative min-h-0 flex-1">
        <Virtuoso
          ref={virtuosoRef}
          data={entries}
          computeItemKey={(_index, entry) => entry.offset}
          startReached={() => {
            if (hasMoreHistory && !loadingHistory) onLoadMore();
          }}
          followOutput={followOutput}
          atBottomStateChange={handleAtBottomStateChange}
          atBottomThreshold={24}
          alignToBottom
          initialTopMostItemIndex={entries.length - 1}
          itemContent={(_index, entry) => <LogLine entry={entry} matcher={matcher} />}
          components={{
            Header: () =>
              loadingHistory ? (
                <div className="flex items-center justify-center gap-2 py-2 text-xs text-slate-400 dark:text-slate-500">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  Loading older lines…
                </div>
              ) : null,
          }}
          className="h-full"
        />

        {paused && pendingCount > 0 && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
            <Button
              variant="primary"
              size="sm"
              className="pointer-events-auto shadow-lg"
              onClick={jumpToLatest}
            >
              <ArrowDown className="size-3.5" aria-hidden="true" />
              {pendingCount} new line{pendingCount === 1 ? "" : "s"} &middot; jump to latest
            </Button>
          </div>
        )}
      </div>
    );
  },
);
