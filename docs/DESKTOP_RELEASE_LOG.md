# DocuFlow Desktop Agent — Release Log

> Updated after each build. Single source of truth for GitHub Release preparation.

---

## Distribution Strategy

| Platform | Official artifact | Status | Build command |
|----------|------------------|--------|---------------|
| **Windows** | `DocuFlow-Agent-{v}-windows-setup.exe` | ✅ Stable | `npm run dist:win` (Windows only) |
| **macOS** | `DocuFlow-Agent-{v}-macos.dmg` | 🔶 Beta | `npm run dist:mac` (macOS only) |
| **Linux (Ubuntu)** | `DocuFlow-Agent-{v}-linux-amd64.deb` | 🧪 Experimental | `npm run dist:ubuntu` (Linux only) |

**GitHub tag format:** `desktop-agent-v{version}`
**All three artifacts published under the same tag.**

### Deprecated artifact names (do not use)
- `DocuFlowAgentSetup.exe` — old naming, replaced by `DocuFlow-Agent-{v}-windows-setup.exe`
- `DocuFlowAgentSetup-{v}.msi` — Squirrel/WiX era, removed in v0.1.1
- Any ZIP-only distribution — fallback only, not promoted

### GitHub Releases cleanup
- **v0.1.1**: deprecated — references Squirrel/WiX, old auth flow → delete or archive
- **v0.1.2**: deprecated — references pairing code + server URL field → delete or archive
- **v0.1.3**: current official release (multi-OS)

---

## v0.1.3 — Current Release

| | |
|---|---|
| **Version** | 0.1.3 |
| **Date** | 2026-03-19 |
| **Branch** | `claude/desktop-ui-v2` |
| **Status** | Multi-OS build ready |

### Artifacts

| Platform | File | Size | Validation |
|----------|------|------|------------|
| Windows | `DocuFlow-Agent-0.1.3-windows-setup.exe` | ~65 MB | ✅ Tested |
| macOS | `DocuFlow-Agent-0.1.3-macos.dmg` | ~180 MB est. | 🔶 In testing |
| Linux | `DocuFlow-Agent-0.1.3-linux-amd64.deb` | ~120 MB est. | 🧪 Build verified |

### What changed since v0.1.2

**Auth & pairing**
- Pairing code flow fully removed
- Login is now email + password (same DocuFlow credentials)
- Server URL removed from UI — hardcoded in build, overridable via `~/.docuflow-url`
- Device name auto-derived from OS hostname

**Features**
- Task support: desktop timer now loads and displays tasks from the server
- Resizable window (min 400×500, max full screen)

**Platform**
- Linux (Ubuntu 20.04+): `.deb` artifact added
- macOS: `.dmg` artifact added (Beta)
- Wayland screenshot support enabled on Linux (PipeWire)
- Cross-platform log/config paths documented

**Stability**
- JWT refresh hardened — automatic token rotation
- Device revoke immediately stops all workers and returns to login screen
- `requireActiveDevice()` no longer accepts `deviceId` from request body

### Known issues

- `DEFAULT_API_URL` in `config.ts` points to Replit preview — **update to production URL before distributing publicly**
- No code signing on any platform (Windows SmartScreen + macOS Gatekeeper will warn)
- No auto-update — users must download new versions manually
- macOS: Apple Silicon (M1/M2) not natively supported — runs via Rosetta (x64 build)

### Windows — manual test checklist (post-install)

- [ ] App launches → login screen shown
- [ ] Sign in with valid DocuFlow credentials → connected state
- [ ] Select a project in the timer dropdown
- [ ] Select a task (or create one via "+ New task")
- [ ] Start timer → timer counts up
- [ ] Pause / Resume timer
- [ ] Stop timer
- [ ] App minimizes to tray on window close
- [ ] App restores from tray click
- [ ] Session restored after app restart (no re-login)
- [ ] Revoke device from web app → desktop returns to login screen
- [ ] Window resizable and maximizes properly

### macOS — validation checklist (Beta tester)

- [ ] Download .dmg → mounts without error
- [ ] Drag DocuFlow Agent.app to Applications
- [ ] First launch: right-click → Open → Open (bypasses Gatekeeper)
- [ ] App appears in menu bar (top-right tray area)
- [ ] Login screen displayed correctly
- [ ] Sign in with DocuFlow credentials → connected
- [ ] Projects list loads
- [ ] Task list loads
- [ ] Start timer → timer counts and updates
- [ ] Pause timer → timer stops counting
- [ ] Resume timer → timer resumes
- [ ] Stop timer → entry saved
- [ ] Screenshots: macOS requests Screen Recording permission → grant → captures working
- [ ] Close window → app stays in menu bar (does not quit)
- [ ] Click menu bar icon → window reopens
- [ ] Restart app → session restored, no re-login
- [ ] No crash on extended use (15+ min active)
- [ ] `~/.docuflow-url` override works (optional, dev only)

### Linux — manual test checklist (Experimental, Ubuntu 20.04+)

- [ ] `sudo dpkg -i DocuFlow-Agent-0.1.3-linux-amd64.deb` completes without error
- [ ] App launches from Applications menu
- [ ] Login screen shown
- [ ] Sign in with DocuFlow credentials → connected
- [ ] Timer start / pause / resume / stop
- [ ] System tray visible (requires libayatana-appindicator3-1 or AppIndicator GNOME extension)
- [ ] Screenshots working (X11: immediate; Wayland: requires Screen Recording permission popup)

### Recommended GitHub Release title

```
Desktop Agent v0.1.3 — Multi-OS: Windows + macOS (Beta) + Linux (Experimental)
```

### Recommended tag

```
desktop-agent-v0.1.3
```

### GitHub Release description (ready to paste)

```markdown
## DocuFlow Desktop Agent v0.1.3

### Downloads

| Platform | File | Status |
|----------|------|--------|
| Windows 10/11 | DocuFlow-Agent-0.1.3-windows-setup.exe | ✅ Stable |
| macOS 12+ | DocuFlow-Agent-0.1.3-macos.dmg | 🔶 Beta |
| Ubuntu 20.04+ | DocuFlow-Agent-0.1.3-linux-amd64.deb | 🧪 Experimental |

### What's new
- Sign in with your DocuFlow email and password — no pairing codes
- Task support: select tasks directly in the desktop timer
- Multi-OS: macOS and Linux (Ubuntu) builds now available
- Improved session stability: automatic JWT refresh, clean device revoke

### Installation

**Windows:** run the .exe installer. If SmartScreen warns, click More info → Run anyway.

**macOS:** open the .dmg, drag to Applications. First launch: right-click → Open (unsigned build — one-time bypass).

**Linux (Ubuntu):** `sudo dpkg -i DocuFlow-Agent-0.1.3-linux-amd64.deb`

### Upgrading from v0.1.1 / v0.1.2
Uninstall the old version first, then install v0.1.3. Sign in with email + password (no pairing code needed).

### Requirements
- DocuFlow account
- Windows 10/11, macOS 12+, or Ubuntu 20.04+ (all 64-bit)

> **Note:** This release connects to the DocuFlow hosted server. No manual server configuration needed.
```

---

## Release Template

For future releases, copy this block:

```markdown
## v{VERSION}

| | |
|---|---|
| **Version** | {VERSION} |
| **Date** | {DATE} |
| **Branch** | `{BRANCH}` |
| **Status** | Built / RC / Released |

### Artifacts

| Platform | File | Validation |
|----------|------|------------|
| Windows | `DocuFlow-Agent-{VERSION}-windows-setup.exe` | |
| macOS | `DocuFlow-Agent-{VERSION}-macos.dmg` | |
| Linux | `DocuFlow-Agent-{VERSION}-linux-amd64.deb` | |

### What changed since v{PREV}
-

### Known issues
-

### Manual test checklist
- [ ] Windows: login / timer / tray / session restore
- [ ] macOS: login / timer / menu bar / Gatekeeper bypass / screenshots
- [ ] Linux: install / login / timer / tray

### GitHub Release description
(paste here)
```

---

## v0.1.2 — Archived

| | |
|---|---|
| **Status** | ⚠️ Deprecated — pairing code + server URL field (both removed in v0.1.3) |
| **Action** | Delete GitHub Release |

---

## v0.1.1 — Archived

| | |
|---|---|
| **Status** | ⚠️ Deprecated — Squirrel/WiX era, old auth flow |
| **Action** | Delete GitHub Release |
