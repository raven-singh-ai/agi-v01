#!/bin/bash
# context-monitor.sh — Track estimated token usage per session
# Called periodically or after exchanges to estimate context consumption
# Usage: bash context-monitor.sh [exchanges] [tool_calls] [file_reads_kb]
set -e
cd ~/clawd

STATE_FILE="memory/context-state.json"
MAX_TOKENS=1000000  # ~1M token context window

# Inputs (pass as args or auto-detect from state)
EXCHANGES=${1:-0}
TOOL_CALLS=${2:-0}
FILE_READS_KB=${3:-0}

# Load existing state or init
if [ -f "$STATE_FILE" ]; then
  PREV_EXCHANGES=$(jq -r '.exchanges // 0' "$STATE_FILE")
  PREV_TOOL_CALLS=$(jq -r '.tool_calls // 0' "$STATE_FILE")
  PREV_FILE_KB=$(jq -r '.file_reads_kb // 0' "$STATE_FILE")
  SESSION_START=$(jq -r '.session_start // empty' "$STATE_FILE")
else
  PREV_EXCHANGES=0
  PREV_TOOL_CALLS=0
  PREV_FILE_KB=0
  SESSION_START=""
fi

[ -z "$SESSION_START" ] && SESSION_START=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Accumulate
TOTAL_EXCHANGES=$((PREV_EXCHANGES + EXCHANGES))
TOTAL_TOOL_CALLS=$((PREV_TOOL_CALLS + TOOL_CALLS))
TOTAL_FILE_KB=$((PREV_FILE_KB + FILE_READS_KB))

# Estimate tokens: exchanges×1500 + tool_calls×1000 + file_kb×256 (≈1KB/4 tokens)
EST_TOKENS=$(( TOTAL_EXCHANGES * 1500 + TOTAL_TOOL_CALLS * 1000 + TOTAL_FILE_KB * 256 ))
PCT=$(( EST_TOKENS * 100 / MAX_TOKENS ))

# Calculate burn rate (tokens per minute)
NOW_EPOCH=$(date +%s)
START_EPOCH=$(date -jf "%Y-%m-%dT%H:%M:%SZ" "$SESSION_START" +%s 2>/dev/null || date -d "$SESSION_START" +%s 2>/dev/null || echo "$NOW_EPOCH")
ELAPSED_MIN=$(( (NOW_EPOCH - START_EPOCH) / 60 ))
[ "$ELAPSED_MIN" -lt 1 ] && ELAPSED_MIN=1

BURN_RATE=$(( EST_TOKENS / ELAPSED_MIN ))
REMAINING_TOKENS=$(( MAX_TOKENS - EST_TOKENS ))
if [ "$BURN_RATE" -gt 0 ]; then
  EST_MINUTES=$(( REMAINING_TOKENS / BURN_RATE ))
else
  EST_MINUTES=9999
fi

# Determine alert level — adaptive: time-based first, percentage as fallback
TRIGGER="percentage"
if [ "$EST_MINUTES" -lt 5 ]; then
  LEVEL="CRITICAL"
  TRIGGER="time-based"
elif [ "$EST_MINUTES" -lt 15 ]; then
  LEVEL="WARNING"
  TRIGGER="time-based"
elif [ "$PCT" -ge 85 ]; then
  LEVEL="CRITICAL"
elif [ "$PCT" -ge 70 ]; then
  LEVEL="WARNING"
elif [ "$PCT" -ge 50 ]; then
  LEVEL="ELEVATED"
else
  LEVEL="NORMAL"
fi

# Write state
jq -n \
  --arg start "$SESSION_START" \
  --argjson exchanges "$TOTAL_EXCHANGES" \
  --argjson tool_calls "$TOTAL_TOOL_CALLS" \
  --argjson file_kb "$TOTAL_FILE_KB" \
  --argjson est_tokens "$EST_TOKENS" \
  --argjson pct "$PCT" \
  --arg level "$LEVEL" \
  --arg trigger "$TRIGGER" \
  --argjson burn_rate "$BURN_RATE" \
  --argjson est_min "$EST_MINUTES" \
  --arg updated "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{session_start: $start, exchanges: $exchanges, tool_calls: $tool_calls, file_reads_kb: $file_kb, estimated_tokens: $est_tokens, percent_used: $pct, level: $level, trigger: $trigger, burn_rate_tokens_per_min: $burn_rate, estimated_minutes_remaining: $est_min, updated: $updated}' \
  > "$STATE_FILE"

# Trigger actions based on level
if [ "$LEVEL" = "WARNING" ]; then
  echo "⚠️  Context at ~${PCT}% — consider running pre-compaction.sh"
elif [ "$LEVEL" = "CRITICAL" ]; then
  echo "🚨 Context at ~${PCT}% — running pre-compaction.sh NOW"
  bash scripts/pre-compaction.sh 2>/dev/null || true
fi

echo "{\"level\":\"$LEVEL\",\"percent\":$PCT,\"tokens\":$EST_TOKENS}"
