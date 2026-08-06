# DocuFlow Desktop Agent — Release Guide

## Emplacement des installeurs

Stockés dans Google Cloud Storage (GCS), bucket nommé par `INSTALLER_GCS_BUCKET`, dossier `public/installers/`.

> ⚠️ **Important** : l'accès au bucket passe par un **service account Google** — clé dans `GCS_SERVICE_ACCOUNT_KEY`, ou Application Default Credentials (voir [CONFIGURATION.md](CONFIGURATION.md)). Les scripts de release, le serveur et GitHub Actions utilisent tous ce même mécanisme ; il n'y a plus de sidecar Replit ni de dépendance à l'environnement Replit.

## Versions publiées

v0.1.7 — dernière version enregistrée en DB, les 3 plateformes pointent vers l'Object Storage Replit :

| Plateforme | Fichier | Taille |
|------------|---------|--------|
| Windows | `DocuFlow-Agent-0.1.7-windows-setup.exe` | ~65 MB |
| macOS | `DocuFlow-Agent-0.1.7-macos.dmg` | ~94 MB |
| Linux | `DocuFlow-Agent-0.1.7-linux-amd64.deb` | ~74 MB |

**v0.1.8 — publiée le 2026-06-19** (les 3 plateformes pointent vers l'Object Storage Replit) :

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

- Les installeurs sont trop volumineux (~65-94 MB) pour le proxy inverse de Replit (~50 MB max)
- Solution : `server/downloadRoutes.ts` génère des **URL signées** (valides 15 min) via une redirection 302, le téléchargement se fait directement depuis l'Object Storage
- Endpoint de disponibilité : `GET /downloads/availability` → `{ windows: bool, macos: bool, linux: bool }`
- Endpoint de téléchargement : `GET /downloads/:platform` → 302 vers URL signée (si `storageUrl` est une URL `https://storage.googleapis.com/...`) OU stream local depuis `installers/` (si `storageUrl` est `/downloads/:platform`)
- La DB (`desktop_releases`) stocke le `storageUrl`, `sha256`, `fileSize` et `isLatest` par plateforme

## Deux modes de stockage supportés

1. **Google Cloud Storage** (mode actuel) — `storageUrl = https://storage.googleapis.com/<bucket>/public/installers/<fichier>`, signé au téléchargement par le service account du serveur. Persiste à travers les redéploiements.
2. **Fichier local** — `storageUrl = /downloads/:platform`, le fichier vit dans le dossier `installers/` du serveur. Plus simple mais **ne persiste pas** sur le filesystem éphémère d'un déploiement Replit (raison de la migration vers l'Object Storage).

## Scripts de build (`desktop-agent/scripts/`)

- `dist-win.js` — build Windows NSIS installer via electron-forge + electron-builder
- `dist-mac.js` — build macOS DMG (requiert macOS + certificats Apple)
- `dist-linux.js` — build Linux .deb ; inclut deux correctifs critiques :
  1. **Fix permissions Step 1.5** : `chmod 755` sur le dossier `out/` après `electron-forge package` (electron-forge crée parfois le dossier en `700`, bloquant l'accès aux utilisateurs normaux)
  2. **Patch postinst Step 3** : extrait le `.deb`, injecte `chmod 755 '/opt/DocuFlow Desktop Agent'` dans le script `postinst`, et repackage le `.deb` — permet que les permissions soient corrigées même lors d'une **mise à jour** (dpkg ne remet pas à jour les permissions d'un dossier existant)
- `fix-permissions.js` — correctif de permissions (utilisé lors du build, non invoqué directement)

## Scripts de release (`scripts/`, à la racine — exécutables depuis n'importe quel shell disposant des credentials)

- `upload-to-gcs.mjs` — upload un installeur vers le bucket `INSTALLER_GCS_BUCKET` avec le service account. N'enregistre **pas** en DB ; affiche le `gs://...` à convertir en URL HTTPS pour l'enregistrement.
- `upload-installer.mjs` — upload **chunké** (tranches de 20 MB) vers `/api/internal/desktop-releases/upload-chunk` ; écrit le fichier dans `installers/` **et** enregistre la DB en une seule passe (mode fichier local).
- `publish-windows.js` / `publish-release.sh` / `publish-release.ps1` — variantes d'upload chunké (mode fichier local).

## Endpoints internes d'upload (auth `Authorization: Bearer $DESKTOP_RELEASE_CI_TOKEN`)

- `POST /api/internal/desktop-releases/upload-chunk` — upload chunké (≤ 25 MB/chunk), réassemble, vérifie le SHA256, écrit dans `installers/` et enregistre la DB (`storageUrl = /downloads/:platform`).
- `POST /api/internal/desktop-releases/upload` — upload binaire en un seul POST (limité par le proxy ~50 MB).
- `POST /api/internal/desktop-releases` — enregistrement **metadata-only** (pour le mode Object Storage). `storageUrl` doit être une URL `https://storage.googleapis.com/...` ou `/downloads/:platform`.

## Enregistrement metadata-only en DB (mode Object Storage)

```bash
curl -X POST https://docs.appvibed.com/api/internal/desktop-releases \
  -H "Authorization: Bearer $DESKTOP_RELEASE_CI_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "linux",
    "version": "0.1.8",
    "filename": "DocuFlow-Agent-0.1.8-linux-amd64.deb",
    "storageUrl": "https://storage.googleapis.com/replit-objstore-64708bc7-367f-45c8-9004-db72f81cbeba/public/installers/DocuFlow-Agent-0.1.8-linux-amd64.deb",
    "sha256": "...",
    "fileSize": 0
  }'
```

---

## Procédure de release manuelle — RECOMMANDÉE

C'est la méthode qui a réellement servi pour v0.1.7. Elle demande le service account GCS décrit plus haut.

1. **Compiler** les installeurs via GitHub Actions :
   - Soit déclencher manuellement le workflow (Actions → `Desktop Agent — Release` → Run workflow) → build-only, produit 3 artifacts (rétention 7 jours).
   - Soit `npm run dist:win` / `dist:mac` / `dist:linux` localement sur la bonne plateforme.
2. **Récupérer les 3 artifacts** (téléchargement depuis l'UI GitHub Actions, ou `gh run download <run-id>` si `gh` est authentifié).
3. **Uploader vers l'Object Storage** (mode actuel), pour chaque plateforme :
   ```bash
   node scripts/upload-to-gcs.mjs windows <chemin>/DocuFlow-Agent-0.1.8-windows-setup.exe
   node scripts/upload-to-gcs.mjs macos   <chemin>/DocuFlow-Agent-0.1.8-macos.dmg
   node scripts/upload-to-gcs.mjs linux   <chemin>/DocuFlow-Agent-0.1.8-linux-amd64.deb
   ```
4. **Enregistrer en DB** chaque plateforme via le `curl` metadata-only ci-dessus (avec l'URL HTTPS `storage.googleapis.com/...` et le SHA256 affiché par le script).

> Alternative tout-en-un (mode fichier local) : `node scripts/upload-installer.mjs <platform> <fichier> https://docs.appvibed.com` fait l'upload chunké **et** l'enregistrement DB en une commande — mais le fichier ne survit pas à un redéploiement (préférer l'Object Storage pour une release durable).

> Dev et prod partagent la même DB Neon, donc l'enregistrement est visible des deux côtés. En mode Object Storage, le fichier est durable et téléchargeable depuis prod immédiatement.

---

## Workflow GitHub Actions (build uniquement, ou release auto par tag — NON utilisé)

**Repo** : `billos-e/TECHMA-DOCUMENTATION-PLATFORM`
**Fichier** : `.github/workflows/desktop-release.yml`

**Comportement selon le déclencheur** :

| Déclencheur | Build | Upload bucket GCS | Enregistrement DB |
|-------------|-------|------------|-------------------|
| `git push` sur un tag `desktop-agent-v*` | ✅ | ✅ (nécessite les secrets GCS_RELEASE_SA_KEY + INSTALLER_GCS_BUCKET) | ✅ |
| Déclenchement manuel (Actions → Run workflow) | ✅ | ❌ skippé | ❌ skippé |

> Le paramètre `dry_run` visible dans l'UI de déclenchement manuel est **non fonctionnel** — il est défini dans le YAML mais jamais lu dans les conditions. Le seul vrai interrupteur est le type d'événement (`push` sur tag vs `workflow_dispatch`). Un déclenchement manuel produit toujours un build-only.

> ⚠️ La voie auto par tag exige les secrets GitHub `GCS_RELEASE_SA_KEY` et `INSTALLER_GCS_BUCKET` (voir l'en-tête du workflow). Tant qu'ils ne sont pas renseignés, **utiliser le déclenchement manuel pour le build uniquement**, puis suivre la procédure de release ci-dessus.

## Notes Linux spécifiques

- Sur **Wayland** : l'app demande une autorisation de partage d'écran à chaque session (comportement normal du portail XDG/PipeWire, imposé par Wayland pour la sécurité). Pour éviter ce dialogue, utiliser une session **X11/Xorg** à la connexion.
- Sur **X11** : aucun dialogue de permission pour les captures d'écran.
- Installation propre recommandée lors d'une mise à jour : `sudo dpkg --purge docuflow-agent && sudo dpkg -i <nouveau.deb>` (évite les problèmes de permissions résiduelles si l'ancienne version avait le bug `700`).
