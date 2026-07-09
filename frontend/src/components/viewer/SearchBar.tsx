import { forwardRef } from "react";
import { CaseSensitive, ChevronDown, ChevronUp, Regex, X } from "lucide-react";
import { useUiStore } from "../../stores/uiStore";
import { Button } from "../common/Button";
import { Tooltip } from "../common/Tooltip";

export interface SearchBarProps {
  paneId: string;
  matchCount: number;
  /** -1 when there is no current match. */
  currentMatchIndex: number;
  onPrevMatch: () => void;
  onNextMatch: () => void;
  error?: string;
}

export const SearchBar = forwardRef<HTMLInputElement, SearchBarProps>(function SearchBar(
  { paneId, matchCount, currentMatchIndex, onPrevMatch, onNextMatch, error },
  ref,
) {
  const search = useUiStore((s) => s.panes.find((p) => p.id === paneId)?.search);
  const updateSearch = useUiStore((s) => s.updatePaneSearch);

  if (!search) return null;

  return (
    <div className="flex items-center gap-0.5 border-b border-slate-200 bg-white px-2 py-1.5 dark:border-slate-800 dark:bg-slate-900">
      <input
        ref={ref}
        type="text"
        value={search.query}
        onChange={(event) => updateSearch(paneId, { query: event.target.value })}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (event.shiftKey) onPrevMatch();
            else onNextMatch();
          }
        }}
        placeholder="Search this pane… ( / to focus )"
        aria-label="Search log lines"
        className="min-w-0 flex-1 rounded-md bg-transparent px-1.5 py-1 text-sm outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500"
      />

      {search.query && (
        <span className="shrink-0 px-1 text-xs tabular-nums text-slate-400">
          {matchCount > 0 ? `${currentMatchIndex + 1}/${matchCount}` : "0/0"}
        </span>
      )}

      <Tooltip content="Previous match">
        <Button
          variant="ghost"
          size="icon"
          onClick={onPrevMatch}
          disabled={matchCount === 0}
          aria-label="Previous match"
        >
          <ChevronUp className="size-4" />
        </Button>
      </Tooltip>
      <Tooltip content="Next match">
        <Button
          variant="ghost"
          size="icon"
          onClick={onNextMatch}
          disabled={matchCount === 0}
          aria-label="Next match"
        >
          <ChevronDown className="size-4" />
        </Button>
      </Tooltip>

      <div className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" aria-hidden="true" />

      <Tooltip content="Match case">
        <Button
          variant={search.caseSensitive ? "primary" : "ghost"}
          size="icon"
          onClick={() => updateSearch(paneId, { caseSensitive: !search.caseSensitive })}
          aria-pressed={search.caseSensitive}
          aria-label="Toggle case sensitivity"
        >
          <CaseSensitive className="size-4" />
        </Button>
      </Tooltip>
      <Tooltip content="Use regex">
        <Button
          variant={search.regex ? "primary" : "ghost"}
          size="icon"
          onClick={() => updateSearch(paneId, { regex: !search.regex })}
          aria-pressed={search.regex}
          aria-label="Toggle regex mode"
        >
          <Regex className="size-4" />
        </Button>
      </Tooltip>
      <Tooltip content="Only matching lines">
        <Button
          variant={search.onlyMatching ? "primary" : "ghost"}
          size="sm"
          onClick={() => updateSearch(paneId, { onlyMatching: !search.onlyMatching })}
          aria-pressed={search.onlyMatching}
        >
          Only matching
        </Button>
      </Tooltip>

      {search.query && (
        <Tooltip content="Clear search">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => updateSearch(paneId, { query: "" })}
            aria-label="Clear search"
          >
            <X className="size-4" />
          </Button>
        </Tooltip>
      )}

      {error && (
        <span className="ml-1 shrink-0 truncate text-xs text-red-500" title={error}>
          Invalid regex
        </span>
      )}
    </div>
  );
});
