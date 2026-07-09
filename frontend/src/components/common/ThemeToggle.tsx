import { Moon, Sun } from "lucide-react";
import { useUiStore } from "../../stores/uiStore";
import { Button } from "./Button";
import { Tooltip } from "./Tooltip";

export function ThemeToggle() {
  const theme = useUiStore((s) => s.theme);
  const toggleTheme = useUiStore((s) => s.toggleTheme);
  const isDark = theme === "dark";

  return (
    <Tooltip content={isDark ? "Switch to light mode" : "Switch to dark mode"}>
      <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Toggle color theme">
        {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
      </Button>
    </Tooltip>
  );
}
