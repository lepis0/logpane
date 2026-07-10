import { useState } from "react";
import { HelpCircle } from "lucide-react";
import { Button } from "./Button";
import { Tooltip } from "./Tooltip";
import { HelpDialog } from "./HelpDialog";

export function HelpButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Tooltip content="Help">
        <Button variant="ghost" size="icon" onClick={() => setOpen(true)} aria-label="Help">
          <HelpCircle className="size-4" />
        </Button>
      </Tooltip>
      <HelpDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
