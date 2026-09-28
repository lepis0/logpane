import { useEffect, useRef } from "react";
import { useSources } from "../api/sources";
import { useUiStore } from "../stores/uiStore";

/**
 * Panes restored from the previous session may point at sources that were deleted in the
 * meantime. Once the source list has loaded for the first time, close those panes.
 * Later refetches are left alone so a source deleted mid-session doesn't yank its pane away.
 */
export function usePruneRestoredPanes(): void {
  const { data: sources } = useSources();
  const closePanesForMissingSources = useUiStore((s) => s.closePanesForMissingSources);
  const pruned = useRef(false);

  useEffect(() => {
    if (!sources || pruned.current) return;
    pruned.current = true;
    closePanesForMissingSources(sources.map((s) => s.id));
  }, [sources, closePanesForMissingSources]);
}
