# DocuFlow Desktop Agent — Release Guide

## Emplacement des installeurs

Stockés dans le bucket Object Storage de l'environnement, sous `<dossier public>/installers/<version>/<fichier>` (le premier de `PUBLIC_OBJECT_SEARCH_PATHS`). Le `storageUrl` garde la forme `https://storage.googleapis.com/<bucket>/<dossier public>/installers/<version>/<fichier>`.

> Publier ne demande **aucune clé Google** : le serveur signe l'URL d'upload, le script n'a besoin que de `DOCUFLOW_API_URL` (le déploiement cible, sans valeur par défaut, ADR-0018) et `DESKTOP_RELEASE_CI_TOKEN`. Le fournisseur de stockage du serveur doit savoir signer (sidecar Replit, ou service account Google) ; sinon `upload-url` répond 503.

## Versions publiées

v0.1.7 — dernière version enregistrée en DB, les 3 plateformes pointent vers l'Object Storage :

| Plateforme | Fichier | Taille |
|------------|---------|--------|
| Windows | `DocuFlow-Agent-0.1.7-windows-setup.exe` | ~65 MB |
| macOS | `DocuFlow-Agent-0.1.7-macos.dmg` | ~94 MB |
| Linux | `DocuFlow-Agent-0.1.7-linux-amd64.deb` | ~74 MB |

**v0.1.8 — publiée le 2026-06-19** (les 3 plateformes pointent vers l'Object Storage) :

| Plateforme | Fichier | Taille | SHA256 |
|------------|---------|--------|--------|
| Windows | `DocuFlow-Agent-0.1.8-windows-setup.exe` | 64.8 MB | `9e61bd11...` |
| macOS | `DocuFlow-Agent-0.1.8-macos.dmg` | 93.8 MB | `c6133b17...` |
| Linux | `DocuFlow-Agent-0.1.8-linux-amd64.deb` | 73.2 MB | `e591fec3...` |

**v0.1.10 — publiée le 2026-06-30** (correctifs sécurité et UX) :

Changements inclus dans v0.1.10 :
- **Corrections de sécurité** — autorisation par projet sur les endpoints `/api/agent/tasks`
- **Corrections Wayland** — nettoyage robuste du portail PipeWire (`pause` restaure le display)
- **URL de création de projet** — utilise la configuration `apiBase` au lieu de l'URL de production

| Plateforme | Fichier | Taille | SHA256 |
|------------|---------|--------|--------|
| Windows | `DocuFlow-Agent-0.1.10-windows-setup.exe` | 64.8 MB | `fa0568ffb560d8deeff06cf8a681b71e3b1c1d576b26e7e2a55f12938553507e` |
| macOS | `DocuFlow-Agent-0.1.10-macos.dmg` | 93.8 MB | `749e704d304f644d2eea46e2f8c2f371c599bb1bc9974d0fdf10495a3aa781d0` |
| Linux | `DocuFlow-Agent-0.1.10-linux-amd64.deb` | 73.0 MB | `491bf2c97ea3967c517cf2ed12aa11ff3eaaa6d8edcd56dd6c7cf9e7bf25d82a` |

## Architecture de distribution

- Les installeurs (~65-94 MB) dépassent le plafond de 32 MiB par requête/réponse d'Autoscale : aucun octet ne transite par le serveur, ni au téléchargement ni à la publication
- Endpoint de disponibilité : `GET /downloads/availability` → `{ windows: bool, macos: bool, linux: bool }`. Une plateforme est disponible si sa ligne `is_latest` est dans le bucket de l'environnement **et** que l'objet existe
- Endpoint de téléchargement : `GET /downloads/:platform` → 302 vers une URL signée (GET, 15 min). Une ligne qui pointe vers un autre bucket répond comme « pas de release » (404), jamais 500 (ADR-0018 : on ne suit pas l'URL de production d'un autre environnement). Plus de repli sur le dossier `installers/` local
- `GET /api/downloads/desktop/latest?platform=…` → 302 vers `/downloads/:platform` (l'objet brut est privé) ; `?format=json` renvoie les métadonnées
- La DB (`desktop_releases`) stocke le `storageUrl`, `sha256`, `fileSize` et `isLatest` par plateforme

## Scripts de build (`desktop-agent/scripts/`)

- `dist-win.js` — build Windows NSIS installer via electron-forge + electron-builder
- `dist-mac.js` — build macOS DMG (requiert macOS + certificats Apple)
- `dist-linux.js` — build Linux .deb ; inclut deux correctifs critiques :
  1. **Fix permissions Step 1.5** : `chmod 755` sur le dossier `out/` après `electron-forge package` (electron-forge crée parfois le dossier en `700`, bloquant l'accès aux utilisateurs normaux)
  2. **Patch postinst Step 3** : extrait le `.deb`, injecte `chmod 755 '/opt/DocuFlow Desktop Agent'` dans le script `postinst`, et repackage le `.deb` — permet que les permissions soient corrigées même lors d'une **mise à jour** (dpkg ne remet pas à jour les permissions d'un dossier existant)
- `fix-permissions.js` — correctif de permissions (utilisé lors du build, non invoqué directement)

## Script de release (`scripts/release-desktop.mjs`)

Seul script de publication conservé. Les anciens `upload-to-gcs.mjs`, `gcs-client.mjs`, `upload-installer.mjs`, `publish-windows.js`, `publish-release.sh` et `publish-release.ps1` sont retirés (clé Google ou stockage sur disque local, tous deux inutilisables sur Autoscale).

```bash
DOCUFLOW_API_URL=<déploiement> DESKTOP_RELEASE_CI_TOKEN=<token> \
  node scripts/release-desktop.mjs [--run-id <id> | --skip-build]
```

Pour chaque installeur (`.exe`, `.dmg`, `.deb` du run GitHub Actions) : calcule SHA256 et taille, appelle `upload-url`, envoie le fichier en PUT vers l'URL signée, puis enregistre la release.

## Endpoints internes (auth `Authorization: Bearer $DESKTOP_RELEASE_CI_TOKEN`)

- `POST /api/internal/desktop-releases/upload-url` — corps `{ platform, version, filename, fileSize, sha256 }` → `{ uploadUrl, storageUrl, expiresAt }`. `uploadUrl` est un PUT signé (15 min) ; 503 si le fournisseur ne sait pas signer.
- `POST /api/internal/desktop-releases` — enregistre la release et la marque `is_latest`. Exige que `storageUrl` soit dans le bucket de l'environnement (422 sinon) et que l'objet existe déjà (409 sinon).
- Les anciens `upload` et `upload-chunk` (stockage disque) n'existent plus.

## Procédure de release

1. **Compiler** les installeurs : déclencher le workflow (Actions → `Desktop Agent — Release` → Run workflow, build-only, artifacts 7 jours) ou `npm run dist:win` / `dist:mac` / `dist:linux` sur la bonne plateforme.
2. **Publier** : `node scripts/release-desktop.mjs --run-id <id>` (voir ci-dessus). Le script fait l'upload direct et l'enregistrement.
3. **Vérifier** : `GET $DOCUFLOW_API_URL/downloads/windows` répond 302 vers le stockage.

Pour les installeurs déjà publiés dans un autre bucket (v1), les republier avec cette procédure : une ligne vers un autre bucket n'est pas suivie.

---

## Workflow GitHub Actions (build uniquement, ou release auto par tag — NON utilisé)

**Fichier** : `.github/workflows/desktop-release.yml`

Le workflow reste **désarmé** (ADR-0018) : un déclenchement manuel produit uniquement les artifacts de build. Ses étapes de publication par tag (upload GCS) datent de l'ancien chemin et ne suivent pas ce guide ; la voie réelle est `scripts/release-desktop.mjs`.

## Notes Linux spécifiques

- Sur **Wayland** : l'app demande une autorisation de partage d'écran à chaque session (comportement normal du portail XDG/PipeWire, imposé par Wayland pour la sécurité). Pour éviter ce dialogue, utiliser une session **X11/Xorg** à la connexion.
- Sur **X11** : aucun dialogue de permission pour les captures d'écran.
- Installation propre recommandée lors d'une mise à jour : `sudo dpkg --purge docuflow-agent && sudo dpkg -i <nouveau.deb>` (évite les problèmes de permissions résiduelles si l'ancienne version avait le bug `700`).
