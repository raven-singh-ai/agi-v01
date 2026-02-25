#!/bin/bash
# pre-compaction.sh — Save state before context compaction
# Generates a clean WAKE.md for session recovery.
set -e
cd ~/clawd

TODAY=$(date +%Y-%m-%d)
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
NOW_LOCAL=$(date +%H:%M)
ARCHIVE_DIR="memory/context-archive"
WAKE="WAKE.md"
ACTIVE="ACTIVE_CONTEXT.md"

mkdir -p "$ARCHIVE_DIR" memory/stream

echo "📦 Pre-compaction save at $NOW"

# --- Artifact Extraction (safety net — catch anything 0-second rule missed) ---
mkdir -p memory/artifacts memory/highlights

# Scan ACTIVE_CONTEXT.md for shared files, facts, decisions
if [ -f "$ACTIVE" ]; then
  # Extract file paths mentioned
  FILE_REFS=$(grep -oE '(~/|/Users/)[a-zA-Z0-9_./-]+\.[a-zA-Z]{1,5}' "$ACTIVE" 2>/dev/null | sort -u)
  if [ -n "$FILE_REFS" ]; then
    echo "$FILE_REFS" > "memory/artifacts/${TODAY}-files-referenced.md"
    echo "  📎 Saved file references to artifacts"
  fi

  # Extract facts/preferences (patterns: "I am", "I like", "my ... is")
  FACTS=$(grep -iE '(^|\s)(I am |I'\''m |my .* is |I like |I prefer |I have |I was |I used to )' "$ACTIVE" 2>/dev/null | head -20)
  if [ -n "$FACTS" ]; then
    {
      echo "# Facts/Preferences Extracted — $TODAY"
      echo "$FACTS"
    } > "memory/artifacts/${TODAY}-facts-extracted.md"
    echo "  🧠 Saved facts/preferences to artifacts"
  fi

  # Extract decisions
  DECISIONS_FOUND=$(grep -iE '(let'\''s do|we'\''ll go with|decided to|going with|approved|ship it|let'\''s use)' "$ACTIVE" 2>/dev/null | head -10)
  if [ -n "$DECISIONS_FOUND" ]; then
    {
      echo "# Decisions Extracted — $TODAY"
      echo "$DECISIONS_FOUND"
    } > "memory/artifacts/${TODAY}-decisions-extracted.md"
    echo "  ✅ Saved decisions to artifacts"
  fi
fi

# Also scan today's memory file
MEMORY_TODAY="memory/${TODAY}.md"
if [ -f "$MEMORY_TODAY" ]; then
  PDF_REFS=$(grep -iE '\.(pdf|doc|docx|xlsx|csv|png|jpg)' "$MEMORY_TODAY" 2>/dev/null | head -10)
  if [ -n "$PDF_REFS" ]; then
    echo "$PDF_REFS" >> "memory/artifacts/${TODAY}-files-referenced.md"
  fi
fi

# --- Compress old archives (keep last 3 uncompressed) ---
ARCHIVE_COUNT=$(ls -1 "$ARCHIVE_DIR"/*.md 2>/dev/null | wc -l | tr -d ' ')
if [ "$ARCHIVE_COUNT" -gt 10 ]; then
  ls -1t "$ARCHIVE_DIR"/*.md | tail -n +4 | while read f; do
    gzip "$f" 2>/dev/null || true
  done
fi

# --- Extract What's Happening (last 3 lines from Active Context "Current Focus" section) ---
WHATS_HAPPENING=""
if [ -f "$ACTIVE" ]; then
  WHATS_HAPPENING=$(sed -n '/## Current Focus/,/^## /{ /^## Current Focus/d; /^## /d; p; }' "$ACTIVE" | head -3 | sed '/^$/d')
fi
if [ -z "$WHATS_HAPPENING" ]; then
  WHATS_HAPPENING="Check ACTIVE_CONTEXT.md for current state."
fi

# --- Extract Sunny's Energy ---
ENERGY="unknown"
if [ -f "memory/emotional-state.md" ]; then
  ENERGY=$(tail -1 "memory/emotional-state.md" | sed 's/^[^:]*: *//')
fi
if [ -z "$ENERGY" ] || [ "$ENERGY" = "unknown" ]; then
  ENERGY="focused (default — check recent messages)"
fi

# --- Extract Today's Key Events (deduplicated) ---
KEY_EVENTS=""
if [ -f "$ACTIVE" ]; then
  KEY_EVENTS=$(sed -n '/## Key Events\|## Today\|## Recent/,/^## /{ /^## /d; p; }' "$ACTIVE" | grep '^- ' | sort -u)
fi
if [ -z "$KEY_EVENTS" ]; then
  # Fallback: stream file
  STREAM_FILE="memory/stream/${TODAY}.jsonl"
  if [ -f "$STREAM_FILE" ]; then
    KEY_EVENTS=$(jq -r 'select(.importance >= 3) | "- [\(.type)] \(.content)"' "$STREAM_FILE" 2>/dev/null | sort -u | head -10)
  fi
fi
if [ -z "$KEY_EVENTS" ]; then
  KEY_EVENTS="- No key events logged yet today"
fi

# --- Extract Priority Queue (Top 3) ---
PRIORITIES=""
if [ -f "memory/priority-queue.md" ]; then
  PRIORITIES=$(grep -E '^\s*(1\.|2\.|3\.|-|\*)' "memory/priority-queue.md" | head -3)
fi
if [ -z "$PRIORITIES" ]; then
  PRIORITIES="- Check memory/priority-queue.md"
fi

# --- Extract Blocked Items ---
BLOCKED=""
if [ -f "$ACTIVE" ]; then
  BLOCKED=$(sed -n '/## Blocked\|## What.*Blocked/,/^## /{ /^## /d; p; }' "$ACTIVE" | grep '^- ' | head -5)
fi
if [ -z "$BLOCKED" ]; then
  BLOCKED="- Nothing explicitly blocked"
fi

# --- Write WAKE.md ---
cat > "$WAKE" <<EOF
# WAKE.md — Session Recovery
Generated: $NOW

## What's Happening
$WHATS_HAPPENING

## Sunny's Energy
$ENERGY

## Today's Key Events
$KEY_EVENTS

## Priority Queue (Top 3)
$PRIORITIES

## What's Blocked
$BLOCKED

## Resume Instructions
1. Read ACTIVE_CONTEXT.md
2. Read memory/priority-queue.md
3. Read today's memory file (memory/${TODAY}.md)
4. Continue where we left off — user should notice ZERO gap
EOF

# --- v5: Capture live session state ---
bash ~/clawd/scripts/pre-compaction-state.sh 2>/dev/null || echo "  ⚠️ pre-compaction-state.sh failed (non-fatal)"

# --- Archive ---
ARCHIVE_FILE="$ARCHIVE_DIR/${TODAY}-$(date +%H%M).md"
cp "$WAKE" "$ARCHIVE_FILE"

# --- Git save ---
git add -A 2>/dev/null
git commit -m "AUTO: Pre-compaction save ${TODAY}_${NOW_LOCAL}" 2>/dev/null || true
git push 2>/dev/null || true

echo "✅ Pre-compaction save complete: $NOW"
echo "   WAKE.md updated, archived to $ARCHIVE_FILE"

# Generate enhanced WAKE.md with cognitive state
if [ -f scripts/generate-wake.sh ]; then
  bash scripts/generate-wake.sh 2>/dev/null || true
fi
