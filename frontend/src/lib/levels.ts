export type LogLevel = "error" | "warn" | "info" | "debug";

interface LevelRule {
  level: LogLevel;
  regex: RegExp;
}

// Checked in severity order so a single rule per line wins deterministically.
// Each pattern matches bare words ("ERROR doing x"), bracketed tags
// ("[ERROR]"), and key/value or JSON-ish styles ("level=error", `"level":"error"`).
const LEVEL_RULES: LevelRule[] = [
  {
    level: "error",
    regex: /\b(?:FATAL|PANIC|ERROR)\b|\[(?:FATAL|PANIC|ERROR)\]|"?level"?\s*[:=]\s*"?(?:fatal|panic|error)"?/i,
  },
  {
    level: "warn",
    regex: /\bWARN(?:ING)?\b|\[WARN(?:ING)?\]|"?level"?\s*[:=]\s*"?warn(?:ing)?"?/i,
  },
  {
    level: "info",
    regex: /\bINFO\b|\[INFO\]|"?level"?\s*[:=]\s*"?info"?/i,
  },
  {
    level: "debug",
    regex: /\b(?:DEBUG|TRACE)\b|\[(?:DEBUG|TRACE)\]|"?level"?\s*[:=]\s*"?(?:debug|trace)"?/i,
  },
];

/** Best-effort log-level classification of a raw log line, or null if none matched. */
export function detectLogLevel(line: string): LogLevel | null {
  for (const rule of LEVEL_RULES) {
    if (rule.regex.test(line)) return rule.level;
  }
  return null;
}

export const LEVEL_LABEL: Record<LogLevel, string> = {
  error: "ERROR",
  warn: "WARN",
  info: "INFO",
  debug: "DEBUG",
};

/** Badge (pill) styling per level - background/text/border. */
export const LEVEL_BADGE_CLASSNAME: Record<LogLevel, string> = {
  error: "bg-red-500/15 text-red-400 border-red-500/40",
  warn: "bg-amber-500/15 text-amber-400 border-amber-500/40",
  info: "bg-sky-500/15 text-sky-400 border-sky-500/40",
  debug: "bg-slate-500/15 text-slate-400 border-slate-500/40",
};

/** Plain text-color styling per level, for coloring the line text itself. */
export const LEVEL_TEXT_CLASSNAME: Record<LogLevel, string> = {
  error: "text-red-400",
  warn: "text-amber-400",
  info: "text-sky-400",
  debug: "text-slate-500",
};
