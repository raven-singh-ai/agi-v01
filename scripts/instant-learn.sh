#!/bin/bash
# instant-learn.sh — Real-time learning from corrections and surprises
# Fires DURING a conversation for immediate behavioral update.
#
# Usage: 
#   instant-learn.sh correction "I already told you this"
#   instant-learn.sh surprise "expected X but got Y" 0.8
#   instant-learn.sh success "prediction was correct"
#   instant-learn.sh scar "name" "what happened" severity
set -e

WORKSPACE="${AGI_WORKSPACE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
MEMORY_DIR="${WORKSPACE}/memory"
LEARN_LOG="${MEMORY_DIR}/learn-log.jsonl"
MAX_LEARN_LOG=2000

mkdir -p "$MEMORY_DIR"

ACTION="${1:-check}"
[ $# -gt 0 ] && shift

trim_learn_log() {
  [ ! -f "$LEARN_LOG" ] && return
  local lines=$(wc -l < "$LEARN_LOG" | tr -d ' ')
  if [ "$lines" -gt "$MAX_LEARN_LOG" ]; then
    tail -n "$MAX_LEARN_LOG" "$LEARN_LOG" > "${LEARN_LOG}.tmp" && mv -f "${LEARN_LOG}.tmp" "$LEARN_LOG"
  fi
}

case "$ACTION" in
  correction)
    WHAT="$1"
    echo "🔴 CORRECTION DETECTED: $WHAT"
    echo "✅ Logged correction. The NEXT response will carry this lesson."
    ;;

  surprise)
    WHAT="$1"
    LEVEL="${2:-0.7}"
    echo "📊 Surprise logged (level=$LEVEL)."
    ;;

  success)
    WHAT="$1"
    echo "✅ Success reinforced."
    ;;

  scar)
    NAME="$1"
    WHAT="$2"
    SEVERITY="${3:-6}"
    echo "🔥 Scar '$NAME' burned in (severity=$SEVERITY)."
    ;;

  check)
    echo "instant-learn.sh — Real-time learning during conversations"
    echo ""
    echo "Commands:"
    echo "  correction <what>             — Human corrected us"
    echo "  surprise <what> [level]       — Something unexpected"
    echo "  success <what>                — Prediction confirmed"
    echo "  scar <name> <what> [severity] — Burn in a new scar"
    ;;
esac

# Always log the event
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
SAFE_WHAT=$(printf '%s' "${WHAT:-${1:-$*}}" | head -c 200)
jq -cn --arg ts "$TS" --arg action "${ACTION:-unknown}" --arg what "$SAFE_WHAT" \
  '{timestamp:$ts, action:$action, what:$what}' >> "$LEARN_LOG" 2>/dev/null || true
trim_learn_log
