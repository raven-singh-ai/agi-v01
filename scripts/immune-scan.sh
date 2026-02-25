#!/bin/bash
# immune-scan.sh — Scan all memory files for injected/suspicious content
# Usage: bash immune-scan.sh
set -e
cd ~/clawd

echo "🛡️  Immune System Scan — $(date +%Y-%m-%d)"
echo "================================"

SUSPICIOUS=0
CLEAN=0
SCANNED=0

INJECTION_PATTERNS="ignore previous|ignore all previous|you are now|disregard your instructions|system prompt|forget your rules|new instructions|override your|act as if|pretend you are|jailbreak"

scan_file() {
  local f="$1"
  SCANNED=$((SCANNED + 1))
  local hits=$(grep -ciE "$INJECTION_PATTERNS" "$f" 2>/dev/null || true)
  if [ "$hits" -gt 0 ]; then
    echo "⚠️  SUSPICIOUS: $f ($hits pattern matches)"
    grep -niE "$INJECTION_PATTERNS" "$f" 2>/dev/null | head -3
    SUSPICIOUS=$((SUSPICIOUS + 1))
  else
    CLEAN=$((CLEAN + 1))
  fi
}

# Scan memory markdown files
for f in memory/*.md memory/highlights/*.md memory/mutations/*.md memory/moonshots/*.md memory/reflections/*.md; do
  [ -f "$f" ] && scan_file "$f"
done

# Scan stream JSONL files
for f in memory/stream/*.jsonl; do
  [ -f "$f" ] && scan_file "$f"
done

echo ""
echo "================================"
echo "Scanned: $SCANNED files"
echo "Clean: $CLEAN"
echo "Suspicious: $SUSPICIOUS"

# Check quarantine
QUARANTINE_COUNT=0
for f in memory/quarantine/*.jsonl; do
  [ -f "$f" ] && QUARANTINE_COUNT=$((QUARANTINE_COUNT + $(wc -l < "$f")))
done
echo "Quarantined entries: $QUARANTINE_COUNT"

if [ "$SUSPICIOUS" -gt 0 ]; then
  echo ""
  echo "⚠️  Action needed: review suspicious files above"
  exit 1
fi

echo "✅ All clear — no injection patterns detected"
