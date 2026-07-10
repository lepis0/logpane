import { useState } from "react";
import { Plus, ScrollText, Settings } from "lucide-react";
import { useSources } from "../../api/sources";
import { isNetworkError } from "../../api/client";
import { useConnectionStatus } from "../../api/ws";
import { useUiStore } from "../../stores/uiStore";
import { Button } from "../common/Button";
import { Tooltip } from "../common/Tooltip";
import { EmptyState } from "../common/EmptyState";
import { ThemeToggle } from "../common/ThemeToggle";
import { HelpButton } from "../common/HelpButton";
import { SourceFormDialog } from "../sources/SourceFormDialog";
import { SourceListItem } from "./SourceListItem";

export interface SidebarProps {
  onManageSources: () => void;
}

export function Sidebar({ onManageSources }: SidebarProps) {
  const { data: sources, isLoading, isError, error } = useSources();
  const panes = useUiStore((s) => s.panes);
  const openSource = useUiStore((s) => s.openSource);
  const openSourceInNewPane = useUiStore((s) => s.openSourceInNewPane);
  const wsStatus = useConnectionStatus();
  const [addOpen, setAddOpen] = useState(false);

  const backendUnreachable = isError && isNetworkError(error);
  const showReconnectBanner = backendUnreachable || wsStatus === "reconnecting";

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-3 dark:border-slate-800">
        <ScrollText className="size-5 text-sky-500" aria-hidden="true" />
        <span className="flex-1 text-sm font-semibold tracking-tight">Logpane</span>
        <HelpButton />
        <ThemeToggle />
      </div>

      {showReconnectBanner && (
        <div className="border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300">
          {backendUnreachable ? "Backend unreachable — retrying…" : "Reconnecting…"}
        </div>
      )}

      <div className="flex items-center justify-between px-3 pt-3 pb-1.5">
        <span className="text-xs font-semibold tracking-wide text-slate-400 uppercase dark:text-slate-500">
          Sources
        </span>
        <div className="flex items-center gap-0.5">
          <Tooltip content="Manage sources">
            <Button variant="ghost" size="icon" onClick={onManageSources} aria-label="Manage sources">
              <Settings className="size-4" />
            </Button>
          </Tooltip>
          <Tooltip content="Add source">
            <Button variant="ghost" size="icon" onClick={() => setAddOpen(true)} aria-label="Add source">
              <Plus className="size-4" />
            </Button>
          </Tooltip>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {isLoading && <p className="px-2.5 py-4 text-sm text-slate-400">Loading sources…</p>}

        {!isLoading && !isError && (sources?.length ?? 0) === 0 && (
          <EmptyState
            title="No sources yet"
            description="Point Logpane at a log file or directory to start tailing it."
            action={
              <Button size="sm" onClick={() => setAddOpen(true)}>
                Add a source
              </Button>
            }
          />
        )}

        {!isLoading && isError && !backendUnreachable && (
          <p className="px-2.5 py-4 text-sm text-red-500">
            Failed to load sources{error instanceof Error ? `: ${error.message}` : "."}
          </p>
        )}

        <div className="space-y-0.5">
          {sources?.map((source) => (
            <SourceListItem
              key={source.id}
              source={source}
              active={panes.some((p) => p.sourceId === source.id)}
              onOpen={openSource}
              onOpenInNewPane={openSourceInNewPane}
            />
          ))}
        </div>
      </div>

      <SourceFormDialog mode="create" open={addOpen} onOpenChange={setAddOpen} />
    </aside>
  );
}
