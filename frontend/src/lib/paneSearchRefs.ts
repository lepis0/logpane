/** Registry of each pane's search `<input>` element, keyed by pane id. */
const refs = new Map<string, HTMLInputElement | null>();

export function setPaneSearchInputRef(paneId: string, el: HTMLInputElement | null): void {
  refs.set(paneId, el);
}

/** Used by the global "/" shortcut to focus the active pane's search box. */
export function focusPaneSearchInput(paneId: string): void {
  refs.get(paneId)?.focus();
}
