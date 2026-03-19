# DocuFlow Desktop Agent — Download & Distribution Guide

> Current version: **v0.1.3**

---

## Platform Status

| Platform | Official artifact | Status | Validation | Build command |
|----------|------------------|--------|------------|---------------|
| **Windows** | `DocuFlow-Agent-0.1.3-windows-setup.exe` | ✅ Stable | Tested in production | `npm run dist:win` |
| **macOS** | `DocuFlow-Agent-0.1.3-macos.dmg` | 🔶 Beta | In testing (real device) | `npm run dist:mac` |
| **Linux (Ubuntu)** | `DocuFlow-Agent-0.1.3-linux-amd64.deb` | 🧪 Experimental | Build verified, runtime not yet tested on real hardware | `npm run dist:ubuntu` |

---

## Building

### Prerequisites (all platforms)

```bash
cd desktop-agent
npm install
```

### Windows

```bash
npm run dist:win
```

- Must run on **Windows 10/11**
- Temporarily disable Avast/Defender real-time protection during the build (the NSIS writer gets file-locked otherwise)
- Output: `desktop-agent/release/DocuFlow-Agent-0.1.3-windows-setup.exe` (~65 MB)

### macOS

```bash
# Step 1 — generate .icns icon (first time only, on macOS)
node scripts/gen-icons.js

# Step 2 — build DMG
npm run dist:mac
```

- Must run on **macOS** (maker-dmg uses `hdiutil`, macOS-only tool)
- Output: `desktop-agent/release/DocuFlow-Agent-0.1.3-macos.dmg`
- No code signing configured — Gatekeeper will warn on first launch

### Linux (Ubuntu)

```bash
npm run dist:ubuntu
```

- Must run on **Linux** (electron-forge cannot cross-compile .deb from Windows)
- Output: `desktop-agent/release/DocuFlow-Agent-0.1.3-linux-amd64.deb`

---

## User Installation

### Windows

1. Download `DocuFlow-Agent-0.1.3-windows-setup.exe`
2. SmartScreen may warn — click **More info → Run anyway** (app is not yet code-signed)
3. Follow the setup wizard — no admin rights needed (installs per-user)
4. Start Menu → **DocuFlow Desktop Agent**

**Uninstall:** Settings → Apps → DocuFlow Desktop Agent → Uninstall
or: `powershell -ExecutionPolicy Bypass -File "desktop-agent/scripts/uninstall-agent.ps1"`

### macOS

1. Download `DocuFlow-Agent-0.1.3-macos.dmg`
2. Open the .dmg, drag **DocuFlow Agent.app** to `/Applications`
3. **First launch:** right-click the app → **Open** → **Open** (bypasses Gatekeeper for unsigned builds — one-time only)
4. App appears in the menu bar (system tray equivalent on macOS)
5. **Screenshots:** macOS will request Screen Recording permission on first capture — allow in System Settings → Privacy & Security → Screen Recording

### Linux (Ubuntu)

```bash
sudo dpkg -i DocuFlow-Agent-0.1.3-linux-amd64.deb
```

Launch from the Applications menu or terminal: `docuflow-agent`

**System tray:** requires `libayatana-appindicator3-1` (auto-installed as dependency).
On GNOME without AppIndicator extension: the tray icon may not appear — the app still runs and can be opened from the app menu.

---

## First Launch (all platforms)

1. Open DocuFlow Desktop Agent
2. Enter your DocuFlow **email** and **password** (same credentials as the web app)
3. Click **Sign in**
4. The device appears in the web app under **Devices**

No pairing codes. No server URL to enter. The server URL is baked into the build.

---

## URL Override (dev / staging)

To point the agent at a different server, create `~/.docuflow-url` with the target URL:

```
# ~/.docuflow-url
https://your-dev-server.example.com
```

| OS | Path |
|----|------|
| Windows | `C:\Users\<you>\.docuflow-url` |
| macOS | `/Users/<you>/.docuflow-url` |
| Linux | `/home/<you>/.docuflow-url` |

Delete the file to revert to the production URL baked into the build.

---

## Logs & Config Paths

| OS | Config (agent-config.json) | Logs (debug.log) |
|----|---------------------------|-----------------|
| Windows | `%APPDATA%\docuflow-desktop-agent\` | same dir |
| macOS | `~/Library/Application Support/docuflow-desktop-agent/` | same dir |
| Linux | `~/.config/docuflow-desktop-agent/` | same dir |

---

## Publishing to GitHub Releases

All three artifacts are published under the same tag:

```bash
gh release create desktop-agent-v0.1.3 \
  "desktop-agent/release/DocuFlow-Agent-0.1.3-windows-setup.exe" \
  "desktop-agent/release/DocuFlow-Agent-0.1.3-macos.dmg" \
  "desktop-agent/release/DocuFlow-Agent-0.1.3-linux-amd64.deb" \
  --title "Desktop Agent v0.1.3" \
  --notes "See docs/DESKTOP_RELEASE_LOG.md for full release notes."
```

After publishing, update the download URL constants in:
`client/src/pages/TimeTrackingDownloadPage.tsx`

---

## Updating the Download URLs

When a new version is released, update these three constants in `TimeTrackingDownloadPage.tsx`:

```typescript
const DOWNLOAD_URL_WINDOWS = "https://github.com/CarineEpitech/docuflow/releases/download/desktop-agent-v{VERSION}/DocuFlow-Agent-{VERSION}-windows-setup.exe";
const DOWNLOAD_URL_MACOS   = "https://github.com/CarineEpitech/docuflow/releases/download/desktop-agent-v{VERSION}/DocuFlow-Agent-{VERSION}-macos.dmg";
const DOWNLOAD_URL_LINUX   = "https://github.com/CarineEpitech/docuflow/releases/download/desktop-agent-v{VERSION}/DocuFlow-Agent-{VERSION}-linux-amd64.deb";
const AGENT_VERSION = "v{VERSION}";
```

---

## Version Bumping

1. Update `version` in `desktop-agent/package.json`
2. Update `AGENT_VERSION` + all three `DOWNLOAD_URL_*` constants in `TimeTrackingDownloadPage.tsx`
3. Rebuild all platform artifacts
4. Publish GitHub Release
5. Add entry to `docs/DESKTOP_RELEASE_LOG.md`

---

## Troubleshooting

### Windows — "Windows cannot access the specified device"
File blocked after download → right-click → Properties → check **Unblock** → OK

### Windows — Antivirus blocking during build
Avast/Defender locks the output `.exe` while scanning:
- Temporarily disable File Shield → re-run `npm run dist:win`

### Windows — App not starting after install
Delete leftover AppData and reinstall:
```
%LOCALAPPDATA%\DocuFlow Desktop Agent\
%APPDATA%\docuflow-desktop-agent\
```

### macOS — "DocuFlow Agent is damaged and can't be opened"
Quarantine flag from download — run: `xattr -cr /Applications/"DocuFlow Agent.app"`

### Linux — dpkg dependency error
```bash
sudo apt-get install -f
```
This resolves missing `libayatana-appindicator3-1` or other deps.

### Linux — Screenshots not working (Wayland)
Ensure `xdg-desktop-portal` and PipeWire are installed (standard on Ubuntu 22.04+).
The agent enables PipeWire capture automatically on Linux — no manual config needed.

---

## Known Limitations

| Limitation | Windows | macOS | Linux |
|-----------|---------|-------|-------|
| No code signing | ⚠️ SmartScreen warns | ⚠️ Gatekeeper warns | N/A |
| No auto-update | ⚠️ Manual download | ⚠️ Manual download | ⚠️ Manual download |
| Screenshots on Wayland | N/A | N/A | ⚠️ Requires xdg-desktop-portal |
| Tray on GNOME | N/A | N/A | ⚠️ Requires AppIndicator extension |
| Apple Silicon (arm64) | N/A | ⚠️ Via Rosetta only (x64 build) | N/A |
