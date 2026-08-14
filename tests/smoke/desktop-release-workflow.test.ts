import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The desktop release workflow, disarmed for the length of the migration
 * ([#60](https://github.com/Lamakira/docuflow/issues/60), ADR-0018).
 *
 * ADR-0018 forbids this repository holding production credentials or URLs, and
 * publishing desktop installers to real users needs exactly those. The
 * investigation for #60 found the conflict was prospective rather than actual —
 * no secret configured on this repository or the old one, no `desktop-agent-v*`
 * tag on either, no GitHub Release on either, and the workflow had never run —
 * so what needed removing was not a credential but an automatic path and a
 * header instructing a reader to create one.
 *
 * The disarm is structural rather than a flag: every publishing step is gated
 * on `github.event_name == 'push'`, so with no push trigger they are
 * unreachable, and `workflow_dispatch` cannot satisfy that gate however its
 * inputs are set. **That is the property this suite exists to keep**, and the
 * one a later edit is most likely to lose by accident.
 *
 * On why the checks below split the file into steps rather than scanning it
 * line by line: the first version tracked the nearest preceding `if:`, passed,
 * and was wrong. The macOS *build* step carried the four Apple signing secrets
 * and has no `if:` at all, so in a line scan it inherited its neighbour's gate
 * and in reality had none — the one place where removing the trigger did not
 * close the path. Splitting on step boundaries is what makes "this step has no
 * gate" representable at all.
 *
 * This is not a YAML parser and does not pretend to be one; it knows this
 * file's shape. The repository declares no YAML parser, and adding one for this
 * meant regenerating a lockfile that turned out to carry unrelated drift in
 * which packages count as `dev` — which decides what `npm ci --omit=dev` puts
 * in the image, and is not a thing to smuggle into a workflow change. If the
 * file's shape ever changes, `finds the steps at all` below fails loudly rather
 * than the guard passing vacuously.
 */

const WORKFLOW = join(__dirname, "../../.github/workflows/desktop-release.yml");
const source = readFileSync(WORKFLOW, "utf8");

/** The gate every publishing step carries, and the whole of the disarm. */
const PUSH_GATE = "github.event_name == 'push'";

/**
 * The file split at step boundaries — a list item under a job's `steps:`, which
 * in this workflow is always six spaces then `- `. Everything up to the next
 * such line belongs to that step, `if:` and `env:` and all.
 */
function steps(text: string): string[] {
  const found: string[] = [];
  let current: string[] | null = null;

  for (const line of text.split("\n")) {
    if (/^ {6}- /.test(line)) {
      if (current) found.push(current.join("\n"));
      current = [line];
    } else if (current) {
      // A line at or above job level ends the steps block.
      if (/^ {0,4}\S/.test(line)) {
        found.push(current.join("\n"));
        current = null;
      } else {
        current.push(line);
      }
    }
  }
  if (current) found.push(current.join("\n"));
  return found;
}

/** The `on:` block: from `on:` to the next line starting in column zero. */
function triggerBlock(text: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => /^on:/.test(line));
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^\S/.test(line));
  return rest.slice(0, end === -1 ? rest.length : end).join("\n");
}

const allSteps = steps(source);
const referencesSecret = (step: string) => /\$\{\{\s*secrets\./.test(step);
const isGated = (step: string) => step.includes(PUSH_GATE);
const nameOf = (step: string) => step.match(/- name:\s*(.+)/)?.[1] ?? step.split("\n")[0].trim();

describe("the step splitter", () => {
  it("finds the steps at all, so the guard below cannot pass vacuously", () => {
    expect(allSteps.length).toBeGreaterThan(15);
  });

  it("keeps each step's own gate with it, rather than its neighbour's", () => {
    const gated = allSteps.filter(isGated);
    const ungated = allSteps.filter((step) => !isGated(step));
    expect(gated.length).toBeGreaterThan(5);
    expect(ungated.length).toBeGreaterThan(5);
  });
});

describe("the desktop release workflow is disarmed", () => {
  it("has no push trigger, so nothing fires on a tag", () => {
    expect(triggerBlock(source)).not.toMatch(/^\s*push:/m);
  });

  it("has no tag filter left behind, which would read as still armed", () => {
    expect(triggerBlock(source)).not.toMatch(/desktop-agent-v/);
  });

  it("can still be run by hand, because building is not the part that was dangerous", () => {
    expect(triggerBlock(source)).toMatch(/workflow_dispatch:/);
  });
});

describe("no step reaches a credential a manual run could supply", () => {
  /**
   * Stated as the thing that must not happen rather than as the mechanism that
   * prevents it: no step may name a secret unless a `push` — the event this
   * workflow can no longer receive — is a precondition of it running.
   */
  it("keeps every secret reference behind the push gate", () => {
    const ungated = allSteps.filter(referencesSecret).filter((step) => !isGated(step)).map(nameOf);
    expect(ungated).toEqual([]);
  });

  it("still references secrets somewhere, or this suite is guarding nothing", () => {
    expect(allSteps.some(referencesSecret)).toBe(true);
  });

  it("names no Apple signing secret anywhere — those were removed, not gated", () => {
    expect(source).not.toMatch(/secrets\.(APPLE_|CSC_NAME)/);
  });
});

describe("the file tells a reader why", () => {
  it("names the decision that disarmed it", () => {
    expect(source).toMatch(/ADR-0018/);
  });

  it("says plainly that no secret may be added to make it publish", () => {
    expect(source).toMatch(/DO NOT ADD ANY SECRET TO THIS REPOSITORY/);
  });
});
