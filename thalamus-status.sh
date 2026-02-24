#!/bin/bash
# thalamus-status.sh — Quick status check for AGI v0.1
# Usage: bash thalamus-status.sh

WORKSPACE="${AGI_WORKSPACE:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"

echo "🧬 THALAMUS STATUS"
echo "=================="
echo ""

# Is it running?
PID=$(pgrep -f thalamus.js 2>/dev/null)
if [ -n "$PID" ]; then
    echo "Process: ✅ Running (PID $PID)"
else
    echo "Process: ❌ NOT RUNNING"
fi

echo ""

# Knowledge stats
python3 -c "
import json, os
try:
    d=json.load(open(os.path.join('$WORKSPACE', 'data', 'thalamus-knowledge.json')))
    p = d['principles']
    m = d['mindModel']
    c = d.get('connections',[])
    e = d.get('emergent',[])
    mut = d.get('mutations',[])
    ex = d['meta']['totalExchanges']
    last = d['meta'].get('lastProcessed','never')

    print(f'Exchanges processed: {ex}')
    print(f'Principles: {len(p)} (never pruned)')
    print(f'Mind model entries: {len(m)}')
    print(f'Connections: {len(c)}')
    print(f'Meta-insights: {len([x for x in p if x[\"text\"].startswith(\"[META]\")])}')
    print(f'Patterns: {len([x for x in p if x[\"text\"].startswith(\"[PATTERN]\")])}')
    print(f'World observations: {len([x for x in p if x[\"text\"].startswith(\"[WORLD]\")])}')
    print(f'Self-mutations: {len(mut)}')
    print(f'Emergent capabilities: {len(e)}')
    print(f'Last processed: {last}')
    print()

    # Domain breakdown
    domains = {}
    for x in p:
        dom = x.get('domain','general')
        domains[dom] = domains.get(dom,0)+1
    print('Domains:', ' | '.join(f'{k}:{v}' for k,v in sorted(domains.items(), key=lambda x:-x[1])))
    print()

    # Growth rate
    if ex > 0:
        print(f'Growth rate: {len(p)/ex:.1f} principles per exchange')
    print()

    # Last 5 principles learned
    print('LAST 5 PRINCIPLES:')
    for x in p[-5:]:
        print(f'  → {x[\"text\"][:100]}')
    print()

    # Last 3 mind model
    print('LATEST MIND MODEL:')
    for x in m[-3:]:
        print(f'  🧠 {x[\"trait\"][:100]}')
except FileNotFoundError:
    print('No knowledge file yet. Thalamus needs to process at least one exchange.')
except Exception as e:
    print(f'Error reading knowledge: {e}')
" 2>/dev/null

echo ""
echo "CORRECTION DETECTIONS:"
grep "🔥 CORRECTION" "$WORKSPACE/data/thalamus-stdout.log" 2>/dev/null | tail -5 || echo "  none yet"

echo ""
echo "LAST 5 LOG ENTRIES:"
tail -5 "$WORKSPACE/data/thalamus.log" 2>/dev/null || tail -5 "$WORKSPACE/data/thalamus-stdout.log" 2>/dev/null || echo "  no logs yet"

# Calibration
echo ""
echo "PREDICTION CALIBRATION:"
python3 -c "
import json, os
try:
    c = json.load(open(os.path.join('$WORKSPACE', 'memory', 'calibration-state.json')))
    scores = c.get('scores', [])
    avg = sum(scores) / len(scores) if scores else 0
    print(f'  Scored predictions: {c.get(\"n_scored\", 0)}')
    print(f'  Brier score: {c.get(\"brier_score\", \"n/a\")} (lower = better)')
    print(f'  Average accuracy: {avg:.1%}')
except:
    print('  No calibration data yet.')
" 2>/dev/null
