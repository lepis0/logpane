import { useEffect, useRef } from "react";

export interface KeyboardShortcutHandlers {
  /** "/" - focus the active pane's search box (unless already typing somewhere). */
  onFocusSearch?: () => void;
  /** Escape - e.g. clear/blur the active search box. */
  onEscape?: () => void;
}

/** Light global keyboard shortcuts. Ignored while the user is typing in a field. */
export function useKeyboardShortcuts(handlers: KeyboardShortcutHandlers): void {
  const handlersRef = useRef(handlers);

  // Keep the ref in sync after each commit (not during render, per the rules of
  // React) so the listener below - registered once - always calls the latest handlers.
  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTyping =
        !!target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

      if (event.key === "/" && !isTyping) {
        event.preventDefault();
        handlersRef.current.onFocusSearch?.();
      } else if (event.key === "Escape") {
        handlersRef.current.onEscape?.();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
