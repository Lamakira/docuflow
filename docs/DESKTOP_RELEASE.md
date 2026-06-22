# DocuFlow Desktop Agent — Release Guide

## Emplacement des installeurs

Stockés dans Google Cloud Storage (GCS), bucket `replit-objstore-64708bc7-367f-45c8-9004-db72f81cbeba`, dossier `public/installers/`.

> ⚠️ **Important** : ce bucket est l'**Object Storage Replit** (service account `heimdall-production`). Il est accessible **uniquement depuis l'environnement Replit** (shell de dev ou déploiement) via le **sidecar interne** (`http://127.0.0.1:1106`). Aucun compte Google, service account ou bucket externe n'est requis. Il n'est **pas** accessible depuis GitHub Actions (les runners ne peuvent pas joindre le sidecar) — c'est pourquoi la publication automatique 100 % CI vers ce bucket n'est pas possible.

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

**v0.1.9 — à publier** (correctifs UX) :

Changements inclus dans v0.1.9 :
- **Bouton + pour créer des tâches** dans le picker projet/tâche de l'agent
- **Formulaire inline de création de projet** dans l'agent (+ dans la colonne Projets)
- **Icône tray macOS corrigée** — utilise maintenant `tray-icon.png` (16×16) au lieu de `icon.png` (grande icône)
- **Screenshots visibles** — les fichiers locaux ne sont plus supprimés après upload ; nettoyage automatique des fichiers > 30 jours
- **Erreur de création de projet explicite** — le message d'erreur réel est retourné au lieu du message générique

> Pour publier v0.1.9, suivre la procédure ci-dessous (build + upload GCS + enregistrement DB avec version `0.1.9`).

## Architecture de distribution

- Les installeurs sont trop volumineux (~65-94 MB) pour le proxy inverse de Replit (~50 MB max)
- Solution : `server/downloadRoutes.ts` génère des **URL signées** (valides 15 min) via une redirection 302, le téléchargement se fait directement depuis l'Object Storage
- Endpoint de disponibilité : `GET /downloads/availability` → `{ windows: bool, macos: bool, linux: bool }`
- Endpoint de téléchargement : `GET /downloads/:platform` → 302 vers URL signée (si `storageUrl` est une URL `https://storage.googleapis.com/...`) OU stream local depuis `installers/` (si `storageUrl` est `/downloads/:platform`)
- La DB (`desktop_releases`) stocke le `storageUrl`, `sha256`, `fileSize` et `isLatest` par plateforme

## Deux modes de stockage supportés (les deux sans Google externe)

1. **Object Storage Replit** (mode actuel pour v0.1.7) — `storageUrl = https://storage.googleapis.com/replit-objstore-.../public/installers/<fichier>`, signé au téléchargement via le sidecar. Persiste à travers les redéploiements.
2. **Fichier local** — `storageUrl = /downloads/:platform`, le fichier vit dans le dossier `installers/` du serveur. Plus simple mais **ne persiste pas** sur le filesystem éphémère d'un déploiement Replit (raison de la migration vers l'Object Storage).

## Scripts de build (`desktop-agent/scripts/`)

- `dist-win.js` — build Windows NSIS installer via electron-forge + electron-builder
- `dist-mac.js` — build macOS DMG (requiert macOS + certificats Apple)
- `dist-linux.js` — build Linux .deb ; inclut deux correctifs critiques :
  1. **Fix permissions Step 1.5** : `chmod 755` sur le dossier `out/` après `electron-forge package` (electron-forge crée parfois le dossier en `700`, bloquant l'accès aux utilisateurs normaux)
  2. **Patch postinst Step 3** : extrait le `.deb`, injecte `chmod 755 '/opt/DocuFlow Desktop Agent'` dans le script `postinst`, et repackage le `.deb` — permet que les permissions soient corrigées même lors d'une **mise à jour** (dpkg ne remet pas à jour les permissions d'un dossier existant)
- `fix-permissions.js` — correctif de permissions (utilisé lors du build, non invoqué directement)

## Scripts de release (`scripts/`, à la racine — exécutés depuis le shell Replit)

- `upload-to-gcs.mjs` — upload un installeur vers l'Object Storage Replit via le sidecar (PUT signé). N'enregistre **pas** en DB ; affiche le `gs://...` à convertir en URL HTTPS pour l'enregistrement.
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

## Procédure de release (sans Google externe) — RECOMMANDÉE

C'est la méthode qui a réellement servi pour v0.1.7. **Aucun bucket Google externe, aucun service account.**

1. **Compiler** les installeurs via GitHub Actions :
   - Soit déclencher manuellement le workflow (Actions → `Desktop Agent — Release` → Run workflow) → build-only, produit 3 artifacts (rétention 7 jours).
   - Soit `npm run dist:win` / `dist:mac` / `dist:linux` localement sur la bonne plateforme.
2. **Récupérer les 3 artifacts** dans l'environnement Replit (téléchargement depuis l'UI GitHub Actions, ou `gh run download <run-id>` si `gh` est authentifié).
3. **Uploader vers l'Object Storage** (mode actuel) depuis le shell Replit, pour chaque plateforme :
   ```bash
   node scripts/upload-to-gcs.mjs windows <chemin>/DocuFlow-Agent-0.1.8-windows-setup.exe
   node scripts/upload-to-gcs.mjs macos   <chemin>/DocuFlow-Agent-0.1.8-macos.dmg
   node scripts/upload-to-gcs.mjs linux   <chemin>/DocuFlow-Agent-0.1.8-linux-amd64.deb
   ```
4. **Enregistrer en DB** chaque plateforme via le `curl` metadata-only ci-dessus (avec l'URL HTTPS `storage.googleapis.com/...` et le SHA256 affiché par le script).

> Alternative tout-en-un (mode fichier local) : `node scripts/upload-installer.mjs <platform> <fichier> https://docs.appvibed.com` fait l'upload chunké **et** l'enregistrement DB en une commande — mais le fichier ne survit pas à un redéploiement (préférer l'Object Storage pour une release durable).

> Dev et prod partagent la même DB Neon, donc l'enregistrement est visible des deux côtés. En mode Object Storage, le fichier est durable et téléchargeable depuis prod immédiatement.

---

## Workflow GitHub Actions (build uniquement, ou release auto via bucket externe — NON utilisé)

**Repo** : `billos-e/TECHMA-DOCUMENTATION-PLATFORM`
**Fichier** : `.github/workflows/desktop-release.yml`

**Comportement selon le déclencheur** :

| Déclencheur | Build | Upload bucket externe | Enregistrement DB |
|-------------|-------|------------|-------------------|
| `git push` sur un tag `desktop-agent-v*` | ✅ | ✅ (nécessite un bucket GCS externe + SA) | ✅ |
| Déclenchement manuel (Actions → Run workflow) | ✅ | ❌ skippé | ❌ skippé |

> Le paramètre `dry_run` visible dans l'UI de déclenchement manuel est **non fonctionnel** — il est défini dans le YAML mais jamais lu dans les conditions. Le seul vrai interrupteur est le type d'événement (`push` sur tag vs `workflow_dispatch`). Un déclenchement manuel produit toujours un build-only.

> ⚠️ La voie auto par tag exige un **bucket GCS externe** (les runners GitHub ne peuvent pas joindre le sidecar Replit). Comme la création d'un tel bucket n'est pas possible ici, **utiliser le déclenchement manuel pour le build uniquement**, puis suivre la "Procédure de release (sans Google externe)" ci-dessus. Le déclenchement manuel reste donc le mode normal d'utilisation de ce workflow.

## Notes Linux spécifiques

- Sur **Wayland** : l'app demande une autorisation de partage d'écran à chaque session (comportement normal du portail XDG/PipeWire, imposé par Wayland pour la sécurité). Pour éviter ce dialogue, utiliser une session **X11/Xorg** à la connexion.
- Sur **X11** : aucun dialogue de permission pour les captures d'écran.
- Installation propre recommandée lors d'une mise à jour : `sudo dpkg --purge docuflow-agent && sudo dpkg -i <nouveau.deb>` (évite les problèmes de permissions résiduelles si l'ancienne version avait le bug `700`).
