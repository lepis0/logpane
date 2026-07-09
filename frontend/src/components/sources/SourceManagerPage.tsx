import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import { Download, Pencil, Plus, RotateCw, Trash2, X } from "lucide-react";
import { useDeleteSource, useRollSource, useSources, sourceDownloadUrl } from "../../api/sources";
import type { Source } from "../../types/source";
import { formatBytes, formatRelativeTime } from "../../lib/format";
import { Button } from "../common/Button";
import { Tooltip } from "../common/Tooltip";
import { EmptyState } from "../common/EmptyState";
import { SourceFormDialog } from "./SourceFormDialog";

export interface SourceManagerPageProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Full source list with create/edit/delete/roll/download - opened from the sidebar's manage button. */
export function SourceManagerPage({ open, onOpenChange }: SourceManagerPageProps) {
  const { data: sources, isLoading } = useSources();
  const deleteMutation = useDeleteSource();
  const rollMutation = useRollSource();

  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Source | null>(null);

  const handleDelete = (source: Source) => {
    if (!window.confirm(`Remove source "${source.name}"? This only stops tracking it - files on disk are untouched.`)) {
      return;
    }
    deleteMutation.mutate(source.id, {
      onSuccess: () => toast.success(`Removed "${source.name}"`),
      onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to remove source"),
    });
  };

  const handleRoll = (source: Source) => {
    if (!window.confirm(`Roll "${source.name}"? This truncates the active log file after archiving it.`)) {
      return;
    }
    rollMutation.mutate(source.id, {
      onSuccess: () => toast.success(`Rolled ${source.name}`),
      onError: (err) => toast.error(err instanceof Error ? err.message : "Roll failed"),
    });
  };

  return (
    <>
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex h-[36rem] w-[46rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <div className="mb-3 flex items-center justify-between">
              <Dialog.Title className="text-sm font-semibold">Manage sources</Dialog.Title>
              <div className="flex items-center gap-1.5">
                <Button size="sm" onClick={() => setAddOpen(true)}>
                  <Plus className="size-4" /> Add source
                </Button>
                <Dialog.Close asChild>
                  <Button variant="ghost" size="icon" aria-label="Close">
                    <X className="size-4" />
                  </Button>
                </Dialog.Close>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-800">
              {isLoading && <p className="p-4 text-sm text-slate-400">Loading…</p>}

              {!isLoading && (sources?.length ?? 0) === 0 && (
                <EmptyState
                  title="No sources yet"
                  description="Add a log file or glob pattern to start tailing it."
                  action={<Button size="sm" onClick={() => setAddOpen(true)}>Add a source</Button>}
                />
              )}

              {!isLoading && (sources?.length ?? 0) > 0 && (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-left text-xs text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                    <tr>
                      <th className="px-3 py-2 font-medium">Name</th>
                      <th className="px-3 py-2 font-medium">Path</th>
                      <th className="px-3 py-2 font-medium">Size</th>
                      <th className="px-3 py-2 font-medium">Last active</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {sources?.map((source) => (
                      <tr key={source.id} className={!source.enabled ? "opacity-50" : undefined}>
                        <td className="px-3 py-2">
                          <span className="flex items-center gap-2">
                            <span
                              className="size-2.5 shrink-0 rounded-full"
                              style={{ backgroundColor: source.color || "#64748b" }}
                              aria-hidden="true"
                            />
                            <span className="truncate font-medium">{source.name}</span>
                          </span>
                        </td>
                        <td className="max-w-[12rem] truncate px-3 py-2 font-mono text-xs text-slate-500 dark:text-slate-400" title={source.path}>
                          {source.path}
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                          {formatBytes(source.status?.size)}
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                          {formatRelativeTime(source.status?.modTime)}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {source.status.readable === false ? (
                            <span className="text-red-500" title={source.status.lastError}>
                              Error
                            </span>
                          ) : (
                            <span className="text-emerald-600 dark:text-emerald-400">OK</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-end gap-0.5">
                            {source.allowRoll && (
                              <Tooltip content="Roll">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleRoll(source)}
                                  aria-label={`Roll ${source.name}`}
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
                                  aria-label={`Download ${source.name}`}
                                >
                                  <Download className="size-4" />
                                </a>
                              </Tooltip>
                            )}
                            <Tooltip content="Edit">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setEditing(source)}
                                aria-label={`Edit ${source.name}`}
                              >
                                <Pencil className="size-4" />
                              </Button>
                            </Tooltip>
                            <Tooltip content="Remove">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDelete(source)}
                                aria-label={`Remove ${source.name}`}
                              >
                                <Trash2 className="size-4" />
                              </Button>
                            </Tooltip>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <SourceFormDialog mode="create" open={addOpen} onOpenChange={setAddOpen} />
      {editing && (
        <SourceFormDialog
          mode="edit"
          source={editing}
          open={!!editing}
          onOpenChange={(next) => {
            if (!next) setEditing(null);
          }}
        />
      )}
    </>
  );
}
