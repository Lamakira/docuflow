/**
 * evidence-export.ts — the nightly logical export that ADR-0016 sends to the
 * standalone AWS account, and the evidence record that goes with it.
 *
 *   npm run evidence:export -- --out ./evidence --retain-days 35
 *   npm run evidence:verify -- --manifest ./evidence/manifest.json --file <artifact>
 *
 * ADR-0015 wants an immutable evidence copy that the environment holding the
 * data cannot alter. ADR-0016 makes that an S3 bucket in a standalone AWS
 * account with Object Lock in compliance mode, fed by a daily encrypted logical
 * export, with the AWS credentials confined to the backup job's environment.
 * ADR-0021's amendment raises the stakes: point-in-time restore on the current
 * database platform is **contested**, so until that is read from the dashboard
 * these exports may be the recovery point of record rather than a second copy.
 *
 * What this file is not: the upload. There is no AWS account yet (#57), and
 * more durably, the credential that writes to the evidence bucket belongs in
 * that job's environment and nowhere else — least of all in this repository,
 * which is the confinement ADR-0016 asks for and the same division ADR-0022
 * draws for the object copy. So the transfer is a command this module prints
 * and an operator or a scheduled job runs, and what lives here is the artifact,
 * its evidence record, and the check that the artifact can still be read.
 *
 * Two things here are one-way doors and are written to refuse rather than
 * default. **Compliance-mode retention cannot be shortened**, by anyone,
 * including the account root — so `--retain-days` is required and has no
 * default, because a number nobody chose becomes a bill nobody can stop. And
 * **the export is encrypted before it leaves this process**, under a key held
 * outside AWS, so that possession of the bucket is not possession of the
 * database.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requireDatabaseUrl } from "../shared/databaseUrl";
import { flagValue } from "./lib/args";
import { isEntryPoint } from "./lib/entrypoint";

/**
 * The two things this account holds. `audit` has no producer yet — ADR-0015's
 * audit port is a later phase — and the prefix is declared now because #57 asks
 * for the layout before the writer exists, which is the cheap moment to fix it.
 */
export type EvidenceKind = "db" | "audit";

/** AES-256: 32 bytes, and the reason `readExportKey` is strict about length. */
const KEY_BYTES = 32;

/** GCM's nominal IV size. Anything else costs a rehash inside the cipher. */
const IV_BYTES = 12;

const TAG_BYTES = 16;

/**
 * Frames the ciphertext so a reader can tell one of ours from any other file it
 * was handed. Versioned because the day this format changes, the artifacts
 * already under compliance lock cannot be rewritten to match it.
 */
const MAGIC = Buffer.from("DFEVD1\n");

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * The object's name. Date-ordered and zero-padded so that a plain lexicographic
 * listing — which is all `aws s3 ls` gives — reads in the order the exports were
 * taken.
 */
export function exportFileName(at: Date): string {
  const stamp =
    `${at.getUTCFullYear()}${twoDigits(at.getUTCMonth() + 1)}${twoDigits(at.getUTCDate())}` +
    `T${twoDigits(at.getUTCHours())}${twoDigits(at.getUTCMinutes())}${twoDigits(at.getUTCSeconds())}Z`;
  return `docuflow-${stamp}.dump.enc`;
}

/**
 * Where one artifact lives in the bucket: kind, then the date as a path. The
 * date is a prefix rather than only part of the filename because a lifecycle
 * rule, a listing, and a restore drill all want to ask for one day.
 */
export function evidenceKey(kind: EvidenceKind, at: Date, name: string): string {
  const y = at.getUTCFullYear();
  return `${kind}/${y}/${twoDigits(at.getUTCMonth() + 1)}/${twoDigits(at.getUTCDate())}/${name}`;
}

/**
 * The 32-byte key, from 64 hex characters. Strict on both counts: a short key
 * is a weaker cipher than the name claims, and `Buffer.from(x, "hex")` truncates
 * silently at the first non-hex character — so a passphrase pasted here would
 * otherwise encrypt every export under whatever prefix happened to parse.
 */
export function readExportKey(raw: string | undefined): Buffer {
  const value = raw?.trim();
  if (!value) {
    throw new Error(
      "EVIDENCE_EXPORT_KEY is not set — 64 hex characters naming the key these exports " +
        "are encrypted under, e.g. openssl rand -hex 32. It is held outside AWS on purpose: " +
        "possession of the bucket must not be possession of the database."
    );
  }

  if (!/^[0-9a-fA-F]+$/.test(value)) {
    throw new Error(
      "EVIDENCE_EXPORT_KEY is not hex. It is 64 hex characters, not a passphrase — " +
        "a passphrase would be truncated at its first non-hex character and the export " +
        "would be encrypted under whatever prefix parsed."
    );
  }

  const key = Buffer.from(value, "hex");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `EVIDENCE_EXPORT_KEY decodes to ${key.length} bytes; ${KEY_BYTES} are needed for AES-256. ` +
        `Generate it with openssl rand -hex 32.`
    );
  }
  return key;
}

/**
 * `MAGIC | iv | tag | ciphertext`. GCM rather than CBC because an evidence copy
 * that cannot detect tampering is not evidence: the bucket refuses overwrites,
 * and this refuses everything that reaches it by another route.
 */
export function encrypt(plaintext: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), ciphertext]);
}

export function decrypt(framed: Buffer, key: Buffer): Buffer {
  if (framed.length < MAGIC.length + IV_BYTES + TAG_BYTES || !framed.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error(
      "This is not an evidence export written by this tool, or it is truncated. " +
        "Refusing to read the head of an unknown file as an initialization vector."
    );
  }

  const iv = framed.subarray(MAGIC.length, MAGIC.length + IV_BYTES);
  const tag = framed.subarray(MAGIC.length + IV_BYTES, MAGIC.length + IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([
      decipher.update(framed.subarray(MAGIC.length + IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]);
  } catch {
    // Node says "Unsupported state or unable to authenticate data", which is
    // true and useless at three in the morning during a restore drill. GCM
    // cannot tell the two causes apart, so name both.
    throw new Error(
      "This artifact does not decrypt under EVIDENCE_EXPORT_KEY. Either the key is not the " +
        "one it was encrypted with, or the bytes have been altered since — the cipher cannot " +
        "tell those apart, and both are fatal. Check the key first: it is the likelier of the " +
        "two, and the bucket refuses overwrites."
    );
  }
}

/**
 * When compliance-mode retention expires, computed from the export's own moment
 * rather than from the upload's, so a retry tomorrow does not extend the lock.
 *
 * There is no default. Compliance mode cannot be shortened or overridden by
 * anyone — not the account root, not AWS support — so the number is a commitment
 * to store and to pay for the whole term, and it belongs to whoever configures
 * the job rather than to this file.
 */
export function retainUntil(at: Date, days: number): string {
  if (!Number.isInteger(days)) {
    throw new Error(
      `--retain-days must be a whole number of days; got ${days}. S3 takes a date, ` +
        `so a fraction would be rounded somewhere nobody chose.`
    );
  }
  if (days < 1) {
    throw new Error(
      `--retain-days must be at least one day; got ${days}. A compliance lock of zero ` +
        `days locks nothing, which is worse than no lock at all because it reads as one.`
    );
  }
  return new Date(at.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

export interface ExportManifest {
  /** The moment the dump was taken. The key and the lock both derive from it. */
  takenAt: string;
  source: string;
  cipher: string;
  key: string;
  plaintextBytes: number;
  plaintextSha256: string;
  ciphertextBytes: number;
  ciphertextSha256: string;
  objectLock: { mode: "COMPLIANCE"; retainUntil: string };
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * The evidence record. Two checksums, and they answer different questions: the
 * ciphertext's is what an upload is reconciled against, and the plaintext's is
 * what says a decrypt produced the same dump that was taken — the check a
 * restore drill needs and the one a bucket listing can never give.
 *
 * Neither is secret. A digest of a whole database dump grants nothing, and this
 * record is written where the artifact is not.
 */
export function buildExportManifest(args: {
  takenAt: Date;
  plaintext: Buffer;
  ciphertext: Buffer;
  retainDays: number;
}): ExportManifest {
  return {
    takenAt: args.takenAt.toISOString(),
    source: "pg_dump --format=custom",
    cipher: "AES-256-GCM",
    key: evidenceKey("db", args.takenAt, exportFileName(args.takenAt)),
    plaintextBytes: args.plaintext.length,
    plaintextSha256: sha256(args.plaintext),
    ciphertextBytes: args.ciphertext.length,
    ciphertextSha256: sha256(args.ciphertext),
    objectLock: { mode: "COMPLIANCE", retainUntil: retainUntil(args.takenAt, args.retainDays) },
  };
}

export function formatExportManifest(manifest: ExportManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function readExportManifest(text: string): ExportManifest {
  return JSON.parse(text) as ExportManifest;
}

/**
 * The upload, as a command rather than as a call. The credential it will run
 * under lives in the backup job's environment — ADR-0016 confines it there, and
 * that confinement is the whole argument for a separate account — so nothing
 * here holds one, names one, or would work if it did.
 */
export function putObjectCommand(args: {
  bucket: string;
  key: string;
  file: string;
  retainUntil: string;
}): string[] {
  return [
    "aws",
    "s3api",
    "put-object",
    "--bucket",
    args.bucket,
    "--key",
    args.key,
    "--body",
    args.file,
    "--object-lock-mode",
    "COMPLIANCE",
    "--object-lock-retain-until-date",
    args.retainUntil,
  ];
}

/**
 * `--format=custom` because a plain SQL script restores all-or-nothing, and the
 * quarterly drill ADR-0016 schedules wants `pg_restore` to be able to take one
 * table. The URL is one argument, never interpolated into a shell string: a
 * password holding `$` or a space is a password, not a syntax error.
 */
export function pgDumpArgs(databaseUrl: string, outPath: string): string[] {
  return ["--format=custom", "--no-owner", "--no-privileges", `--file=${outPath}`, databaseUrl];
}

/** Resolves `pg_dump`, or says plainly that this host has none. */
export function requirePgDump(resolve: (binary: string) => string | null = defaultResolve): string {
  const found = resolve("pg_dump");
  if (!found) {
    throw new Error(
      "pg_dump was not found on this host. The export is a logical dump and there is no " +
        "substitute for the tool that writes one — a hand-rolled SELECT of every table " +
        "restores in the wrong order and carries no schema. Install the PostgreSQL client " +
        "package wherever this job runs, and record which host that is."
    );
  }
  return found;
}

function defaultResolve(binary: string): string | null {
  const probe = spawnSync(binary, ["--version"], { encoding: "utf8" });
  return probe.error || probe.status !== 0 ? null : binary;
}

/** Runs the dump into a temporary file and returns its bytes. */
async function runPgDump(databaseUrl: string): Promise<Buffer> {
  const binary = requirePgDump();
  const path = join(tmpdir(), `docuflow-evidence-${process.pid}.dump`);
  try {
    const result = spawnSync(binary, pgDumpArgs(databaseUrl, path), { encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(`pg_dump exited ${result.status}: ${result.stderr?.trim() ?? "no output"}`);
    }
    return await readFile(path);
  } finally {
    await unlink(path).catch(() => {});
  }
}

async function main(argv: string[]): Promise<number> {
  const command = argv[0];

  if (command === "export") {
    const out = flagValue(argv, "--out", "a directory to write the artifact and manifest to");
    if (!out) throw new Error("export needs --out <directory>");

    const retainRaw = flagValue(argv, "--retain-days", "the compliance-lock retention in days");
    if (!retainRaw) {
      throw new Error(
        "export needs --retain-days. Compliance-mode retention cannot be shortened by " +
          "anyone once it is set, so this tool will not pick the number for you."
      );
    }
    const retainDays = Number(retainRaw);

    const at = new Date(flagValue(argv, "--at", "an ISO timestamp") ?? Date.now());
    if (Number.isNaN(at.getTime())) throw new Error("--at is not a readable timestamp");

    // Validated before the dump runs: a bad retention discovered afterwards has
    // cost a full export against the database for nothing.
    const lockUntil = retainUntil(at, retainDays);
    const exportKey = readExportKey(process.env.EVIDENCE_EXPORT_KEY);

    const plaintext = await runPgDump(requireDatabaseUrl());
    const ciphertext = encrypt(plaintext, exportKey);
    const manifest = buildExportManifest({ takenAt: at, plaintext, ciphertext, retainDays });

    await mkdir(out, { recursive: true });
    const file = join(out, exportFileName(at));
    await writeFile(file, ciphertext);
    await writeFile(join(out, "manifest.json"), formatExportManifest(manifest));

    console.log(`dump       ${manifest.plaintextBytes} bytes`);
    console.log(`encrypted  ${manifest.ciphertextBytes} bytes, ${manifest.cipher}`);
    console.log(`sha256     ${manifest.ciphertextSha256}`);
    console.log(`wrote      ${file}`);
    console.log(`manifest   ${join(out, "manifest.json")}`);
    console.log("");
    console.log("Then, from the backup job's environment — never from this repository:");
    console.log(
      `  ${putObjectCommand({
        bucket: process.env.EVIDENCE_S3_BUCKET ?? "<bucket>",
        key: manifest.key,
        file,
        retainUntil: lockUntil,
      }).join(" ")}`
    );
    return 0;
  }

  if (command === "verify") {
    const manifestPath = flagValue(argv, "--manifest", "a path to the export manifest");
    const filePath = flagValue(argv, "--file", "a path to the encrypted artifact");
    if (!manifestPath || !filePath) throw new Error("verify needs --manifest and --file");

    const manifest = readExportManifest(await readFile(manifestPath, "utf8"));
    const ciphertext = await readFile(filePath);

    if (sha256(ciphertext) !== manifest.ciphertextSha256) {
      console.error(`ciphertext checksum differs — expected ${manifest.ciphertextSha256}`);
      return 1;
    }

    const plaintext = decrypt(ciphertext, readExportKey(process.env.EVIDENCE_EXPORT_KEY));
    if (sha256(plaintext) !== manifest.plaintextSha256) {
      console.error("the artifact decrypts, but to something other than the dump that was taken");
      return 1;
    }

    console.log(`verified   ${manifest.key}`);
    console.log(`           decrypts to ${manifest.plaintextBytes} bytes, checksum matches`);
    console.log(`           locked until ${manifest.objectLock.retainUntil}`);
    return 0;
  }

  if (command === "decrypt") {
    const filePath = flagValue(argv, "--file", "a path to the encrypted artifact");
    const out = flagValue(argv, "--out", "a path to write the dump to");
    if (!filePath || !out) throw new Error("decrypt needs --file and --out");

    const plaintext = decrypt(
      await readFile(filePath),
      readExportKey(process.env.EVIDENCE_EXPORT_KEY)
    );

    // Checked here rather than left to the operator: `pg_restore` on a dump that
    // decrypted to the wrong bytes fails deep in the restore, hours into a drill.
    const manifestPath = flagValue(argv, "--manifest", "a path to the export manifest");
    if (manifestPath) {
      const manifest = readExportManifest(await readFile(manifestPath, "utf8"));
      if (sha256(plaintext) !== manifest.plaintextSha256) {
        console.error("the artifact decrypts, but to something other than the dump that was taken");
        return 1;
      }
    }

    await writeFile(out, plaintext);
    console.log(`wrote ${plaintext.length} bytes to ${out}`);
    console.log(`  pg_restore --no-owner --no-privileges --dbname <a database that is not this one> ${out}`);
    return 0;
  }

  throw new Error(`Unknown command "${command ?? ""}". Use export, verify, or decrypt.`);
}

if (isEntryPoint(import.meta.url)) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
