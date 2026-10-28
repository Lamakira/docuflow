import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PROJECT_DOCUMENTATION_OPEN_KEY,
  WORKSPACE_LIBRARY_OPEN_KEY,
  readLibraryOpenState,
  writeLibraryOpenState,
} from "../../client/src/v2/presentation";

const source = (name: string) =>
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2", name), "utf8");

function memoryStorage(initial?: [string, string]) {
  const store = new Map<string, string>(initial ? [initial] : []);
  return {
    store,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
}

const EMPTY = { expanded: [], selected: null };

describe("library open state", () => {
  it("round-trips what was written", () => {
    const storage = memoryStorage();
    writeLibraryOpenState(storage, WORKSPACE_LIBRARY_OPEN_KEY, { expanded: ["a", "b"], selected: "b" });
    expect(readLibraryOpenState(storage, WORKSPACE_LIBRARY_OPEN_KEY)).toEqual({ expanded: ["a", "b"], selected: "b" });
    expect(readLibraryOpenState(storage, PROJECT_DOCUMENTATION_OPEN_KEY)).toEqual(EMPTY);
  });

  it("falls back to closed on malformed or wrongly shaped values", () => {
    for (const raw of ["{not json", "null", "[]", "42", '"x"', '{"expanded":"a","selected":3}']) {
      expect(readLibraryOpenState(memoryStorage(["k", raw]), "k")).toEqual(EMPTY);
    }
  });

  it("keeps only string ids", () => {
    const raw = JSON.stringify({ expanded: ["a", 1, null, "b", {}], selected: "a" });
    expect(readLibraryOpenState(memoryStorage(["k", raw]), "k")).toEqual({ expanded: ["a", "b"], selected: "a" });
  });

  it("is read from sessionStorage with its own key by both pages", () => {
    expect(source("V2Documents.tsx")).toMatch(/readLibraryOpenState\(window\.sessionStorage, WORKSPACE_LIBRARY_OPEN_KEY\)/);
    expect(source("V2ProjectDocumentation.tsx")).toMatch(
      /readLibraryOpenState\(window\.sessionStorage, PROJECT_DOCUMENTATION_OPEN_KEY\)/,
    );
  });
});
