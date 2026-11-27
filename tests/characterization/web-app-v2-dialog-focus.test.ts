import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createReturnFocus } from "../../client/src/v2/returnFocus";

/**
 * A v2 dialog, alert or sheet hands focus back to what opened it when it
 * closes (ui-principles INTERACTION.md, Keyboard and focus).
 *
 * Radix's Dialog cancels the FocusScope's own return on close and focuses
 * only the element its `<DialogTrigger>` registered. v2 opens most overlays
 * from its own buttons through `open`, so there is no Trigger and focus fell
 * on `<body>` (measured 2026-11-27 on New Task and Rename Workspace).
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const v2Dir = join(root, "client/src/v2");
const read = (path: string) => readFileSync(join(root, path), "utf8");

type Fake = { isConnected: boolean; focused: number; focus: () => void };
function fake(isConnected = true): Fake {
  const element: Fake = { isConnected, focused: 0, focus: () => (element.focused += 1) };
  return element;
}
function closeEvent() {
  let prevented = false;
  return {
    get defaultPrevented() {
      return prevented;
    },
    preventDefault() {
      prevented = true;
    },
  } as unknown as Event;
}

describe("returning focus to the opener (createReturnFocus)", () => {
  it("focuses what had focus when the overlay opened, and takes over Radix's empty return", () => {
    const opener = fake();
    let active: unknown = opener;
    const handlers = createReturnFocus(() => active);

    handlers.remember();
    active = null; // focus moved into the overlay, then the overlay unmounted
    const event = closeEvent();
    handlers.onCloseAutoFocus(event);

    expect(opener.focused).toBe(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("lets a caller's own handler decide first, and stays out when it did", () => {
    const opener = fake();
    const handlers = createReturnFocus(() => opener, (event) => event.preventDefault());
    handlers.remember();
    handlers.onCloseAutoFocus(closeEvent());
    expect(opener.focused).toBe(0);
  });

  it("leaves focus alone when the opener is gone or was the page itself", () => {
    const gone = fake(false);
    const fromGone = createReturnFocus(() => gone);
    fromGone.remember();
    const event = closeEvent();
    fromGone.onCloseAutoFocus(event);
    expect(gone.focused).toBe(0);
    expect(event.defaultPrevented).toBe(false);

    const fromNothing = createReturnFocus(() => null);
    fromNothing.remember();
    const nothing = closeEvent();
    fromNothing.onCloseAutoFocus(nothing);
    expect(nothing.defaultPrevented).toBe(false);
  });
});

describe("every v2 overlay returns focus", () => {
  it("has a Trigger, its own onCloseAutoFocus, or the shared return", () => {
    const missing: string[] = [];
    for (const file of readdirSync(v2Dir).filter((name) => name.endsWith(".tsx"))) {
      const source = readFileSync(join(v2Dir, file), "utf8");
      const content = /<(DialogContent|AlertDialogContent|SheetContent)\b/g;
      let match: RegExpExecArray | null;
      while ((match = content.exec(source))) {
        const kind = match[1].replace("Content", "");
        // Its props run to its first child element (an arrow's `=>` ends no tag).
        const rest = source.slice(match.index + 1);
        const props = rest.slice(0, rest.search(/\n\s*<[A-Za-z{]/));
        if (/onCloseAutoFocus/.test(props)) continue;
        // The Root this Content belongs to: the nearest opening tag before it.
        const rootAt = source.lastIndexOf(`<${kind}`, match.index - 1);
        const between = rootAt >= 0 ? source.slice(rootAt, match.index) : "";
        if (new RegExp(`<${kind}Trigger\\b`).test(between)) continue;
        missing.push(`${file}: <${match[1]}> at offset ${match.index}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("gives V2FormDialog the shared return, keeping a caller's own handler", () => {
    const source = readFileSync(join(v2Dir, "V2FormDialog.tsx"), "utf8");
    expect(source).toContain("useReturnFocus(open, onCloseAutoFocus)");
    expect(source).toMatch(/onCloseAutoFocus=\{returnFocus\.onCloseAutoFocus\}/);
    // A field with autoFocus takes focus before Radix's onOpenAutoFocus, which
    // then never fires: the opener is noted as `open` turns true instead.
    expect(read("client/src/v2/returnFocus.ts")).toContain("if (open && !wasOpen.current) handlers.current.remember();");
  });
});
