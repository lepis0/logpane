import * as Dialog from "@radix-ui/react-dialog";
import { ArrowUp, File, Folder, FolderOpen, HelpCircle, Loader2, X } from "lucide-react";
import { useState } from "react";
import { useBrowseDir } from "../../api/sources";
import type { BrowseEntry } from "../../types/source";
import { formatBytes, formatRelativeTime } from "../../lib/format";
import { cn } from "../../lib/cn";
import { Button } from "../common/Button";
import { EmptyState } from "../common/EmptyState";

export interface FileBrowserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialPath: string;
  /** "file" lets the user pick a file; "directory" lets them pick the current folder. */
  mode: "file" | "directory";
  onSelect: (path: string) => void;
}

function entryIcon(entry: BrowseEntry) {
  if (entry.type === "dir") return <Folder className="size-4 shrink-0 text-slate-400 dark:text-slate-500" />;
  if (entry.type === "file") return <File className="size-4 shrink-0 text-slate-400 dark:text-slate-500" />;
  return <HelpCircle className="size-4 shrink-0 text-slate-400 dark:text-slate-500" />;
}

/**
 * Lets the user browse the server's filesystem instead of typing a source path by hand.
 * Rendered only while the trigger has it open (see SourceFormDialog), so each open starts
 * fresh from `initialPath` rather than needing to reset state via an effect.
 */
export function FileBrowserDialog({ open, onOpenChange, initialPath, mode, onSelect }: FileBrowserDialogProps) {
  const [path, setPath] = useState(initialPath);
  const { data, isLoading } = useBrowseDir(path, open);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-[60] flex h-[28rem] w-[34rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-3 flex items-center justify-between">
            <Dialog.Title className="text-sm font-semibold">
              {mode === "file" ? "Select a file" : "Select a folder"}
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <X className="size-4" />
              </Button>
            </Dialog.Close>
          </div>

          <div className="mb-2 flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon"
              disabled={!data?.parent}
              onClick={() => data?.parent && setPath(data.parent)}
              aria-label="Go up"
            >
              <ArrowUp className="size-4" />
            </Button>
            <span className="min-w-0 flex-1 truncate rounded-md bg-slate-100 px-2.5 py-1.5 font-mono text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {data?.path ?? path}
            </span>
            {mode === "directory" && (
              <Button size="sm" onClick={() => onSelect(data?.path ?? path)}>
                <FolderOpen className="size-4" /> Select this folder
              </Button>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-800">
            {isLoading && (
              <div className="flex h-full items-center justify-center text-slate-400">
                <Loader2 className="size-5 animate-spin" />
              </div>
            )}

            {!isLoading && data && !data.readable && (
              <EmptyState title="Can't read this location" description={data.message || undefined} />
            )}

            {!isLoading && data?.readable && data.entries.length === 0 && (
              <EmptyState title="Empty directory" />
            )}

            {!isLoading && data?.readable && data.entries.length > 0 && (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.entries.map((entry) => {
                  const selectable = entry.type === "file" && mode === "file";
                  const navigable = entry.type === "dir";
                  const clickable = selectable || navigable;
                  return (
                    <li key={entry.path}>
                      <button
                        type="button"
                        disabled={!clickable}
                        onClick={() => {
                          if (navigable) setPath(entry.path);
                          else if (selectable) onSelect(entry.path);
                        }}
                        className={cn(
                          "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm",
                          clickable
                            ? "hover:bg-slate-100 dark:hover:bg-slate-800"
                            : "cursor-default opacity-50",
                        )}
                      >
                        {entryIcon(entry)}
                        <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                        {entry.type === "file" && (
                          <span className="shrink-0 text-xs text-slate-400 dark:text-slate-500">
                            {formatBytes(entry.size)}
                          </span>
                        )}
                        <span className="w-20 shrink-0 text-right text-xs text-slate-400 dark:text-slate-500">
                          {formatRelativeTime(entry.modTime)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
