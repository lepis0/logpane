import { useCallback, useState } from "react";
import { useUiStore } from "../stores/uiStore";

export interface UseAutoscrollResult {
  paused: boolean;
  /** How many lines have arrived since autoscroll was paused - drives the "N new lines" pill. */
  pendingCount: number;
  /** Pass directly to Virtuoso's `followOutput` prop. */
  followOutput: (atBottom: boolean) => "smooth" | false;
  /** Pass directly to Virtuoso's `atBottomStateChange` prop. */
  handleAtBottomStateChange: (atBottom: boolean) => void;
  /** Call when the user clicks the "jump to latest" pill. */
  resume: () => void;
}

/**
 * Drives pause/resume-on-scroll for a single log pane. Scrolling away from the
 * bottom pauses following (the pane shows a "jump to latest" pill); scrolling
 * back to the bottom - or clicking the pill - resumes it.
 */
export function useAutoscroll(paneId: string, totalCount: number): UseAutoscrollResult {
  const paused = useUiStore((s) => s.panes.find((p) => p.id === paneId)?.autoscrollPaused ?? false);
  const setPaneAutoscrollPaused = useUiStore((s) => s.setPaneAutoscrollPaused);
  // The item count at the moment autoscroll was paused, so pendingCount can be derived
  // during render instead of reading a mutable ref there (refs should only be touched
  // in effects/handlers, not read during render).
  const [pausedAtCount, setPausedAtCount] = useState<number | null>(null);

  const handleAtBottomStateChange = useCallback(
    (atBottom: boolean) => {
      if (atBottom) {
        setPausedAtCount(null);
        setPaneAutoscrollPaused(paneId, false);
      } else {
        setPausedAtCount((prev) => prev ?? totalCount);
        setPaneAutoscrollPaused(paneId, true);
      }
    },
    [paneId, setPaneAutoscrollPaused, totalCount],
  );

  const resume = useCallback(() => {
    setPausedAtCount(null);
    setPaneAutoscrollPaused(paneId, false);
  }, [paneId, setPaneAutoscrollPaused]);

  // Function form (not a static `true`) intentionally - avoids losing "stick to
  // bottom" during very fast append bursts.
  const followOutput = useCallback((atBottom: boolean): "smooth" | false => (atBottom ? "smooth" : false), []);

  const pendingCount = paused && pausedAtCount !== null ? Math.max(0, totalCount - pausedAtCount) : 0;

  return { paused, pendingCount, followOutput, handleAtBottomStateChange, resume };
}
