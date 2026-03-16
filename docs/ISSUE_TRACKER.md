# DocuFlow Desktop Agent — Issue Tracker

> Suivi des problèmes rencontrés lors du build et de l'installation.
> Score de pérennité : 🟢 Solide (fix durable) / 🟡 Fragile (contournement) / 🔴 Non résolu

---

## Tableau récapitulatif

| # | Problème | Statut | Solution appliquée | Pérennité |
|---|----------|--------|--------------------|-----------|
| 1 | `Update.exe` crash `.NET 0xe0434352` au démarrage | ✅ Résolu | Remplacé Squirrel par WiX MSI | 🟢 Solide — Squirrel supprimé définitivement |
| 2 | `ffmpeg.dll not found` (install corrompue par Squirrel) | ✅ Résolu | Nettoyage complet + nouveau MSI | 🟢 Solide — artefact Squirrel éliminé |
| 3 | WiX binaries absents du PATH système | ✅ Résolu | Binaires portables `.wix-tools/` + injection PATH dans `build-msi.js` | 🟡 Fragile — dépend du script custom, pas natif |
| 4 | Erreur codepage 1252 / em-dash `LGHT0311` | ✅ Résolu | `codepage: "65001"` + description sans tiret em | 🟢 Solide |
| 5 | `darice.cub not found` `LGHT0222` | ✅ Résolu | Extraction complète du zip WiX (pas seulement les exe) | 🟢 Solide |
| 6 | ZIP EBUSY (fichier verrouillé pendant build) | ✅ Résolu | Flag `--targets @electron-forge/maker-wix` | 🟡 Fragile — workaround, pas un vrai fix |
| 7 | Fenêtre invisible au démarrage (Windows 11 focus stealing) | ✅ Résolu | `setAlwaysOnTop(true)` → `show()` → `setAlwaysOnTop(false)` | 🟡 Fragile — hack Windows, peut casser sur futures versions |
| 8 | Processus fantômes multiples à chaque relance | ✅ Résolu | `app.requestSingleInstanceLock()` | 🟢 Solide — pattern standard Electron |
| 9 | MSI silencieux / UAC invisible (`perMachine: true`) | ✅ Résolu | Passé à `perMachine: false` (install per-user, pas d'admin) | 🟢 Solide |
| 10 | Shortcut Start Menu ne lance rien | ✅ Résolu (partiel) | Ajout `exe: "docuflow-agent.exe"` dans forge.config → WXS corrigé | 🟡 Fragile — voir #11 |
| 11 | **MSI installe la fenêtre mais ne dépose aucun fichier** | ✅ Résolu | Migration electron-builder NSIS (abandon WiX) | 🟢 Solide |
| 12 | Absent de "Recently added" / Apps | ✅ Résolu | NSIS gère le registre Windows nativement | 🟢 Solide |
| 13 | Installeur two-file : stub 190 KB + payload `.nsis.7z` 81 MB séparé | ✅ Résolu | `differentialPackage: false` dans config nsis electron-builder | 🟢 Solide |
| 14 | Raccourci "Missing Shortcut" après installation NSIS | ✅ Résolu | `executableName: "docuflow-agent"` dans `win` config electron-builder | 🟢 Solide |

---

## Détail — Problèmes résolus (#13 et #14) — 2026-03-06

### #13 — Installeur two-file (stub + `.nsis.7z`)

**Symptôme**
electron-builder générait deux fichiers : un stub `.exe` (~190 KB) + un payload `.nsis.7z` (~81 MB) séparé. L'installeur ne fonctionnait pas sans les deux fichiers ensemble.

**Cause**
`differentialPackage` dans la section `nsis` de `package.json` est `true` par défaut dans electron-builder. Sans le définir explicitement à `false`, le mode two-file est activé.

**Fix appliqué** (`desktop-agent/package.json`)
```json
"nsis": {
  "differentialPackage": false
}
```

**Résultat** : `release/DocuFlowAgentSetup.exe` — **65 MB single-file**, aucun `.nsis.7z`.

---

### #14 — Raccourci "Missing Shortcut" après installation

**Symptôme**
Après installation, Windows affichait "Windows is searching for DocuFlow Desktop Agent.exe" — le raccourci bureau/Start Menu ne pointait vers rien.

**Cause**
electron-builder déduit le nom de l'exécutable depuis le `productName` normalisé (`DocuFlow Desktop Agent.exe`), alors que electron-forge package l'exe sous le nom `docuflow-agent.exe` (défini par `executableName` dans `forge.config.ts`). Sans indiquer explicitement le bon nom à electron-builder, le raccourci pointait vers un exe inexistant.

**Fix appliqué** (`desktop-agent/package.json`)
```json
"win": {
  "target": "nsis",
  "executableName": "docuflow-agent"
}
```

---

## Détail — Problème actuel (#11)

### Symptôme
Le MSI lance bien la fenêtre d'installation (progress bar), l'utilisateur clique "Install", la fenêtre se ferme — mais aucun fichier n'est déposé sur le disque, aucune entrée dans le registre, aucun raccourci créé.

### Cause probable
`electron-wix-msi` (la lib sous-jacente à `@electron-forge/maker-wix`) génère un MSI avec des chemins sources absolus vers le dossier `out/`. Si ces chemins ne sont plus accessibles au moment où Windows Installer exécute l'installation (ex : fichier verrouillé, chemin trop long, permissions), l'installation échoue silencieusement sans rollback visible.

Le warning durant le build est également suspect :
```
Unable to access file "...DocuFlow Agent-win32-x64\DocuFlow Agent.exe"
```
WiX n'a pas pu lire l'exe principal lors de la génération — signe que le MSI produit est potentiellement incomplet.

### Ce qui a été essayé
- `perMachine: true` → `perMachine: false` ✅ (MSI se lance maintenant)
- `exe: "docuflow-agent.exe"` ✅ (WXS corrigé, shortcut pointe vers le bon exe)
- Lancement direct via `msiexec /i` et via double-clic ✅ (fenêtre apparaît)
- Malgré tout : aucun fichier installé ❌

---

## Proposition de solution — electron-builder (NSIS)

### Pourquoi changer de toolchain

`@electron-forge/maker-wix` est un wrapper mince autour de `electron-wix-msi`, une lib peu maintenue avec des bugs connus sur les chemins et les permissions Windows. WiX v3 lui-même est en fin de vie (remplacé par WiX v4/v5 depuis 2023).

**electron-builder** est le standard de facto pour packager des apps Electron en production :
- Utilisé par VS Code, Slack, Discord, WhatsApp Desktop
- Génère un installeur **NSIS** (`.exe`) ou **MSI** natif, tous deux fiables
- Supporte per-user et per-machine sans contournement
- Gère les icônes, le registre, Start Menu, "Recently added" automatiquement
- Compatible avec la configuration Webpack existante

### Plan de migration

```
1. npm install --save-dev electron-builder
2. Supprimer @electron-forge/maker-wix + @electron-forge/maker-squirrel
3. Ajouter config "build" dans package.json (nsis target)
4. Script de build : electron-forge package → electron-builder --win nsis
5. Output : DocuFlowAgentSetup.exe (NSIS, ~110 MB, signable, fiable)
```

### Avantages concrets
- Plus de WiX PATH, plus de `.wix-tools/`, plus de scripts custom
- Installeur `.exe` NSIS : UAC claire, "Recently added" ✅, raccourci bureau ✅
- Auto-update possible plus tard (electron-updater)
- Build reproductible en CI/CD GitHub Actions

### Risque
Faible — electron-builder ne touche pas au code source, uniquement au packaging.
La migration prend ~1h.

---

---

## État actuel de la toolchain (2026-03-09)

| Composant | Outil | Statut |
|-----------|-------|--------|
| Packaging | `electron-forge package` | ✅ Actif |
| Installeur | `electron-builder` NSIS | ✅ Actif |
| WiX / Squirrel | — | ❌ Supprimés |
| Build script | `scripts/dist-win.js` | ✅ Actif (`npm run dist:win`) |
| Output | `release/DocuFlowAgentSetup.exe` | ✅ Single-file, 65 MB |

*Dernière mise à jour : 2026-03-09*
