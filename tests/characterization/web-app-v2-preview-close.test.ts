import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { previewClosesOnKey, togglePreviewSelection } from "../../client/src/v2/previewPanel";

/**
 * A register preview can be closed (#278 follow-up): the close button, Escape,
 * and clicking the row that opened it. Workspace Documents and the platform
 * console share the panel.
 */

const v2 = (name: string) =>
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2", name), "utf8");

const open = {
  key: "Escape",
  defaultPrevented: false,
  previewOpen: true,
  focusInPage: true,
  dialogOpen: false,
};

describe("clicking the selected row closes its preview", () => {
  it("closes on the same row and opens on another", () => {
    expect(togglePreviewSelection(null, "a")).toBe("a");
    expect(togglePreviewSelection("a", "a")).toBeNull();
    expect(togglePreviewSelection("a", "b")).toBe("b");
  });
});

describe("Escape closes the preview only from the page", () => {
  it("closes when focus is in the register or the panel", () => {
    expect(previewClosesOnKey(open)).toBe(true);
  });

  it("leaves the preview alone while a dialog is open or focus is elsewhere", () => {
    expect(previewClosesOnKey({ ...open, dialogOpen: true })).toBe(false);
    expect(previewClosesOnKey({ ...open, focusInPage: false })).toBe(false);
    expect(previewClosesOnKey({ ...open, defaultPrevented: true })).toBe(false);
    expect(previewClosesOnKey({ ...open, previewOpen: false })).toBe(false);
    expect(previewClosesOnKey({ ...open, key: "Enter" })).toBe(false);
  });
});

describe("the preview header carries a close button", () => {
  const head = v2("V2PreviewHead.tsx");

  it("is an icon-only shadcn Button with a lucide X, labelled for the reader", () => {
    expect(head).toMatch(/from "lucide-react"/);
    expect(head).toMatch(/<X\b/);
    expect(head).toMatch(/from "@\/components\/ui\/button"/);
    expect(head).toMatch(/size="icon"/);
    expect(head).toMatch(/aria-label="Close preview"/);
    expect(head).toMatch(/className="df-preview-close"/);
  });

  for (const [page, opener] of [
    ["V2Documents.tsx", "v2-folder-row-"],
    ["V2Platform.tsx", "v2-platform-row-"],
  ] as const) {
    it(`${page} closes by button, Escape and row, and returns focus to the row`, () => {
      const source = v2(page);
      expect(source).toMatch(/<V2PreviewHead[\s\S]*?onClose=\{/);
      expect(source).toMatch(/className="df-library"[^>]*onKeyDown=\{/);
      expect(source).toMatch(/togglePreviewSelection\(current,/);
      expect(source).toMatch(/previewClosesOnKey\(/);
      expect(source).toMatch(/event\.currentTarget\.contains\(event\.target as Node\)/);
      expect(source).toContain(`focusPreviewOpener(\`[data-testid="${opener}`);
      // Closed means unmounted, so the register takes the full width again.
      expect(source).toMatch(/\? \(\s*<aside className="df-panel df-folder-preview"/);
    });
  }

  it("does not close the Folder preview under Manage access, Delete folder or a create dialog", () => {
    const source = v2("V2Documents.tsx");
    expect(source).toMatch(/dialogOpen: Boolean\(managingFolderId\) \|\| confirmingDelete \|\| createMode !== null/);
    expect(source).toMatch(/<AlertDialog open=\{confirmingDelete\} onOpenChange=\{setConfirmingDelete\}>/);
  });
});
