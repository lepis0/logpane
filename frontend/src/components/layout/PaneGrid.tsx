import { Group, Panel, Separator } from "react-resizable-panels";
import { LayoutGrid } from "lucide-react";
import { useUiStore } from "../../stores/uiStore";
import { LogPane } from "../viewer/LogPane";
import { EmptyState } from "../common/EmptyState";

const SEPARATOR_CLASSNAME_H =
  "w-1.5 shrink-0 cursor-col-resize bg-slate-100 outline-none transition-colors hover:bg-sky-500/40 active:bg-sky-500/60 dark:bg-slate-900";
const SEPARATOR_CLASSNAME_V =
  "h-1.5 shrink-0 cursor-row-resize bg-slate-100 outline-none transition-colors hover:bg-sky-500/40 active:bg-sky-500/60 dark:bg-slate-900";

/**
 * Resizable multi-pane grid. 1 pane fills the space; 2 panes split side by
 * side; 3-4 panes form a resizable 2-row grid. All splits are draggable via
 * react-resizable-panels.
 */
export function PaneGrid() {
  const panes = useUiStore((s) => s.panes);

  if (panes.length === 0) {
    return (
      <EmptyState
        icon={<LayoutGrid className="size-10" />}
        title="No panes open"
        description="Pick a source from the sidebar to start tailing it here."
      />
    );
  }

  if (panes.length === 1) {
    return <LogPane pane={panes[0]} />;
  }

  if (panes.length === 2) {
    return (
      <Group orientation="horizontal" className="h-full">
        <Panel id={panes[0].id} minSize="20%" defaultSize="50%" className="h-full overflow-hidden">
          <LogPane pane={panes[0]} />
        </Panel>
        <Separator className={SEPARATOR_CLASSNAME_H} />
        <Panel id={panes[1].id} minSize="20%" defaultSize="50%" className="h-full overflow-hidden">
          <LogPane pane={panes[1]} />
        </Panel>
      </Group>
    );
  }

  const [a, b, c, d] = panes;
  return (
    <Group orientation="vertical" className="h-full">
      <Panel id={`${a.id}-row`} minSize="20%" defaultSize="50%" className="h-full overflow-hidden">
        <Group orientation="horizontal" className="h-full">
          <Panel id={a.id} minSize="20%" defaultSize="50%" className="h-full overflow-hidden">
            <LogPane pane={a} />
          </Panel>
          <Separator className={SEPARATOR_CLASSNAME_H} />
          <Panel id={b.id} minSize="20%" defaultSize="50%" className="h-full overflow-hidden">
            <LogPane pane={b} />
          </Panel>
        </Group>
      </Panel>
      <Separator className={SEPARATOR_CLASSNAME_V} />
      <Panel id={`${c.id}-row`} minSize="20%" defaultSize="50%" className="h-full overflow-hidden">
        {d ? (
          <Group orientation="horizontal" className="h-full">
            <Panel id={c.id} minSize="20%" defaultSize="50%" className="h-full overflow-hidden">
              <LogPane pane={c} />
            </Panel>
            <Separator className={SEPARATOR_CLASSNAME_H} />
            <Panel id={d.id} minSize="20%" defaultSize="50%" className="h-full overflow-hidden">
              <LogPane pane={d} />
            </Panel>
          </Group>
        ) : (
          <LogPane pane={c} />
        )}
      </Panel>
    </Group>
  );
}
