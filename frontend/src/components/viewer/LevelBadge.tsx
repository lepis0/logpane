import { LEVEL_BADGE_CLASSNAME, LEVEL_LABEL, type LogLevel } from "../../lib/levels";
import { cn } from "../../lib/cn";

export interface LevelBadgeProps {
  level: LogLevel | null;
  className?: string;
}

export function LevelBadge({ level, className }: LevelBadgeProps) {
  if (!level) return null;
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded border px-1.5 text-[10px] font-semibold tracking-wide",
        LEVEL_BADGE_CLASSNAME[level],
        className,
      )}
    >
      {LEVEL_LABEL[level]}
    </span>
  );
}
