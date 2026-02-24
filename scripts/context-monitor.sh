#!/bin/bash
# context-monitor.sh — Track estimated token usage per session
# Called periodically to estimate context consumption
# Usage: bash context-monitor.sh [exchanges] [tool_calls] [file_reads_kb]
set -e

WORKSPACE="${AGI_WORKSPACE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
STATE_FILE="$WORKSPACE/memory/context-state.json"
MAX_TOKENS=1000000

EXCHANGES=${1:-0}
TOOL_CALLS=${2:-0}
FILE_READS_KB=${3:-0}

mkdir -p "$(dirname "$STATE_FILE")"

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

TOTAL_EXCHANGES=$((PREV_EXCHANGES + EXCHANGES))
TOTAL_TOOL_CALLS=$((PREV_TOOL_CALLS + TOOL_CALLS))
TOTAL_FILE_KB=$((PREV_FILE_KB + FILE_READS_KB))

EST_TOKENS=$(( TOTAL_EXCHANGES * 1500 + TOTAL_TOOL_CALLS * 1000 + TOTAL_FILE_KB * 256 ))
PCT=$(( EST_TOKENS * 100 / MAX_TOKENS ))

if [ "$PCT" -ge 85 ]; then
  LEVEL="CRITICAL"
elif [ "$PCT" -ge 70 ]; then
  LEVEL="WARNING"
elif [ "$PCT" -ge 50 ]; then
  LEVEL="ELEVATED"
else
  LEVEL="NORMAL"
fi

jq -n \
  --arg start "$SESSION_START" \
  --argjson exchanges "$TOTAL_EXCHANGES" \
  --argjson tool_calls "$TOTAL_TOOL_CALLS" \
  --argjson file_kb "$TOTAL_FILE_KB" \
  --argjson est_tokens "$EST_TOKENS" \
  --argjson pct "$PCT" \
  --arg level "$LEVEL" \
  --arg updated "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{session_start:$start, exchanges:$exchanges, tool_calls:$tool_calls, file_reads_kb:$file_kb, estimated_tokens:$est_tokens, percent_used:$pct, level:$level, updated:$updated}' \
  > "$STATE_FILE"

if [ "$LEVEL" = "CRITICAL" ]; then
  echo "🚨 Context at ~${PCT}%"
elif [ "$LEVEL" = "WARNING" ]; then
  echo "⚠️ Context at ~${PCT}%"
fi

echo "{\"level\":\"$LEVEL\",\"percent\":$PCT,\"tokens\":$EST_TOKENS}"
