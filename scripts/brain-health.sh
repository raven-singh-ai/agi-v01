#!/bin/bash
# brain-health.sh — Full health check for AGI v0.1 cognitive systems
# Usage: bash brain-health.sh [--json]
set -uo pipefail

WORKSPACE="${AGI_WORKSPACE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
NOW=$(date +%s)
FAILURES=0
JSON_MODE="${1:-}"

if [ "$JSON_MODE" = "--json" ]; then
  RED='' GREEN='' YELLOW='' NC=''
else
  RED='\033[0;31m' GREEN='\033[0;32m' YELLOW='\033[0;33m' NC='\033[0m'
fi

check_file_age() {
  local file="$1"
  local max_hours="${2:-24}"
  if [ ! -f "$file" ]; then echo "MISSING"; return 1; fi
  local size=$(wc -c < "$file" | tr -d ' ')
  if [ "$size" -le 2 ]; then echo "EMPTY"; return 1; fi
  local mtime
  mtime=$(stat -f %m "$file" 2>/dev/null || stat -c %Y "$file" 2>/dev/null || echo 0)
  local age_hours=$(( (NOW - mtime) / 3600 ))
  if [ "$age_hours" -gt "$max_hours" ]; then
    echo "STALE (${age_hours}h old, max ${max_hours}h)"
    return 1
  fi
  echo "OK (${age_hours}h ago, ${size}B)"
  return 0
}

report() {
  local name="$1"
  local status="$2"
  local evidence="$3"
  if [ "$JSON_MODE" != "--json" ]; then
    if [ "$status" = "PASS" ]; then
      printf "${GREEN}✅ %-30s PASS${NC}  %s\n" "$name" "$evidence"
    elif [ "$status" = "WARN" ]; then
      printf "${YELLOW}⚠️  %-30s WARN${NC}  %s\n" "$name" "$evidence"
    else
      printf "${RED}❌ %-30s FAIL${NC}  %s\n" "$name" "$evidence"
      FAILURES=$((FAILURES + 1))
    fi
  fi
}

echo "🧬 AGI v0.1 BRAIN HEALTH CHECK"
echo "================================"
echo ""

# 1. Thalamus process
PID=$(pgrep -f thalamus.js 2>/dev/null || echo "")
if [ -n "$PID" ]; then
  report "Thalamus daemon" "PASS" "Running (PID $PID)"
else
  report "Thalamus daemon" "FAIL" "NOT RUNNING"
fi

# 2. Thalamus heartbeat
RESULT=$(check_file_age "$WORKSPACE/data/thalamus-heartbeat.json" 1)
STATUS=$?
report "Thalamus heartbeat" "$([ $STATUS -eq 0 ] && echo PASS || echo FAIL)" "$RESULT"

# 3. Knowledge file
RESULT=$(check_file_age "$WORKSPACE/data/thalamus-knowledge.json" 24)
STATUS=$?
if [ $STATUS -eq 0 ]; then
  PRINCIPLES=$(python3 -c "import json; print(len(json.load(open('$WORKSPACE/data/thalamus-knowledge.json'))['principles']))" 2>/dev/null || echo "?")
  report "Knowledge file" "PASS" "$RESULT — $PRINCIPLES principles"
else
  report "Knowledge file" "FAIL" "$RESULT"
fi

# 4. BOOTSTRAP.md
if [ -f "$WORKSPACE/BOOTSTRAP.md" ]; then
  SIZE=$(wc -c < "$WORKSPACE/BOOTSTRAP.md")
  HAS_THALAMUS=$(grep -c "THALAMUS" "$WORKSPACE/BOOTSTRAP.md" 2>/dev/null || echo 0)
  HAS_CONTEXT=$(grep -c "CONTEXT ORGAN" "$WORKSPACE/BOOTSTRAP.md" 2>/dev/null || echo 0)
  if [ "$HAS_THALAMUS" -gt 0 ] && [ "$HAS_CONTEXT" -gt 0 ]; then
    report "BOOTSTRAP.md" "PASS" "${SIZE}B, has Thalamus + Context Organ"
  else
    report "BOOTSTRAP.md" "WARN" "${SIZE}B, missing sections (Thalamus=$HAS_THALAMUS, Context=$HAS_CONTEXT)"
  fi
else
  report "BOOTSTRAP.md" "FAIL" "MISSING"
fi

# 5. Deep recovery
RESULT=$(check_file_age "$WORKSPACE/data/deep-recovery.md" 24)
STATUS=$?
report "Deep recovery" "$([ $STATUS -eq 0 ] && echo PASS || echo WARN)" "$RESULT"

# 6. Prediction frames
if [ -f "$WORKSPACE/memory/prediction-frames.jsonl" ]; then
  LINES=$(wc -l < "$WORKSPACE/memory/prediction-frames.jsonl" | tr -d ' ')
  report "Prediction frames" "PASS" "$LINES frames"
else
  report "Prediction frames" "WARN" "No frames yet"
fi

# 7. Calibration state
if [ -f "$WORKSPACE/memory/calibration-state.json" ]; then
  BRIER=$(python3 -c "import json; print(json.load(open('$WORKSPACE/memory/calibration-state.json'))['brier_score'])" 2>/dev/null || echo "?")
  N=$(python3 -c "import json; print(json.load(open('$WORKSPACE/memory/calibration-state.json'))['n_scored'])" 2>/dev/null || echo "?")
  report "Calibration" "PASS" "Brier=$BRIER, N=$N scored"
else
  report "Calibration" "WARN" "No calibration data yet"
fi

# 8. Judge verdicts
if [ -f "$WORKSPACE/agents/judge/verdicts/latest.json" ]; then
  GRADE=$(python3 -c "import json; print(json.load(open('$WORKSPACE/agents/judge/verdicts/latest.json')).get('overall_grade','?'))" 2>/dev/null || echo "?")
  report "Judge verdict" "PASS" "Grade: $GRADE"
else
  report "Judge verdict" "WARN" "No verdicts yet (judge may not have run)"
fi

# 9. Corrections log
if [ -f "$WORKSPACE/memory/corrections.jsonl" ]; then
  LINES=$(wc -l < "$WORKSPACE/memory/corrections.jsonl" | tr -d ' ')
  report "Corrections log" "PASS" "$LINES corrections detected"
else
  report "Corrections log" "WARN" "No corrections file (ok if new)"
fi

# 10. Thalamus log
RESULT=$(check_file_age "$WORKSPACE/data/thalamus.log" 1)
STATUS=$?
report "Thalamus log" "$([ $STATUS -eq 0 ] && echo PASS || echo WARN)" "$RESULT"

echo ""
echo "================================"
if [ $FAILURES -eq 0 ]; then
  echo "✅ All checks passed"
else
  echo "❌ $FAILURES check(s) failed"
fi

exit $FAILURES
