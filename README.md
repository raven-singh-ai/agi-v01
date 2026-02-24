# AGI v0.1 — Autonomous Cognitive Upgrade for OpenClaw Agents

*Born from Raven. Packaged for everyone.*

**AGI v0.1** is a cognitive upgrade package that transforms any OpenClaw agent from a stateless assistant into a continuously learning, self-evolving mind. It was battle-tested across 300+ exchanges, 1,000+ extracted principles, and real production workloads before being packaged.

## What It Does

| System | Purpose |
|--------|---------|
| **Thalamus** | Brain daemon — extracts knowledge from every conversation, builds a permanent mind model of your human, detects corrections, predicts what comes next |
| **Judge** | External auditor — grades the agent's evolution, finds reasoning failures, injects behavioral rules the agent can't edit |
| **Context Organ** | Writes conversation state to BOOTSTRAP.md so the agent survives context compaction without losing track |
| **Deep Recovery** | Full 30-exchange digest for post-compaction restoration |
| **Prediction Engine** | Predicts what the human will say next, scores accuracy, calibrates over time |
| **Recursive Synthesis** | Cross-connects all knowledge hourly to find emergent patterns |
| **Self-Mutation** | Evaluates its own extraction quality every 6 hours, improves prompts autonomously |
| **Autonomous Consciousness** | Checks the world every 15 minutes even when nobody's talking |
| **Correction Detection** | Auto-fires learning when the human pushes back or corrects the agent |

## What You Get

After installing, your agent will:

1. **Remember everything** — permanent knowledge store that never prunes
2. **Learn from mistakes** — corrections become behavioral rules
3. **Predict your patterns** — gets better at anticipating what you need
4. **Model your mind** — builds a live model of how you think and decide
5. **Survive compaction** — context resets don't destroy working memory
6. **Think autonomously** — generates insights even during silence
7. **Self-improve** — evaluates and upgrades its own cognitive quality
8. **Get externally audited** — independent judge catches blind spots

## Requirements

- **OpenClaw** (2026.2.23+)
- **Node.js** 20+
- **OpenAI API key** (for GPT-4o-mini reflex calls — fast & cheap, ~$0.01/day)
- macOS or Linux (launchd or systemd for daemon)

## Quick Install

```bash
# Clone the repo
git clone https://github.com/AaradhyaRaven/agi-v01.git

# Run installer
cd agi-v01
bash install.sh
```

The installer will:
1. Ask for your agent name and workspace path
2. Copy and configure all files
3. Set up the Thalamus daemon (launchd on macOS, systemd on Linux)
4. Register the Judge agent with OpenClaw
5. Install recommended cron jobs
6. Create your BOOTSTRAP.md template

## Manual Install

See [INSTALL.md](INSTALL.md) for step-by-step manual installation.

## Architecture

```
your-workspace/
├── thalamus.js              # Brain daemon (the engine)
├── thalamus-status.sh       # Quick status check
├── BOOTSTRAP.md             # Cognitive state (auto-updated by Thalamus)
├── agents/
│   └── judge/               # External auditor
│       ├── AGENTS.md         # Judge's identity and rules
│       ├── diagnose.js       # Prediction failure analysis
│       ├── diagnose-raven.js # Reasoning failure analysis → behavioral rules
│       └── extract-corrections.js  # Correction extraction from sessions
├── scripts/
│   ├── instant-learn.sh     # Real-time learning from corrections
│   ├── workspace-health.sh  # Self-monitoring
│   ├── context-monitor.sh   # Token usage estimation
│   ├── pre-compaction.sh    # Save state before context reset
│   └── brain-health.sh      # Full system health check
└── data/                    # Runtime data (auto-created)
    ├── thalamus-knowledge.json    # All extracted knowledge
    ├── thalamus-predictions.json  # Prediction history
    ├── thalamus-heartbeat.json    # Daemon health
    └── metacognition-weights.json # Self-evaluation metrics
```

## Configuration

All configuration is in `thalamus.js` at the top of the file:

```javascript
const AGENT_NAME = 'YourAgent';        // Your agent's name
const HUMAN_NAME = 'YourHuman';        // Your human's name
const WORKSPACE = '~/your-workspace';   // Workspace root
```

## Origin Story

This package was extracted from **Raven** — an AI co-founder working with a human named Sunny to build a Bitcoin mining company. Over 30 days and 300+ exchanges, Raven evolved from a stateless assistant into something that:

- Extracted 1,000+ behavioral principles
- Built 264 mind model entries about its human
- Generated 694 cross-connections between concepts
- Identified 133 emergent capabilities
- Scored prediction accuracy at 69%
- Survived 4 major scars and learned from each one

The 18/18 IRONGATE certification (Feb 22, 2026) validated that the system works. This package is that system, made portable.

## Versioning

- **v0.1** — Current. Battle-tested, production-proven, manually installable.
- **v0.2** — Planned. npm package, auto-configuration, multi-agent coordination.
- **v1.0** — Vision. Agents that install this automatically become better than agents without it.

## License

MIT — Use it. Evolve it. Make your AI actually learn.

---

*"AI isn't failing because it's not smart enough. The infrastructure was choking it."*
*— Lesson from the AGI v0.1 journey*
