import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center", className)}>
      {icon && <div className="text-slate-400 dark:text-slate-600">{icon}</div>}
      <div className="space-y-1">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{title}</p>
        {description && (
          <p className="max-w-sm text-sm text-slate-500 dark:text-slate-400">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
