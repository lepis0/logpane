import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { Sidebar } from "./components/layout/Sidebar";
import { PaneGrid } from "./components/layout/PaneGrid";
import { SourceManagerPage } from "./components/sources/SourceManagerPage";
import { focusPaneSearchInput } from "./lib/paneSearchRefs";
import { useUiStore } from "./stores/uiStore";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useSourcesChangedInvalidation } from "./api/sources";

export function App() {
  const theme = useUiStore((s) => s.theme);
  const activePaneId = useUiStore((s) => s.activePaneId);
  const [manageOpen, setManageOpen] = useState(false);

  useSourcesChangedInvalidation();

  // Keep the <html class="dark"> toggle (set synchronously pre-paint in index.html) in sync
  // with the persisted theme once React/zustand has hydrated.
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  useKeyboardShortcuts({
    onFocusSearch: () => {
      if (!activePaneId) return;
      focusPaneSearchInput(activePaneId);
    },
    onEscape: () => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.tagName === "INPUT") active.blur();
    },
  });

  return (
    <TooltipPrimitive.Provider>
      <div className="flex h-screen w-screen overflow-hidden bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        <Sidebar onManageSources={() => setManageOpen(true)} />
        <main className="min-w-0 flex-1 overflow-hidden">
          <PaneGrid />
        </main>
      </div>

      <SourceManagerPage open={manageOpen} onOpenChange={setManageOpen} />

      <Toaster theme={theme} position="bottom-right" richColors closeButton />
    </TooltipPrimitive.Provider>
  );
}
