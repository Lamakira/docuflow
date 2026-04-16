#!/usr/bin/env bash
# publish-release.sh — Publish a DocuFlow Desktop Agent installer to the app server.
#
# Per-platform independent: run once for macOS now, again for Linux later.
# Windows, macOS, and Linux releases are entirely separate.
#
# Usage:
#   ./scripts/publish-release.sh --version 0.1.6 --platform macos \
#       --file "desktop-agent/out/make/DocuFlow-Agent-0.1.6-macos.dmg"
#
# Environment variables (or pass as flags):
#   DOCUFLOW_API_URL           — base URL, e.g. https://docuflow.replit.app
#   DESKTOP_RELEASE_CI_TOKEN   — auth token (must match server secret)
#
# The API URL can also live in ~/.docuflow-url (one line, no trailing slash).
#
# Requirements: curl, shasum (macOS) or sha256sum (Linux)

set -euo pipefail

# ── Argument parsing ──────────────────────────────────────────────────────────
VERSION=""
PLATFORM=""
FILE_PATH=""
API_URL="${DOCUFLOW_API_URL:-}"
TOKEN="${DESKTOP_RELEASE_CI_TOKEN:-}"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --version)  VERSION="$2";   shift 2 ;;
        --platform) PLATFORM="$2";  shift 2 ;;
        --file)     FILE_PATH="$2"; shift 2 ;;
        --api-url)  API_URL="$2";   shift 2 ;;
        --token)    TOKEN="$2";     shift 2 ;;
        *) echo "Unknown argument: $1"; exit 1 ;;
    esac
done

# ── Resolve API URL ───────────────────────────────────────────────────────────
if [[ -z "$API_URL" ]] && [[ -f "$HOME/.docuflow-url" ]]; then
    API_URL=$(cat "$HOME/.docuflow-url" | tr -d '[:space:]')
fi
if [[ -z "$API_URL" ]]; then
    echo "Error: API URL not found. Set DOCUFLOW_API_URL, pass --api-url, or create ~/.docuflow-url"
    exit 1
fi
API_URL="${API_URL%/}"  # strip trailing slash

# ── Validate required args ────────────────────────────────────────────────────
if [[ -z "$VERSION" || -z "$PLATFORM" || -z "$FILE_PATH" ]]; then
    echo "Usage: $0 --version <semver> --platform <windows|macos|linux> --file <path>"
    exit 1
fi
if [[ ! "$PLATFORM" =~ ^(windows|macos|linux)$ ]]; then
    echo "Error: platform must be one of: windows, macos, linux"
    exit 1
fi
if [[ ! -f "$FILE_PATH" ]]; then
    echo "Error: file not found: $FILE_PATH"
    exit 1
fi
if [[ -z "$TOKEN" ]]; then
    echo "Error: auth token not found. Set DESKTOP_RELEASE_CI_TOKEN or pass --token"
    exit 1
fi

# ── File info ─────────────────────────────────────────────────────────────────
ORIGINAL_FILENAME=$(basename "$FILE_PATH")
FILE_SIZE_BYTES=$(wc -c < "$FILE_PATH" | tr -d ' ')
FILE_SIZE_MB=$(awk "BEGIN { printf \"%.1f\", $FILE_SIZE_BYTES / 1048576 }")

echo ""
echo "DocuFlow Release Publisher"
echo "──────────────────────────────────────────────"
echo "  Version  : $VERSION"
echo "  Platform : $PLATFORM"
echo "  File     : $ORIGINAL_FILENAME"
echo "  Size     : ${FILE_SIZE_MB} MB (${FILE_SIZE_BYTES} bytes)"
echo ""
echo -n "  Computing SHA256... "

# shasum is macOS; sha256sum is Linux
if command -v sha256sum &>/dev/null; then
    SHA256=$(sha256sum "$FILE_PATH" | awk '{print $1}')
elif command -v shasum &>/dev/null; then
    SHA256=$(shasum -a 256 "$FILE_PATH" | awk '{print $1}')
else
    echo "Error: neither sha256sum nor shasum found"
    exit 1
fi
echo "done"
echo "  SHA256   : $SHA256"
echo ""

# ── Confirm ───────────────────────────────────────────────────────────────────
read -r -p "  Upload to $API_URL ? [y/N] " confirm
if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
fi

# ── Upload ────────────────────────────────────────────────────────────────────
UPLOAD_URL="$API_URL/api/internal/desktop-releases/upload"
echo ""
echo "  Uploading ${FILE_SIZE_MB} MB to $UPLOAD_URL ..."

HTTP_STATUS=$(curl \
    --silent \
    --show-error \
    --output /tmp/docuflow-publish-response.json \
    --write-out "%{http_code}" \
    --request POST "$UPLOAD_URL" \
    --header "Authorization: Bearer $TOKEN" \
    --header "Content-Type: application/octet-stream" \
    --header "X-Version: $VERSION" \
    --header "X-Platform: $PLATFORM" \
    --header "X-Filename: $ORIGINAL_FILENAME" \
    --header "X-SHA256: $SHA256" \
    --data-binary "@$FILE_PATH" \
    --max-time 300)

RESPONSE_BODY=$(cat /tmp/docuflow-publish-response.json)

if [[ "$HTTP_STATUS" == "201" ]]; then
    echo ""
    echo "  Published successfully!"
    echo ""
    echo "$RESPONSE_BODY" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE_BODY"
    echo ""
    # Extract storageUrl for display
    STORAGE_URL=$(echo "$RESPONSE_BODY" | grep -o '"storageUrl":"[^"]*"' | cut -d'"' -f4)
    echo "  Download URL: ${API_URL}${STORAGE_URL}"
    echo ""
else
    echo ""
    echo "  Upload failed (HTTP $HTTP_STATUS)"
    echo "  $RESPONSE_BODY"
    echo ""
    exit 1
fi
