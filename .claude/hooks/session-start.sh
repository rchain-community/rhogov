#!/bin/bash
# SessionStart hook for Claude Code cloud sessions: install dependencies so the
# typecheck, unit tests, build and browser tests run straight away.
set -euo pipefail

# Cloud sessions only; a local checkout manages its own setup.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# npm install (not ci) so the cached container keeps node_modules between sessions.
npm install --no-audit --no-fund

# Browser tests: use the container's pre-installed Chromium rather than
# downloading one (playwright.config.ts honours CHROMIUM_PATH).
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  chrome="$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome 2>/dev/null | sort -V | tail -1 || true)"
  if [ -n "$chrome" ]; then
    echo "export CHROMIUM_PATH=\"$chrome\"" >> "$CLAUDE_ENV_FILE"
  fi
  echo "export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1" >> "$CLAUDE_ENV_FILE"
fi
