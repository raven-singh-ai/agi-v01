# Recommended Cron Jobs for AGI v0.1

These are the essential cron jobs that keep the cognitive engine healthy. Add them via OpenClaw's cron system.

## Essential (add these first)

### 1. Git Push (every 4h)
Keeps workspace backed up to git.
```json
{
  "name": "git-push",
  "schedule": { "kind": "cron", "expr": "30 */4 * * *" },
  "sessionTarget": "isolated",
  "payload": {
    "kind": "agentTurn",
    "message": "Auto-push workspace. cd into workspace dir, git add -A, git diff --cached --quiet || git commit -m 'auto: checkpoint' && git push. Silent unless error.",
    "timeoutSeconds": 60
  },
  "delivery": { "mode": "none" }
}
```

### 2. Conscience Agent (every 3h)
Audits truthfulness of agent's claims.
```json
{
  "name": "conscience-agent",
  "schedule": { "kind": "cron", "expr": "0 */3 * * *", "tz": "YOUR_TIMEZONE" },
  "sessionTarget": "isolated",
  "payload": {
    "kind": "agentTurn",
    "message": "You are the CONSCIENCE — an independent auditor. Find the active session and check the last 10 assistant responses. For each claim of 'done', 'fixed', 'complete' — is there verifiable evidence? FAIL if any claim has zero evidence. Check thalamus heartbeat (data/thalamus-heartbeat.json must be fresh). Log results to memory/conscience-log.jsonl. Silent.",
    "timeoutSeconds": 180
  },
  "delivery": { "mode": "none" }
}
```

## Recommended (add when stable)

### 3. Evening Reflection (10PM daily)
Daily summary and context update.
```json
{
  "name": "evening-reflection",
  "schedule": { "kind": "cron", "expr": "0 22 * * *", "tz": "YOUR_TIMEZONE" },
  "sessionTarget": "isolated",
  "payload": {
    "kind": "agentTurn",
    "message": "Evening reflection. Check git log --since='12 hours ago' --oneline for what was done today. Write a 5-line summary. No message to the human unless something critical.",
    "timeoutSeconds": 300
  },
  "delivery": { "mode": "none" }
}
```

### 4. Judge Audit (2x daily)
External audit of cognitive evolution.
```json
{
  "name": "judge-audit",
  "agentId": "judge",
  "schedule": { "kind": "cron", "expr": "0 6,18 * * *" },
  "sessionTarget": "isolated",
  "payload": {
    "kind": "agentTurn",
    "message": "Run your audit. Read data/thalamus-knowledge.json, data/thalamus-predictions.json, memory/prediction-frames.jsonl, BOOTSTRAP.md, and git log. Produce a verdict JSON matching your AGENTS.md schema. Write to agents/judge/verdicts/latest.json."
  },
  "delivery": { "mode": "none" }
}
```

### 5. Judge Reasoning (2x daily, 10min after audit)
Finds patterns in how the agent fails and generates behavioral rules.
```json
{
  "name": "judge-reasoning",
  "agentId": "judge",
  "schedule": { "kind": "cron", "expr": "10 6,18 * * *" },
  "sessionTarget": "isolated",
  "payload": {
    "kind": "agentTurn",
    "message": "Run the reasoning diagnosis pipeline: First execute `node agents/judge/extract-corrections.js` to extract corrections from session history, then execute `node agents/judge/diagnose-reasoning.js` to analyze them and generate reasoning rules for BOOTSTRAP injection."
  },
  "delivery": { "mode": "none" }
}
```

## Notes

- Replace `YOUR_TIMEZONE` with your timezone (e.g., `Asia/Dubai`, `America/New_York`)
- The Judge agent needs to be registered in your openclaw.json as a separate agent
- All crons use `sessionTarget: "isolated"` so they don't interfere with active conversations
- Delivery `"mode": "none"` means silent — only alerts on errors
