import type { LucideIcon } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

/**
 * An action that asks first (#281): the trigger reads as destructive, and the
 * dismissal is focused so the keyboard does not agree by reflex. A `neutral`
 * one (a seat change, a requirement) keeps the question without the red.
 */
export function DestructiveConfirm({
  icon: Icon,
  label,
  title,
  consequence,
  confirmLabel,
  keepLabel,
  pending,
  disabled = false,
  tone = "destructive",
  testId,
  onConfirm,
}: {
  icon?: LucideIcon;
  label: string;
  title: string;
  consequence: string;
  confirmLabel: string;
  keepLabel: string;
  pending: boolean;
  /** The trigger cannot open the question yet; the reason sits beside it. */
  disabled?: boolean;
  tone?: "destructive" | "neutral";
  testId: string;
  onConfirm: () => void;
}) {
  const destructive = tone === "destructive";
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant={destructive ? "destructiveOutline" : "outline"}
          className="df-btn"
          disabled={pending || disabled}
          aria-busy={pending || undefined}
          data-testid={testId}
        >
          {Icon ? <Icon strokeWidth={1.6} aria-hidden /> : null}
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="df-v2 df-alert">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{consequence}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {/* Focused on open: the action reads first in this footer (shadcn
              stacks it above the dismissal on a phone, the platform
              convention), so the keyboard must not agree with it. */}
          <AlertDialogCancel className="df-btn" autoFocus>
            {keepLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            className={destructive ? "df-btn bg-destructive text-destructive-foreground hover:bg-destructive/90" : "df-btn"}
            disabled={pending}
            data-testid={`${testId}-confirm`}
            onClick={onConfirm}
          >
            {Icon ? <Icon strokeWidth={1.6} aria-hidden /> : null}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
