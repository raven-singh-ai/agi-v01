#!/bin/bash
# pre-compaction.sh — Save state before context compaction
# Ensures cognitive state survives context resets
set -e

WORKSPACE="${AGI_WORKSPACE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
TODAY=$(date +%Y-%m-%d)
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)

mkdir -p "$WORKSPACE/memory/context-archive" "$WORKSPACE/memory/artifacts"

echo "📦 Pre-compaction save at $NOW"

# Archive current ACTIVE_CONTEXT if it exists
if [ -f "$WORKSPACE/ACTIVE_CONTEXT.md" ]; then
  cp "$WORKSPACE/ACTIVE_CONTEXT.md" "$WORKSPACE/memory/context-archive/${TODAY}-pre-compaction.md"
  echo "  📎 Archived ACTIVE_CONTEXT.md"
fi

# Archive current BOOTSTRAP.md
if [ -f "$WORKSPACE/BOOTSTRAP.md" ]; then
  cp "$WORKSPACE/BOOTSTRAP.md" "$WORKSPACE/memory/context-archive/${TODAY}-bootstrap.md"
  echo "  📋 Archived BOOTSTRAP.md"
fi

# Ensure deep recovery is fresh
if [ -f "$WORKSPACE/data/deep-recovery.md" ]; then
  AGE=$(( $(date +%s) - $(stat -f %m "$WORKSPACE/data/deep-recovery.md" 2>/dev/null || stat -c %Y "$WORKSPACE/data/deep-recovery.md" 2>/dev/null || echo 0) ))
  if [ "$AGE" -gt 600 ]; then
    echo "  ⚠️ Deep recovery is ${AGE}s old — may be stale"
  else
    echo "  ✅ Deep recovery is fresh (${AGE}s)"
  fi
fi

# Git commit
cd "$WORKSPACE"
git add -A 2>/dev/null
git commit -m "PRE-COMPACTION: save state $NOW" 2>/dev/null || true

echo "📦 Pre-compaction complete. Thalamus context organ + deep recovery will survive."
