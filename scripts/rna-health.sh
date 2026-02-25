#!/bin/bash
# rna-health.sh — Health check for Raven's brain (Thalamus v3)
# Checks what ACTUALLY exists: Thalamus daemon + its outputs
# Usage: bash rna-health.sh [--json]
# Exit code: 0 = all pass, 1 = failures exist

set -uo pipefail  # No -e: we want to check everything even if one fails
CLAWD="${CLAWD:-$HOME/clawd}"
NOW=$(date +%s)
FAILURES=0
JSON_MODE="${1:-}"
RESULTS=()

# Colors
if [ "$JSON_MODE" = "--json" ]; then
  RED='' GREEN='' YELLOW='' CYAN='' NC=''
else
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[0;33m'
  CYAN='\033[0;36m'
  NC='\033[0m'
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
  local layer="$1"
  local name="$2"
  local status="$3"
  local evidence="$4"
  
  if [ "$JSON_MODE" != "--json" ]; then
    if [ "$status" = "PASS" ]; then
      printf "${GREEN}✅ %-6s %-24s PASS${NC}  %s\n" "$layer" "$name" "$evidence"
    elif [ "$status" = "WARN" ]; then
      printf "${YELLOW}⚠️  %-6s %-24s WARN${NC}  %s\n" "$layer" "$name" "$evidence"
    else
      printf "${RED}❌ %-6s %-24s FAIL${NC}  %s\n" "$layer" "$name" "$evidence"
    fi
  fi
  
  if [ "$status" = "FAIL" ]; then
    FAILURES=$((FAILURES + 1))
  fi
  RESULTS+=("{\"layer\":\"$layer\",\"name\":\"$name\",\"status\":\"$status\",\"evidence\":\"$(echo "$evidence" | sed 's/"/\\"/g')\"}")
}

if [ "$JSON_MODE" != "--json" ]; then
  echo ""
  printf "${CYAN}═══════════════════════════════════════════════════════════════${NC}\n"
  printf "${CYAN}  RAVEN BRAIN HEALTH — Thalamus v3 — $(date '+%Y-%m-%d %H:%M %Z')${NC}\n"
  printf "${CYAN}═══════════════════════════════════════════════════════════════${NC}\n"
  echo ""
fi

# ─── 1. THALAMUS PROCESS ───
THALAMUS_PID=$(pgrep -f "node.*thalamus" 2>/dev/null || echo "")
HEARTBEAT="$CLAWD/data/thalamus-heartbeat.json"
if [ -n "$THALAMUS_PID" ]; then
  HB_STATUS=$(check_file_age "$HEARTBEAT" 1) || HB_STATUS="stale"
  report "CORE" "Thalamus Process" "PASS" "pid=$THALAMUS_PID | heartbeat: $HB_STATUS"
else
  report "CORE" "Thalamus Process" "FAIL" "Not running. Restart: launchctl kickstart -k gui/\$(id -u)/com.raven.thalamus"
fi

# ─── 2. KNOWLEDGE EXTRACTION ───
KNOWLEDGE="$CLAWD/data/thalamus-knowledge.json"
if [ -f "$KNOWLEDGE" ]; then
  K_INFO=$(python3 -c "
import json
k = json.load(open('$KNOWLEDGE'))
p = len(k.get('principles', []))
m = len(k.get('mindModel', []))
c = len(k.get('connections', []))
e = k.get('meta', {}).get('exchangesProcessed', 0)
print(f'{p} principles, {m} mind-model, {c} connections, {e} exchanges')
" 2>/dev/null || echo "error reading")
  K_AGE=$(check_file_age "$KNOWLEDGE" 2) || K_AGE="stale"
  if echo "$K_AGE" | grep -q "OK"; then
    report "KNOW" "Knowledge Extraction" "PASS" "$K_INFO | $K_AGE"
  else
    report "KNOW" "Knowledge Extraction" "WARN" "$K_INFO | $K_AGE"
  fi
else
  report "KNOW" "Knowledge Extraction" "FAIL" "thalamus-knowledge.json MISSING"
fi

# ─── 3. PREDICTIONS ───
FRAMES="$CLAWD/memory/prediction-frames.jsonl"
CALIB="$CLAWD/memory/calibration-state.json"
if [ -f "$FRAMES" ]; then
  FRAME_COUNT=$(wc -l < "$FRAMES" | tr -d ' ')
  LAST_TS=$(tail -1 "$FRAMES" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('timestamp',''))" 2>/dev/null || echo "")
  if [ -n "$LAST_TS" ]; then
    LAST_EPOCH=$(python3 -c "from datetime import datetime; print(int(datetime.fromisoformat('$LAST_TS'.replace('Z','+00:00')).timestamp()))" 2>/dev/null || echo "$NOW")
    FRAME_AGE=$(( (NOW - LAST_EPOCH) / 60 ))
  else
    FRAME_AGE=9999
  fi
  
  # Get calibration info
  ACCURACY="?"
  SCORED=0
  if [ -f "$CALIB" ]; then
    ACCURACY=$(python3 -c "import json; c=json.load(open('$CALIB')); print(f\"{round((1-c['brier_score'])*100)}%\")" 2>/dev/null || echo "?")
    SCORED=$(python3 -c "import json; print(json.load(open('$CALIB')).get('n_scored',0))" 2>/dev/null || echo "0")
  fi
  
  if [ "$FRAME_AGE" -lt 60 ]; then
    report "PRED" "Predictions" "PASS" "$FRAME_COUNT frames, $SCORED scored, ${ACCURACY} accuracy, last ${FRAME_AGE}m ago"
  else
    report "PRED" "Predictions" "WARN" "$FRAME_COUNT frames but last ${FRAME_AGE}m ago (>60m)"
  fi
else
  report "PRED" "Predictions" "FAIL" "No prediction-frames.jsonl"
fi

# ─── 4. CONTEXT ORGAN ───
BOOTSTRAP="$CLAWD/BOOTSTRAP.md"
if [ -f "$BOOTSTRAP" ]; then
  HAS_CONTEXT=$(grep -c "CONTEXT ORGAN" "$BOOTSTRAP" 2>/dev/null || echo "0")
  HAS_COGNITIVE=$(grep -c "COGNITIVE FRAME" "$BOOTSTRAP" 2>/dev/null || echo "0")
  HAS_THALAMUS=$(grep -c "THALAMUS" "$BOOTSTRAP" 2>/dev/null || echo "0")
  BS_SIZE=$(wc -c < "$BOOTSTRAP" | tr -d ' ')
  
  SECTIONS="context=$HAS_CONTEXT cognitive=$HAS_COGNITIVE knowledge=$HAS_THALAMUS size=${BS_SIZE}B"
  
  if [ "$HAS_CONTEXT" -gt 0 ] && [ "$HAS_COGNITIVE" -gt 0 ] && [ "$HAS_THALAMUS" -gt 0 ]; then
    report "CTX" "Context Organ" "PASS" "$SECTIONS"
  elif [ "$HAS_CONTEXT" -gt 0 ] || [ "$HAS_THALAMUS" -gt 0 ]; then
    report "CTX" "Context Organ" "WARN" "Partial: $SECTIONS"
  else
    report "CTX" "Context Organ" "FAIL" "BOOTSTRAP missing core sections: $SECTIONS"
  fi
else
  report "CTX" "Context Organ" "FAIL" "BOOTSTRAP.md MISSING"
fi

# ─── 5. DEEP RECOVERY ───
DEEP="$CLAWD/data/deep-recovery.md"
if [ -f "$DEEP" ]; then
  DR_AGE=$(check_file_age "$DEEP" 4) || DR_AGE="stale"
  report "RECV" "Deep Recovery" "PASS" "$DR_AGE"
else
  report "RECV" "Deep Recovery" "FAIL" "deep-recovery.md MISSING"
fi

# ─── 6. METACOGNITION (precision weights) ───
WEIGHTS="$CLAWD/memory/precision-weights.json"
if [ -f "$WEIGHTS" ]; then
  W_AGE=$(check_file_age "$WEIGHTS" 168) || W_AGE="stale"
  WEAKEST=$(python3 -c "
import json
w = json.load(open('$WEIGHTS'))
nums = {k:v for k,v in w.items() if isinstance(v, (int,float))}
if nums: print(max(nums, key=nums.get))
else: print('?')
" 2>/dev/null || echo "?")
  report "META" "Metacognition" "PASS" "Weights: $W_AGE | Weakest: $WEAKEST"
else
  report "META" "Metacognition" "WARN" "No precision-weights.json (optional)"
fi

# ─── 7. JUDGE SYSTEM ───
JUDGE_DIR="$CLAWD/agents/judge"
JUDGE_LATEST=$(ls -t "$JUDGE_DIR"/verdicts/*.json 2>/dev/null | head -1 || echo "")
if [ -n "$JUDGE_LATEST" ] && [ -f "$JUDGE_LATEST" ]; then
  GRADE=$(python3 -c "import json; print(json.load(open('$JUDGE_LATEST')).get('grade','?'))" 2>/dev/null || echo "?")
  J_AGE=$(check_file_age "$JUDGE_LATEST" 48) || J_AGE="stale"
  report "JUDGE" "External Judge" "PASS" "Grade: $GRADE | $J_AGE"
else
  # Check BOOTSTRAP for injected verdict
  BOOTSTRAP_GRADE=$(grep "Grade:.*\*\*[A-F]" "$CLAWD/BOOTSTRAP.md" 2>/dev/null | head -1 | grep -o '\*\*[A-F][+-]*\*\*' | tr -d '*' || echo "")
  if [ -n "$BOOTSTRAP_GRADE" ]; then
    report "JUDGE" "External Judge" "WARN" "Grade $BOOTSTRAP_GRADE in BOOTSTRAP but no verdict file"
  else
    report "JUDGE" "External Judge" "WARN" "No recent verdict (judge may not be scheduled)"
  fi
fi

# ─── 8. CONSCIOUSNESS (autonomous thinking) ───
THALAMUS_LOG="$CLAWD/data/thalamus.log"
if [ -f "$THALAMUS_LOG" ]; then
  LAST_CONSCIOUS=$(grep "Conscious tick complete" "$THALAMUS_LOG" 2>/dev/null | tail -1 || echo "")
  LAST_SYNTH=$(grep "synthesis complete\|synthesis done\|Synthesis:" "$THALAMUS_LOG" 2>/dev/null | tail -1 || echo "")
  
  if [ -n "$LAST_CONSCIOUS" ]; then
    report "MIND" "Consciousness" "PASS" "Active: $(echo "$LAST_CONSCIOUS" | tail -c 100)"
  else
    report "MIND" "Consciousness" "WARN" "No conscious tick found in log"
  fi
else
  report "MIND" "Consciousness" "FAIL" "No thalamus.log"
fi

# ─── 9. SELF-MUTATION ───
if [ -f "$THALAMUS_LOG" ]; then
  LAST_MUTATE=$(grep "mutation\|self-mutate\|Self-mutation" "$THALAMUS_LOG" 2>/dev/null | tail -1 || echo "")
  MUTATION_COUNT=$(grep -c "mutation" "$THALAMUS_LOG" 2>/dev/null || echo "0")
  if [ -n "$LAST_MUTATE" ]; then
    report "EVOL" "Self-Mutation" "PASS" "$MUTATION_COUNT entries | last: $(echo "$LAST_MUTATE" | tail -c 80)"
  else
    report "EVOL" "Self-Mutation" "WARN" "No mutations yet (fires every 6h)"
  fi
fi

# ─── SUMMARY ───
TOTAL=${#RESULTS[@]}
PASSED=$((TOTAL - FAILURES))

if [ "$JSON_MODE" != "--json" ]; then
  echo ""
  printf "${CYAN}═══════════════════════════════════════════════════════════════${NC}\n"
  if [ "$FAILURES" -eq 0 ]; then
    printf "${GREEN}  ALL $TOTAL CHECKS PASSED${NC}\n"
  else
    printf "${RED}  $FAILURES FAILED${NC} / $TOTAL total\n"
  fi
  printf "${CYAN}═══════════════════════════════════════════════════════════════${NC}\n"
fi

if [ "$JSON_MODE" = "--json" ]; then
  echo "{\"total\":$TOTAL,\"passed\":$PASSED,\"failed\":$FAILURES,\"results\":[$(IFS=,; echo "${RESULTS[*]}")]}"
fi

exit $FAILURES
