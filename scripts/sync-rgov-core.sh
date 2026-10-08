#!/usr/bin/env bash
# Re-vendor rgov-core.js from a quantum-os checkout: scripts/sync-rgov-core.sh ../quantum-os
set -euo pipefail
QOS="${1:?path to a quantum-os checkout}"
rev=$(git -C "$QOS" rev-parse --short HEAD)
out="$(dirname "$0")/../src/chain/rgov-core.js"
{ echo "// VENDORED from rchain-community/quantum-os@$rev packages/browser/src/rgov-core.js — do not edit here;"
  echo "// change it upstream and re-copy (scripts/sync-rgov-core.sh). Design: quantum-os RGov_Core.md."
  cat "$QOS/packages/browser/src/rgov-core.js"; } > "$out"
node "$out" --selftest | tail -1
