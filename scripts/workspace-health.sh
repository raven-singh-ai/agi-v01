#!/bin/bash
# workspace-health.sh — Self-monitoring for the AGI v0.1 workspace
# Checks file sizes, git status, daemon health, disk space
set -uo pipefail

WORKSPACE="${AGI_WORKSPACE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ISSUES=()
FIXED=()

# 1. Check injected files exist and aren't oversized
for f in SOUL.md AGENTS.md TOOLS.md MEMORY.md HEARTBEAT.md USER.md; do
  if [ ! -f "$WORKSPACE/$f" ]; then
    # Only warn about SOUL.md and AGENTS.md as critical
    case $f in
      SOUL.md|AGENTS.md) ISSUES+=("CRITICAL: $f is missing!") ;;
      *) ;; # Other files are optional
    esac
  else
    SIZE=$(wc -c < "$WORKSPACE/$f")
    case $f in
      SOUL.md)     [ $SIZE -gt 15000 ] && ISSUES+=("WARN: SOUL.md is ${SIZE}B (>15KB)") ;;
      TOOLS.md)    [ $SIZE -gt 3000 ]  && ISSUES+=("WARN: TOOLS.md is ${SIZE}B (>3KB)") ;;
      MEMORY.md)   [ $SIZE -gt 8000 ]  && ISSUES+=("WARN: MEMORY.md is ${SIZE}B (>8KB, needs split)") ;;
      AGENTS.md)   [ $SIZE -gt 10000 ] && ISSUES+=("WARN: AGENTS.md is ${SIZE}B (>10KB)") ;;
    esac
  fi
done

# 2. Check git status
cd "$WORKSPACE"
DIRTY=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
if [ "$DIRTY" -gt 20 ]; then
  ISSUES+=("WARN: $DIRTY uncommitted files in workspace")
elif [ "$DIRTY" -gt 5 ]; then
  git add -A 2>/dev/null
  git commit -m "AUTO: Workspace health auto-commit $(date +%Y-%m-%d_%H%M)" 2>/dev/null
  git push 2>/dev/null
  FIXED+=("Auto-committed $DIRTY dirty files")
fi

# 3. Check disk space
if command -v df &>/dev/null; then
  AVAIL_GB=$(df -g "$WORKSPACE" 2>/dev/null | tail -1 | awk '{print $4}' || echo "999")
  if [ "$AVAIL_GB" -lt 5 ]; then
    ISSUES+=("WARN: Only ${AVAIL_GB}GB disk space remaining")
  fi
fi

# 4. Check memory directory size
if [ -d "$WORKSPACE/memory/" ]; then
  MEMORY_SIZE=$(du -sm "$WORKSPACE/memory/" 2>/dev/null | awk '{print $1}')
  if [ "$MEMORY_SIZE" -gt 50 ]; then
    ISSUES+=("WARN: memory/ is ${MEMORY_SIZE}MB — consider archiving")
  fi
fi

# 5. Check Thalamus daemon
THALAMUS_PID=$(pgrep -f "thalamus.js" 2>/dev/null || echo "")
if [ -z "$THALAMUS_PID" ]; then
  ISSUES+=("CRITICAL: Thalamus NOT RUNNING")
else
  echo "  - Thalamus: running (PID $THALAMUS_PID)"
fi

# 6. Check Thalamus heartbeat
if [ -f "$WORKSPACE/data/thalamus-heartbeat.json" ]; then
  HEARTBEAT_AGE=$(( $(date +%s) - $(stat -f %m "$WORKSPACE/data/thalamus-heartbeat.json" 2>/dev/null || stat -c %Y "$WORKSPACE/data/thalamus-heartbeat.json" 2>/dev/null || echo 0) ))
  if [ "$HEARTBEAT_AGE" -gt 300 ]; then
    ISSUES+=("WARN: Thalamus heartbeat stale (${HEARTBEAT_AGE}s)")
  fi
fi

# Report
if [ ${#ISSUES[@]} -eq 0 ] && [ ${#FIXED[@]} -eq 0 ]; then
  echo "WORKSPACE_HEALTHY"
else
  if [ ${#FIXED[@]} -gt 0 ]; then
    echo "SELF_HEALED:"
    printf '  - %s\n' "${FIXED[@]}"
  fi
  if [ ${#ISSUES[@]} -gt 0 ]; then
    echo "ISSUES:"
    printf '  - %s\n' "${ISSUES[@]}"
  fi
fi
