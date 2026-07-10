import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Select from "@radix-ui/react-select";
import * as Switch from "@radix-ui/react-switch";
import { toast } from "sonner";
import { Check, ChevronDown, Folder, Loader2, X } from "lucide-react";
import { useCreateSource, useUpdateSource, useValidateSource } from "../../api/sources";
import type { Source, SourceType } from "../../types/source";
import { formatBytes } from "../../lib/format";
import { cn } from "../../lib/cn";
import { Button } from "../common/Button";
import { FileBrowserDialog } from "./FileBrowserDialog";

export interface SourceFormDialogProps {
  mode: "create" | "edit";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source?: Source;
}

interface FormState {
  name: string;
  type: SourceType;
  path: string;
  color: string;
  tags: string;
  excludePatterns: string;
  allowRoll: boolean;
  enabled: boolean;
}

const DEFAULT_COLOR = "#0ea5e9";

function emptyForm(): FormState {
  return {
    name: "",
    type: "file",
    path: "",
    color: DEFAULT_COLOR,
    tags: "",
    excludePatterns: "",
    allowRoll: false,
    enabled: true,
  };
}

function formFromSource(source: Source): FormState {
  return {
    name: source.name,
    type: source.type,
    path: source.path,
    color: source.color || DEFAULT_COLOR,
    tags: source.tags.join(", "),
    excludePatterns: source.excludePatterns.join("\n"),
    allowRoll: source.allowRoll,
    enabled: source.enabled,
  };
}

function dirname(path: string): string {
  return path.replace(/\/[^/]*$/, "") || "/";
}

function splitList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Create/edit dialog for a source. Validates the path against the backend before submit.
 *
 * Rendered with a `key` (see the default export below) that changes whenever the dialog
 * opens for a different target, so this component remounts with fresh form/validation
 * state instead of resetting it via an effect.
 */
function SourceFormDialogInner({ mode, open, onOpenChange, source }: SourceFormDialogProps) {
  const [form, setForm] = useState<FormState>(() => (source ? formFromSource(source) : emptyForm()));

  const createMutation = useCreateSource();
  const updateMutation = useUpdateSource();
  const validateMutation = useValidateSource();
  const [browseOpen, setBrowseOpen] = useState(false);

  const runValidate = (pathOverride?: string) => {
    const path = (pathOverride ?? form.path).trim();
    if (!path) return;
    validateMutation.mutate({
      type: form.type,
      path,
      excludePatterns: splitList(form.excludePatterns),
    });
  };

  const selectPath = (path: string) => {
    setForm((f) => ({ ...f, path }));
    runValidate(path);
    setBrowseOpen(false);
  };

  const saving = createMutation.isPending || updateMutation.isPending;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.name.trim() || !form.path.trim()) {
      toast.error("Name and path are required.");
      return;
    }

    const input = {
      name: form.name.trim(),
      path: form.path.trim(),
      color: form.color,
      tags: splitList(form.tags),
      excludePatterns: splitList(form.excludePatterns),
      allowRoll: form.allowRoll,
      enabled: form.enabled,
    };

    if (mode === "create") {
      createMutation.mutate(
        { ...input, type: form.type },
        {
          onSuccess: () => {
            toast.success(`Added source "${input.name}"`);
            onOpenChange(false);
          },
          onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to create source"),
        },
      );
    } else if (source) {
      updateMutation.mutate(
        { id: source.id, input },
        {
          onSuccess: () => {
            toast.success(`Saved "${input.name}"`);
            onOpenChange(false);
          },
          onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to save source"),
        },
      );
    }
  };

  const result = validateMutation.data;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[32rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-3 flex items-center justify-between">
            <Dialog.Title className="text-sm font-semibold">
              {mode === "create" ? "Add source" : "Edit source"}
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <X className="size-4" />
              </Button>
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-[1fr_auto] gap-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Name</span>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  required
                  className="w-full rounded-md border border-slate-300 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-sky-500 dark:border-slate-700"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Color</span>
                <input
                  type="color"
                  value={form.color}
                  onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                  className="h-[34px] w-12 cursor-pointer rounded-md border border-slate-300 bg-transparent dark:border-slate-700"
                />
              </label>
            </div>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Type</span>
              <Select.Root
                value={form.type}
                onValueChange={(value: SourceType) => setForm((f) => ({ ...f, type: value }))}
                disabled={mode === "edit"}
              >
                <Select.Trigger className="flex w-full items-center justify-between rounded-md border border-slate-300 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-sky-500 disabled:opacity-50 dark:border-slate-700">
                  <Select.Value />
                  <Select.Icon>
                    <ChevronDown className="size-4" />
                  </Select.Icon>
                </Select.Trigger>
                <Select.Portal>
                  <Select.Content className="z-50 overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
                    <Select.Viewport className="p-1">
                      <Select.Item
                        value="file"
                        className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-slate-100 dark:data-[highlighted]:bg-slate-700"
                      >
                        <Select.ItemIndicator>
                          <Check className="size-3.5" />
                        </Select.ItemIndicator>
                        <Select.ItemText>Single file</Select.ItemText>
                      </Select.Item>
                      <Select.Item
                        value="glob"
                        className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-slate-100 dark:data-[highlighted]:bg-slate-700"
                      >
                        <Select.ItemIndicator>
                          <Check className="size-3.5" />
                        </Select.ItemIndicator>
                        <Select.ItemText>Glob pattern</Select.ItemText>
                      </Select.Item>
                    </Select.Viewport>
                  </Select.Content>
                </Select.Portal>
              </Select.Root>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
                Path {form.type === "glob" && "(glob pattern)"}
              </span>
              <div className="flex gap-1.5">
                <input
                  value={form.path}
                  onChange={(e) => setForm((f) => ({ ...f, path: e.target.value }))}
                  onBlur={() => runValidate()}
                  required
                  placeholder={form.type === "glob" ? "/var/log/app/*.log" : "/var/log/app/current.log"}
                  className="w-full rounded-md border border-slate-300 bg-transparent px-2.5 py-1.5 font-mono text-sm outline-none focus:border-sky-500 dark:border-slate-700"
                />
                <Button
                  type="button"
                  size="icon"
                  aria-label="Browse"
                  onClick={() => setBrowseOpen(true)}
                >
                  <Folder className="size-4" />
                </Button>
              </div>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
                Exclude patterns (one per line)
              </span>
              <textarea
                value={form.excludePatterns}
                onChange={(e) => setForm((f) => ({ ...f, excludePatterns: e.target.value }))}
                onBlur={() => runValidate()}
                rows={2}
                placeholder="*.gz"
                className="w-full resize-none rounded-md border border-slate-300 bg-transparent px-2.5 py-1.5 font-mono text-sm outline-none focus:border-sky-500 dark:border-slate-700"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
                Tags (comma separated)
              </span>
              <input
                value={form.tags}
                onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
                placeholder="prod, api"
                className="w-full rounded-md border border-slate-300 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-sky-500 dark:border-slate-700"
              />
            </label>

            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 text-sm">
                <Switch.Root
                  checked={form.enabled}
                  onCheckedChange={(checked) => setForm((f) => ({ ...f, enabled: checked }))}
                  className="relative h-5 w-9 rounded-full bg-slate-300 outline-none transition-colors data-[state=checked]:bg-sky-500 dark:bg-slate-700"
                >
                  <Switch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white transition-transform data-[state=checked]:translate-x-[18px]" />
                </Switch.Root>
                Enabled
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch.Root
                  checked={form.allowRoll}
                  onCheckedChange={(checked) => setForm((f) => ({ ...f, allowRoll: checked }))}
                  className="relative h-5 w-9 rounded-full bg-slate-300 outline-none transition-colors data-[state=checked]:bg-sky-500 dark:bg-slate-700"
                >
                  <Switch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white transition-transform data-[state=checked]:translate-x-[18px]" />
                </Switch.Root>
                Allow roll
              </label>
            </div>

            <div
              className={cn(
                "rounded-md border px-2.5 py-2 text-xs",
                validateMutation.isPending
                  ? "border-slate-200 text-slate-400 dark:border-slate-700"
                  : result?.valid
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300"
                    : result
                      ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300"
                      : "border-slate-200 text-slate-400 dark:border-slate-700 dark:text-slate-500",
              )}
            >
              {validateMutation.isPending ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="size-3.5 animate-spin" /> Validating…
                </span>
              ) : result ? (
                <>
                  {result.message || (result.valid ? "Path looks good." : "Path is not valid.")}
                  {result.matchedFiles.length > 0 && (
                    <div className="mt-1 space-y-0.5 text-slate-500 dark:text-slate-400">
                      {result.matchedFiles.slice(0, 5).map((f) => (
                        <div key={f.file} className="truncate">
                          {f.file} &middot; {formatBytes(f.size)}
                        </div>
                      ))}
                      {result.matchedFiles.length > 5 && (
                        <div>and {result.matchedFiles.length - 5} more…</div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                "Path will be validated on blur."
              )}
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={saving}>
                {mode === "create" ? "Add source" : "Save changes"}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
      {browseOpen && (
        <FileBrowserDialog
          open={browseOpen}
          onOpenChange={setBrowseOpen}
          initialPath={form.path ? dirname(form.path) : "/"}
          mode={form.type === "glob" ? "directory" : "file"}
          onSelect={selectPath}
        />
      )}
    </Dialog.Root>
  );
}

/** Public entry point: remounts the form whenever it opens for a (possibly different) target. */
export function SourceFormDialog(props: SourceFormDialogProps) {
  return <SourceFormDialogInner key={`${props.source?.id ?? "new"}:${props.open}`} {...props} />;
}
