#!/usr/bin/env node
/**
 * release-desktop.mjs — Automatise une release complète de l'agent desktop.
 *
 * Ce script :
 *   1. Déclenche le workflow GitHub Actions (build-only)
 *   2. Attend la fin du run (poll)
 *   3. Télécharge les 3 artifacts (Windows, macOS, Linux)
 *   4. Uploade chaque fichier vers Google Cloud Storage
 *   5. Enregistre chaque plateforme en DB via l'endpoint metadata-only
 *
 * Prérequis :
 *   - `gh` CLI authentifié (gh auth login)
 *   - DESKTOP_RELEASE_CI_TOKEN défini dans l'environnement
 *   - INSTALLER_GCS_BUCKET, et GCS_SERVICE_ACCOUNT_KEY sauf si les
 *     Application Default Credentials sont déjà disponibles (voir .env.example)
 *
 * Usage :
 *   node scripts/release-desktop.mjs
 *   node scripts/release-desktop.mjs --run-id 27815727396   # utiliser un run existant
 *   node scripts/release-desktop.mjs --skip-build           # build déjà fait, demande le run-id
 *
 * Variables d'environnement optionnelles :
 *   DOCUFLOW_API_URL   — défaut : https://docs.appvibed.com
 *   GH_REPO           — défaut : billos-e/TECHMA-DOCUMENTATION-PLATFORM
 *   GH_WORKFLOW        — défaut : desktop-release.yml
 */

import { execSync, spawnSync } from "child_process";
import { createHash } from "crypto";
import { readFileSync, readdirSync, existsSync, rmSync, mkdirSync } from "fs";
import { join, basename } from "path";
import { tmpdir } from "os";
import { gcsClient, installerBucketName } from "./gcs-client.mjs";

const PREFIX        = "public/installers";

const API_URL       = (process.env.DOCUFLOW_API_URL || "https://docs.appvibed.com").replace(/\/$/, "");
const TOKEN         = process.env.DESKTOP_RELEASE_CI_TOKEN;
const GH_REPO       = process.env.GH_REPO || "billos-e/TECHMA-DOCUMENTATION-PLATFORM";
const GH_WORKFLOW   = process.env.GH_WORKFLOW || "desktop-release.yml";

const POLL_INTERVAL = 30_000;  // 30 s entre chaque vérification du run
const POLL_TIMEOUT  = 60 * 60 * 1000; // 1h max d'attente

const PLATFORM_MAP = {
  "DocuFlow-Agent": null,
  "windows-setup.exe": "windows",
  "macos.dmg":         "macos",
  "linux-amd64.deb":   "linux",
};

function detectPlatform(filename) {
  if (filename.endsWith("-windows-setup.exe")) return "windows";
  if (filename.endsWith("-macos.dmg"))          return "macos";
  if (filename.endsWith("-linux-amd64.deb"))     return "linux";
  return null;
}

// ── Argument parsing ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let runId       = "";
let skipBuild   = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--run-id" && args[i + 1]) { runId = args[++i]; }
  else if (args[i] === "--skip-build") { skipBuild = true; }
}

// ── Validation ────────────────────────────────────────────────────────────────

if (!TOKEN) {
  console.error("\n[release-desktop] ERREUR : DESKTOP_RELEASE_CI_TOKEN non défini.");
  console.error("  → Récupérer la valeur avec : echo $DESKTOP_RELEASE_CI_TOKEN");
  process.exit(1);
}

function ghCmd(args, opts = {}) {
  const result = spawnSync("gh", args, { encoding: "utf8", ...opts });
  if (result.status !== 0) {
    throw new Error(`gh ${args.join(" ")} a échoué :\n${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

// ── Étape 1 : Déclencher le workflow (si pas --run-id ni --skip-build) ────────

async function triggerWorkflow() {
  console.log(`\n[1/5] Déclenchement du workflow GitHub Actions...`);
  console.log(`      Repo     : ${GH_REPO}`);
  console.log(`      Workflow : ${GH_WORKFLOW}`);

  // Récupérer le dernier run AVANT le déclenchement (pour identifier le nouveau)
  const beforeJson = ghCmd(["run", "list", "--repo", GH_REPO, "--workflow", GH_WORKFLOW,
    "--limit", "1", "--json", "databaseId"]);
  const beforeId = JSON.parse(beforeJson)[0]?.databaseId ?? 0;

  // Déclencher
  ghCmd(["workflow", "run", GH_WORKFLOW, "--repo", GH_REPO, "--ref", "main"]);
  console.log("      Workflow déclenché. En attente d'apparition du run...");

  // Attendre que le nouveau run apparaisse (jusqu'à 90 s)
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    await sleep(10_000);
    const afterJson = ghCmd(["run", "list", "--repo", GH_REPO, "--workflow", GH_WORKFLOW,
      "--limit", "1", "--json", "databaseId,status"]);
    const after = JSON.parse(afterJson)[0];
    if (after && String(after.databaseId) !== String(beforeId)) {
      console.log(`      Nouveau run détecté : ${after.databaseId} (status: ${after.status})`);
      return String(after.databaseId);
    }
  }
  throw new Error("Impossible de trouver le nouveau run après 90 s. Relancer avec --run-id <id>.");
}

// ── Étape 2 : Attendre la fin du run ─────────────────────────────────────────

async function waitForRun(id) {
  console.log(`\n[2/5] Attente de la fin du run ${id}...`);
  const deadline = Date.now() + POLL_TIMEOUT;

  while (Date.now() < deadline) {
    const json = ghCmd(["run", "view", id, "--repo", GH_REPO, "--json", "status,conclusion,name"]);
    const run = JSON.parse(json);
    process.stdout.write(`      status: ${run.status}${run.conclusion ? ` / ${run.conclusion}` : ""}    \r`);

    if (run.status === "completed") {
      console.log(`\n      Run terminé — conclusion : ${run.conclusion}`);
      if (run.conclusion !== "success") {
        throw new Error(`Le workflow s'est terminé avec : ${run.conclusion}. Vérifier les logs sur GitHub.`);
      }
      return;
    }
    await sleep(POLL_INTERVAL);
  }
  throw new Error(`Timeout : le run n'a pas terminé après ${POLL_TIMEOUT / 60000} minutes.`);
}

// ── Étape 3 : Télécharger les artifacts ──────────────────────────────────────

function downloadArtifacts(id) {
  const dir = join(tmpdir(), `docuflow-release-${id}`);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  console.log(`\n[3/5] Téléchargement des artifacts du run ${id}...`);
  ghCmd(["run", "download", id, "--repo", GH_REPO, "--dir", dir]);

  // Trouver les 3 fichiers installeurs (ils peuvent être dans des sous-dossiers)
  const files = [];
  function walk(d) {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) { walk(full); }
      else if (
        entry.name.endsWith(".exe") ||
        entry.name.endsWith(".dmg") ||
        entry.name.endsWith(".deb")
      ) {
        files.push(full);
      }
    }
  }
  walk(dir);

  if (files.length === 0) throw new Error("Aucun installeur trouvé dans les artifacts.");
  console.log(`      Trouvé ${files.length} fichier(s) :`);
  files.forEach(f => console.log(`        ${basename(f)}`));
  return files;
}

// ── Étape 4 : Upload vers Google Cloud Storage ───────────────────────────────

async function uploadToObjectStorage(filePath) {
  const bucket     = installerBucketName();
  const filename   = basename(filePath);
  const objectName = `${PREFIX}/${filename}`;
  const gcsHttps   = `https://storage.googleapis.com/${bucket}/${objectName}`;

  const fileBuffer = readFileSync(filePath);
  const sha256     = createHash("sha256").update(fileBuffer).digest("hex");
  const fileSize   = fileBuffer.length;

  console.log(`\n[4/5] Upload : ${filename}`);
  console.log(`      Taille  : ${(fileSize / 1048576).toFixed(1)} MB`);
  console.log(`      SHA256  : ${sha256}`);
  console.log(`      Cible   : ${gcsHttps}`);

  console.log("      Upload vers GCS...");
  await gcsClient().bucket(bucket).upload(filePath, {
    destination: objectName,
    contentType: "application/octet-stream",
  });
  console.log("      Upload OK.");

  return { filename, sha256, fileSize, gcsHttps };
}

// ── Étape 5 : Enregistrer en DB ───────────────────────────────────────────────

async function registerInDb({ platform, version, filename, sha256, fileSize, gcsHttps }) {
  console.log(`\n[5/5] Enregistrement en DB : ${platform} v${version}...`);

  const resp = await fetch(`${API_URL}/api/internal/desktop-releases`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ platform, version, filename, storageUrl: gcsHttps, sha256, fileSize }),
  });
  const body = await resp.json();
  if (!resp.ok) {
    throw new Error(`Enregistrement DB error ${resp.status}: ${JSON.stringify(body)}`);
  }
  console.log(`      Enregistré ! storageUrl = ${body.storageUrl}`);
  return body;
}

// ── Utilitaires ───────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function extractVersion(filename) {
  const m = filename.match(/(\d+\.\d+\.\d+)/);
  if (!m) throw new Error(`Impossible d'extraire la version du fichier : ${filename}`);
  return m[1];
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n╔═══════════════════════════════════════════╗");
  console.log("║   DocuFlow Desktop Agent — Release Tool   ║");
  console.log("╚═══════════════════════════════════════════╝");
  console.log(`  API cible : ${API_URL}`);
  console.log(`  Repo GH   : ${GH_REPO}`);

  try {
    // Étape 1 — Déclencher ou réutiliser un run
    if (runId) {
      console.log(`\n[1/5] Run ID fourni : ${runId} (build déjà disponible)`);
    } else if (skipBuild) {
      const id = await import("readline/promises").then(async ({ createInterface }) => {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const answer = await rl.question("\n[1/5] Run ID du build GitHub Actions à utiliser : ");
        rl.close();
        return answer.trim();
      });
      runId = id;
    } else {
      runId = await triggerWorkflow();
    }

    // Étape 2 — Attendre si nécessaire (si --run-id, le run peut déjà être terminé)
    if (!skipBuild && !args.includes("--run-id")) {
      await waitForRun(runId);
    } else {
      console.log(`\n[2/5] Vérification du statut du run ${runId}...`);
      await waitForRun(runId);
    }

    // Étape 3 — Télécharger les artifacts
    const installerFiles = downloadArtifacts(runId);

    // Étapes 4 & 5 — Upload + DB pour chaque plateforme (séquentiel pour éviter la saturation)
    const results = [];
    for (const filePath of installerFiles) {
      const filename = basename(filePath);
      const platform = detectPlatform(filename);
      if (!platform) {
        console.warn(`\n  [avertissement] Fichier ignoré (plateforme inconnue) : ${filename}`);
        continue;
      }
      const version = extractVersion(filename);
      const { sha256, fileSize, gcsHttps } = await uploadToObjectStorage(filePath);
      const release = await registerInDb({ platform, version, filename, sha256, fileSize, gcsHttps });
      results.push(release);
    }

    // Résumé final
    console.log("\n╔═══════════════════════════════════════════╗");
    console.log("║              Release publiée !            ║");
    console.log("╚═══════════════════════════════════════════╝");
    for (const r of results) {
      console.log(`  ${r.platform.padEnd(8)} v${r.version}  →  ${API_URL}/downloads/${r.platform}`);
    }
    console.log("");

  } catch (err) {
    console.error(`\n[release-desktop] ERREUR : ${err.message}`);
    process.exit(1);
  }
}

main();
