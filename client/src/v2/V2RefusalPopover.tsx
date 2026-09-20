/**
 * Capability refusal hangs from the control that failed (#245 F3, #249).
 * shadcn Popover is the surface; the composer decides whether it opens.
 */

import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { composeRefusalPlacement } from "./chrome";
import { motionForSurface } from "./motion";

const REFUSAL_MOTION = motionForSurface("capability-refusal").enterExit;

export function V2RefusalPopover({
  controlId,
  failedControlId,
  trigger,
  message,
  testId,
  onDismiss,
}: {
  controlId: string;
  failedControlId: string | null;
  trigger: ReactElement;
  message: string | null;
  testId?: string;
  onDismiss: () => void;
}) {
  const placement = composeRefusalPlacement({ failedControlId, controlId });
  return (
    <Popover open={placement.open}>
      <PopoverAnchor asChild>{trigger}</PopoverAnchor>
      {placement.open && message ? (
        <PopoverContent
          align={placement.align}
          side={placement.side}
          sideOffset={8}
          className="df-v2 df-refusal-popover"
          data-motion={REFUSAL_MOTION}
          role="status"
          data-testid={testId}
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <p className="df-refusal">{message}</p>
          <Button type="button" variant="outline" className="df-btn" onClick={onDismiss}>
            Close
          </Button>
        </PopoverContent>
      ) : null}
    </Popover>
  );
}
