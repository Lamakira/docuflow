/**
 * The v2 create dialog (#273), built on the shadcn Dialog.
 *
 * Every "New …" action opens one: a title, what the record is, the fields,
 * and Cancel beside the one primary action. A refusal lands inside the dialog,
 * under the fields it refused, so the reader keeps what they typed.
 */

import type { FormEvent, ReactNode } from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useReturnFocus } from "./returnFocus";

export type V2FormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  submitLabel: string;
  pending?: boolean;
  canSubmit: boolean;
  onSubmit: () => void;
  refusal?: string | null;
  testId: string;
  children: ReactNode;
  /**
   * Where focus goes when the dialog closes. By default it goes back to what
   * had focus when the dialog opened (`useReturnFocus`); a dialog opened from
   * a menu names its own target, since the menu item is gone by then. Prevent
   * the default to keep the shared return out.
   */
  onCloseAutoFocus?: (event: Event) => void;
};

export function V2FormDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  pending,
  canSubmit,
  onSubmit,
  refusal,
  testId,
  children,
  onCloseAutoFocus,
}: V2FormDialogProps) {
  // Radix returns focus only to a DialogTrigger; these dialogs open from their own buttons.
  const returnFocus = useReturnFocus(open, onCloseAutoFocus);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit || pending) return;
    onSubmit();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Radix portals to document.body, outside `.df-v2`, so the panel
          carries the class itself or the --df-* tokens do not resolve. */}
      <DialogContent className="df-v2 df-alert df-form-dialog" data-testid={testId}
        onCloseAutoFocus={returnFocus.onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle className="df-form-dialog-title">{title}</DialogTitle>
          <DialogDescription className="df-form-dialog-copy">{description}</DialogDescription>
        </DialogHeader>
        <form className="df-form-dialog-body" onSubmit={submit}>
          {children}
          {refusal ? <p className="df-refusal" role="alert">{refusal}</p> : null}
          <DialogFooter className="df-form-dialog-actions">
            <DialogClose asChild>
              <Button variant="outline" type="button" className="df-btn">
                Cancel
              </Button>
            </DialogClose>
            <Button variant="default" type="submit" disabled={!canSubmit || pending} className="df-btn">
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
