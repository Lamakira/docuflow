/** Clicking the row that opened a preview closes it; any other row opens its own. */
export function togglePreviewSelection(current: string | null, clicked: string): string | null {
  return current === clicked ? null : clicked;
}

/**
 * Escape closes a register preview only when focus is in the register or the
 * panel. A dialog opened from the panel (Manage access, Delete folder) is
 * portalled outside the page, so its Escape closes the dialog alone.
 */
export function previewClosesOnKey(input: {
  key: string;
  defaultPrevented: boolean;
  previewOpen: boolean;
  focusInPage: boolean;
  dialogOpen: boolean;
}): boolean {
  return (
    input.key === "Escape" &&
    !input.defaultPrevented &&
    input.previewOpen &&
    input.focusInPage &&
    !input.dialogOpen
  );
}

/** Once a preview closes, focus goes back to the row that opened it. */
export function focusPreviewOpener(selector: string): void {
  window.requestAnimationFrame(() => {
    const row = document.querySelector<HTMLElement>(selector);
    row?.focus();
  });
}
