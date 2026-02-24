# HEARTBEAT.md — Periodic Checks

## Smart Triage
Every heartbeat check follows this logic:
- 🔴 **BROKEN** → Fix immediately. DM result. Never report a problem you can solve.
- 🟡 **DEGRADED** → Monitor. Fix if worsens. Log to memory.
- 🟢 **HEALTHY** → One-line confirmation. Move on.

## Priority 0: Workspace Health (every heartbeat)
- Run: bash {{WORKSPACE}}/scripts/workspace-health.sh
- If WORKSPACE_HEALTHY → continue
- If SELF_HEALED → log to daily memory
- If ISSUES with CRITICAL → alert immediately

## Priority 1: Brain Health (every heartbeat)
- Run: bash {{WORKSPACE}}/scripts/brain-health.sh
- If all PASS → continue
- If any FAIL → diagnose and fix immediately

## Priority 2: Git Push Status (2x daily)
- `cd {{WORKSPACE}} && git status --porcelain | wc -l` — if > 0, commit and push
