#!/bin/bash
# Workspace Health Check — Self-monitoring system
ISSUES=()
FIXED=()

# 1. Check injected files exist and aren't oversized
for f in SOUL.md AGENTS.md TOOLS.md MEMORY.md HEARTBEAT.md USER.md; do
  if [ ! -f ~/clawd/$f ]; then
    ISSUES+=("CRITICAL: $f is missing!")
  else
    SIZE=$(wc -c < ~/clawd/$f)
    case $f in
      SOUL.md)     [ $SIZE -gt 15000 ] && ISSUES+=("WARN: SOUL.md is ${SIZE}B (>15KB, will truncate)") ;;
      TOOLS.md)    [ $SIZE -gt 3000 ]  && ISSUES+=("WARN: TOOLS.md is ${SIZE}B (>3KB, too fat)") ;;
      MEMORY.md)   [ $SIZE -gt 8000 ]  && ISSUES+=("WARN: MEMORY.md is ${SIZE}B (>8KB, needs split)") ;;
      AGENTS.md)   [ $SIZE -gt 10000 ] && ISSUES+=("WARN: AGENTS.md is ${SIZE}B (>10KB, trim it)") ;;
    esac
  fi
done

# 2. Check WAKE.md freshness
if [ -f ~/clawd/WAKE.md ]; then
  WAKE_AGE=$(( $(date +%s) - $(stat -f %m ~/clawd/WAKE.md 2>/dev/null || stat -c %Y ~/clawd/WAKE.md 2>/dev/null || echo 0) ))
  if [ $WAKE_AGE -gt 3600 ]; then
    bash ~/clawd/scripts/generate-wake.sh 2>/dev/null
    FIXED+=("WAKE.md was stale (${WAKE_AGE}s old), regenerated")
  fi
else
  bash ~/clawd/scripts/generate-wake.sh 2>/dev/null
  FIXED+=("WAKE.md was missing, generated")
fi

# 3. Check git status
cd ~/clawd
DIRTY=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
if [ "$DIRTY" -gt 20 ]; then
  ISSUES+=("WARN: $DIRTY uncommitted files in workspace")
elif [ "$DIRTY" -gt 5 ]; then
  git add -A 2>/dev/null
  git commit -m "AUTO: Workspace health auto-commit $(date +%Y-%m-%d_%H%M)" 2>/dev/null
  git push 2>/dev/null
  FIXED+=("Auto-committed $DIRTY dirty files")
fi

# 4. Check Talos process
TALOS_COUNT=$(ps aux | grep talos-unified | grep -v grep | wc -l | tr -d ' ')
if [ "$TALOS_COUNT" -eq 0 ]; then
  ISSUES+=("CRITICAL: Talos is NOT running!")
elif [ "$TALOS_COUNT" -gt 1 ]; then
  ISSUES+=("WARN: $TALOS_COUNT Talos processes running (should be 1)")
fi

# 5. Check disk space
AVAIL_GB=$(df -g ~/clawd 2>/dev/null | tail -1 | awk '{print $4}' || echo "999")
if [ "$AVAIL_GB" -lt 5 ]; then
  ISSUES+=("WARN: Only ${AVAIL_GB}GB disk space remaining")
fi

# 6. Check memory directory size
MEMORY_SIZE=$(du -sm ~/clawd/memory/ 2>/dev/null | awk '{print $1}')
if [ "$MEMORY_SIZE" -gt 50 ]; then
  ISSUES+=("WARN: memory/ is ${MEMORY_SIZE}MB — consider archiving old logs")
fi

# 7. Check vault permissions
if [ -f ~/clawd/vault/CREDENTIALS.md ]; then
  PERMS=$(stat -f %Lp ~/clawd/vault/CREDENTIALS.md 2>/dev/null || stat -c %a ~/clawd/vault/CREDENTIALS.md 2>/dev/null)
  if [ "$PERMS" != "600" ]; then
    chmod 600 ~/clawd/vault/CREDENTIALS.md
    FIXED+=("vault/CREDENTIALS.md permissions fixed to 600")
  fi
fi

# 8. Check INDEX.md freshness
if [ -f ~/clawd/memory/INDEX.md ]; then
  INDEX_AGE=$(( $(date +%s) - $(stat -f %m ~/clawd/memory/INDEX.md 2>/dev/null || stat -c %Y ~/clawd/memory/INDEX.md 2>/dev/null || echo 0) ))
  if [ $INDEX_AGE -gt 604800 ]; then
    node ~/clawd/scripts/build-index.js 2>/dev/null
    FIXED+=("INDEX.md was stale (>7 days), rebuilt")
  fi
fi

# 9. File size monitor
for pair in "SOUL.md:13000" "AGENTS.md:10000" "TOOLS.md:2500" "MEMORY.md:7000" "HEARTBEAT.md:2000"; do
  FILE=$(echo $pair | cut -d: -f1)
  MAX=$(echo $pair | cut -d: -f2)
  if [ -f ~/clawd/$FILE ]; then
    SIZE=$(wc -c < ~/clawd/$FILE)
    if [ $SIZE -gt $MAX ]; then
      PERCENT=$(( SIZE * 100 / MAX ))
      ISSUES+=("SIZE: $FILE is ${SIZE}B (${PERCENT}% of ${MAX}B limit)")
    fi
  fi
done

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

# Thalamus health check
THALAMUS_PID=$(pgrep -f thalamus.js)
if [ -z "$THALAMUS_PID" ]; then
    echo "  - CRITICAL: Thalamus NOT RUNNING — restarting"
    launchctl kickstart gui/$(id -u)/com.raven.thalamus 2>/dev/null
    ISSUES+=("CRITICAL: Thalamus was dead, restarted")
else
    # Check if it's actually processing (last processed within 10 minutes)
    LAST_LOG=$(tail -1 ~/clawd/data/thalamus-stdout.log 2>/dev/null)
    echo "  - Thalamus: running (PID $THALAMUS_PID)"
fi
