import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const sonner = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("sonner", () => sonner);

import {
  GENERIC_FAILURE,
  NETWORK_FAILURE,
  copyToClipboard,
  errorMessage,
  isStandingRefusal,
  notify,
} from "../../client/src/v2/notify";

/**
 * v2 action feedback: one top-center Sonner toast for the result of a write,
 * while field validation, page states, and standing refusals stay inline.
 * Seam: notify.ts (with sonner stubbed) + the v2 root, toaster, and tokens.css.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const v2Dir = join(root, "client/src/v2");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const css = read("client/src/v2/tokens.css").replace(/\/\*[\s\S]*?\*\//g, "");

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("v2 notify helper", () => {
  it("reads a failed write's copy from the error apiRequest throws", () => {
    expect(errorMessage(new Error("Client name is required"))).toBe("Client name is required");
    expect(errorMessage("Workspace name is too long")).toBe("Workspace name is too long");
    expect(errorMessage(new TypeError("Failed to fetch"))).toBe(NETWORK_FAILURE);
    expect(errorMessage(new Error(""))).toBe(GENERIC_FAILURE);
    expect(errorMessage(null, "Folder could not be deleted.")).toBe("Folder could not be deleted.");
    expect(errorMessage(new Error("Permission denied"))).toBe("This action needs a Capability. An Owner can grant it.");
  });

  it("keeps standing refusals inline and sends every other failure to a toast", () => {
    expect(isStandingRefusal(new Error("Workspace is read-only"))).toBe(true);
    expect(isStandingRefusal(new Error("Permission denied"))).toBe(true);
    expect(isStandingRefusal("Not authorized")).toBe(true);
    expect(isStandingRefusal(new Error("Missing Capability: Manage Projects"))).toBe(true);
    expect(isStandingRefusal(new Error("Client name is required"))).toBe(false);
    expect(isStandingRefusal(new TypeError("Failed to fetch"))).toBe(false);
    expect(isStandingRefusal(null)).toBe(false);
  });

  it("shows success, info, and error through one Sonner toast each", () => {
    notify.success("Client saved");
    notify.info("Choose a Task before starting the Timer.");
    notify.error(new Error("Stage is locked"), { id: "v2-save" });
    notify.error(undefined, { fallback: "Document could not be saved." });

    expect(sonner.toast.success).toHaveBeenCalledWith("Client saved", {});
    expect(sonner.toast.info).toHaveBeenCalledWith("Choose a Task before starting the Timer.", {});
    expect(sonner.toast.error).toHaveBeenNthCalledWith(1, "Stage is locked", { id: "v2-save" });
    expect(sonner.toast.error).toHaveBeenNthCalledWith(2, "Document could not be saved.", {});
  });

  it("confirms a copy, and says how to copy by hand when the clipboard refuses", async () => {
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("denied"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    copyToClipboard("ABC-123", "Pairing code copied");
    await vi.waitFor(() => expect(sonner.toast.success).toHaveBeenCalledWith("Pairing code copied", {}));
    copyToClipboard("ABC-123", "Pairing code copied");
    await vi.waitFor(() =>
      expect(sonner.toast.error).toHaveBeenCalledWith("Could not copy. Select the text and copy it instead.", {}),
    );
  });
});

describe("the v2 Toaster", () => {
  const appSource = read("client/src/v2/V2AuthenticatedApp.tsx");
  const toasterSource = read("client/src/v2/V2Toast.tsx");

  it("mounts once at the v2 root, top center, with rich colours", () => {
    expect(appSource.match(/<V2Toaster \/>/g)).toHaveLength(1);
    expect(appSource.indexOf("<V2Toaster />")).toBeGreaterThan(appSource.indexOf("</V2Shell>"));
    expect(toasterSource).toContain('import { Toaster } from "@/components/ui/sonner"');
    expect(toasterSource).toMatch(/<Toaster[\s\S]*position="top-center"[\s\S]*richColors/);

    const mounts = readdirSync(v2Dir)
      .filter((file) => file.endsWith(".tsx"))
      .filter((file) => /<Toaster\b/.test(readFileSync(join(v2Dir, file), "utf8")));
    expect(mounts).toEqual(["V2Toast.tsx"]);
  });

  it("follows the app theme and draws every colour from dark-safe v2 tokens", () => {
    const sonnerSource = read("client/src/components/ui/sonner.tsx");
    expect(sonnerSource).toContain('from "@/components/ThemeProvider"');
    expect(sonnerSource).not.toContain("next-themes");

    expect(toasterSource).toContain('className="df-v2 df-toaster"');
    for (const tone of ["success", "error"]) {
      expect(toasterSource).toMatch(new RegExp(`"--${tone}-bg": "var\\(--df-[a-z-]+\\)"`));
      expect(toasterSource).toMatch(new RegExp(`"--${tone}-text": "var\\(--df-[a-z-]+\\)"`));
    }
    expect(toasterSource).not.toMatch(/#[0-9a-f]{3,6}\b|hsl\(|rgb\(/i);
    expect(css).toMatch(/\.dark \.df-v2 \{[^}]*--df-positive-wash:[^}]*--df-alert-wash:/);
  });

  it("draws no box of its own and spaces the toast on the v2 scale", () => {
    expect(css).toMatch(/\.df-toaster\s*\{\s*display:\s*contents;\s*\}/);
    const toast = css.match(/\.df-toaster \[data-sonner-toast\]\[data-styled="true"\]\.df-toast\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(toast).toMatch(/padding:\s*var\(--df-space-3\) var\(--df-space-4\)/);
    expect(toast).toMatch(/gap:\s*var\(--df-space-2\)/);
    expect(toasterSource).toContain('offset="var(--df-space-4)"');
  });

  it("leaves v1's Radix toaster where it was", () => {
    const v1App = read("client/src/App.tsx");
    expect(v1App).toContain('from "@/components/ui/toaster"');
    expect(v1App).not.toContain("sonner");
  });
});
