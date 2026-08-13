/**
 * The one way the operational scripts read a flag that takes a value.
 *
 * Each of them wants the same thing — `--against "$URL"`, `--keys manifest.txt`
 * — and each of them has to catch the same mistake: a flag written with its
 * value forgotten, where the next flag would otherwise be swallowed as the
 * value and the command would run against something nobody named.
 *
 * `expects` names what is missing, because "--against needs a database URL"
 * tells an operator what to type and "--against needs a value" does not.
 */
export function flagValue(argv: string[], flag: string, expects = "a value"): string | undefined {
  const at = argv.indexOf(flag);
  if (at === -1) return undefined;

  const value = argv[at + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} needs ${expects}`);
  return value;
}
