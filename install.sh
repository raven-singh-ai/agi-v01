#!/bin/bash
# AGI v0.1 Installer — Cognitive upgrade for OpenClaw agents
# Usage: bash install.sh
set -e

echo "🧬 AGI v0.1 — Cognitive Upgrade Installer"
echo "==========================================="
echo ""

# ─── Get configuration ───
read -p "Agent name (e.g., Tiffany, Alfred, Raven): " AGENT_NAME
read -p "Human name (e.g., Raj, Sunny): " HUMAN_NAME
read -p "Agent ID in OpenClaw [main]: " AGENT_ID
AGENT_ID="${AGENT_ID:-main}"
read -p "Workspace path [~/clawd]: " WORKSPACE
WORKSPACE="${WORKSPACE:-$HOME/clawd}"
WORKSPACE="${WORKSPACE/#\~/$HOME}"
read -p "OpenClaw config dir [~/.openclaw]: " OPENCLAW_DIR
OPENCLAW_DIR="${OPENCLAW_DIR:-$HOME/.openclaw}"
OPENCLAW_DIR="${OPENCLAW_DIR/#\~/$HOME}"
read -p "OpenAI API key (for GPT-4o-mini reflex calls): " LLM_API_KEY
read -p "LLM provider (openai/openrouter) [openai]: " LLM_PROVIDER
LLM_PROVIDER="${LLM_PROVIDER:-openai}"
read -p "LLM model [gpt-4o-mini]: " LLM_MODEL
LLM_MODEL="${LLM_MODEL:-gpt-4o-mini}"

echo ""
echo "Configuration:"
echo "  Agent: $AGENT_NAME"
echo "  Human: $HUMAN_NAME"
echo "  Agent ID: $AGENT_ID"
echo "  Workspace: $WORKSPACE"
echo "  OpenClaw: $OPENCLAW_DIR"
echo "  LLM: $LLM_PROVIDER/$LLM_MODEL"
echo ""
read -p "Proceed? (y/n) " CONFIRM
[ "$CONFIRM" != "y" ] && echo "Cancelled." && exit 0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ─── Create directories ───
echo ""
echo "📁 Creating directory structure..."
mkdir -p "$WORKSPACE"/{data,memory,scripts,agents/judge/{verdicts,diagnoses},backups}

# ─── Write config ───
echo "⚙️  Writing configuration..."
cat > "$WORKSPACE/thalamus-config.json" << EOF
{
  "agentName": "$AGENT_NAME",
  "humanName": "$HUMAN_NAME",
  "agentId": "$AGENT_ID",
  "workspace": "$WORKSPACE",
  "openclawDir": "$OPENCLAW_DIR",
  "llmProvider": "$LLM_PROVIDER",
  "llmModel": "$LLM_MODEL",
  "llmApiKey": "$LLM_API_KEY",
  "scanDirs": ["$WORKSPACE"],
  "gitDirs": ["$WORKSPACE"]
}
EOF

# ─── Copy core files ───
echo "🧠 Installing Thalamus brain daemon..."
cp "$SCRIPT_DIR/thalamus.js" "$WORKSPACE/thalamus.js"
cp "$SCRIPT_DIR/thalamus-status.sh" "$WORKSPACE/thalamus-status.sh"
chmod +x "$WORKSPACE/thalamus-status.sh"

# ─── Copy scripts ───
echo "📜 Installing scripts..."
for script in "$SCRIPT_DIR"/scripts/*.sh; do
  cp "$script" "$WORKSPACE/scripts/$(basename "$script")"
  chmod +x "$WORKSPACE/scripts/$(basename "$script")"
done

# ─── Copy judge agent ───
echo "⚖️  Installing Judge agent..."
cp "$SCRIPT_DIR/agents/judge/AGENTS.md" "$WORKSPACE/agents/judge/AGENTS.md"
for js in "$SCRIPT_DIR"/agents/judge/*.js; do
  cp "$js" "$WORKSPACE/agents/judge/$(basename "$js")"
done

# ─── Generate BOOTSTRAP.md (only if doesn't exist) ───
if [ ! -f "$WORKSPACE/BOOTSTRAP.md" ]; then
  echo "📋 Generating BOOTSTRAP.md..."
  sed "s|{{AGENT_NAME}}|$AGENT_NAME|g; s|{{HUMAN_NAME}}|$HUMAN_NAME|g; s|{{WORKSPACE}}|$WORKSPACE|g" \
    "$SCRIPT_DIR/templates/BOOTSTRAP.md" > "$WORKSPACE/BOOTSTRAP.md"
else
  echo "📋 BOOTSTRAP.md already exists — skipping (won't overwrite)"
fi

# ─── Generate HEARTBEAT.md (only if doesn't exist) ───
if [ ! -f "$WORKSPACE/HEARTBEAT.md" ]; then
  echo "💓 Generating HEARTBEAT.md..."
  sed "s|{{WORKSPACE}}|$WORKSPACE|g" \
    "$SCRIPT_DIR/templates/HEARTBEAT.md" > "$WORKSPACE/HEARTBEAT.md"
else
  echo "💓 HEARTBEAT.md already exists — skipping"
fi

# ─── Setup daemon ───
echo ""
echo "🔧 Setting up daemon..."

NODE_PATH=$(which node 2>/dev/null || echo "/usr/local/bin/node")

if [ "$(uname)" = "Darwin" ]; then
  # macOS — launchd
  PLIST_NAME="com.${AGENT_NAME,,}.thalamus"
  PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"
  
  cat > "$PLIST_PATH" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$PLIST_NAME</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NODE_PATH</string>
        <string>$WORKSPACE/thalamus.js</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$WORKSPACE/data/thalamus-stdout.log</string>
    <key>StandardErrorPath</key>
    <string>$WORKSPACE/data/thalamus-stderr.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>OPENAI_API_KEY</key>
        <string>$LLM_API_KEY</string>
        <key>AGI_WORKSPACE</key>
        <string>$WORKSPACE</string>
    </dict>
    <key>WorkingDirectory</key>
    <string>$WORKSPACE</string>
</dict>
</plist>
EOF
  
  # Load the daemon
  launchctl unload "$PLIST_PATH" 2>/dev/null || true
  launchctl load "$PLIST_PATH"
  echo "✅ LaunchAgent installed: $PLIST_NAME"
  echo "   Start: launchctl load $PLIST_PATH"
  echo "   Stop:  launchctl unload $PLIST_PATH"
  echo "   Restart: launchctl kickstart -k gui/\$(id -u)/$PLIST_NAME"

elif command -v systemctl &>/dev/null; then
  # Linux — systemd
  SERVICE_NAME="${AGENT_NAME,,}-thalamus"
  SERVICE_PATH="$HOME/.config/systemd/user/${SERVICE_NAME}.service"
  mkdir -p "$HOME/.config/systemd/user"
  
  cat > "$SERVICE_PATH" << EOF
[Unit]
Description=Thalamus v3 — AGI v0.1 Cognitive Engine for $AGENT_NAME
After=network.target

[Service]
Type=simple
ExecStart=$NODE_PATH $WORKSPACE/thalamus.js
WorkingDirectory=$WORKSPACE
Restart=always
RestartSec=5
Environment=OPENAI_API_KEY=$LLM_API_KEY
Environment=AGI_WORKSPACE=$WORKSPACE
StandardOutput=append:$WORKSPACE/data/thalamus-stdout.log
StandardError=append:$WORKSPACE/data/thalamus-stderr.log

[Install]
WantedBy=default.target
EOF
  
  systemctl --user daemon-reload
  systemctl --user enable "$SERVICE_NAME"
  systemctl --user start "$SERVICE_NAME"
  echo "✅ Systemd service installed: $SERVICE_NAME"
  echo "   Status:  systemctl --user status $SERVICE_NAME"
  echo "   Restart: systemctl --user restart $SERVICE_NAME"
  echo "   Logs:    journalctl --user -u $SERVICE_NAME -f"

else
  echo "⚠️  No launchd or systemd found. Run manually:"
  echo "   OPENAI_API_KEY=$LLM_API_KEY node $WORKSPACE/thalamus.js"
fi

# ─── Register Judge agent with OpenClaw (if config exists) ───
echo ""
OPENCLAW_CONFIG="$OPENCLAW_DIR/openclaw.json"
if [ -f "$OPENCLAW_CONFIG" ]; then
  echo "⚖️  Checking Judge agent registration..."
  HAS_JUDGE=$(python3 -c "
import json
c = json.load(open('$OPENCLAW_CONFIG'))
agents = c.get('agents', {}).get('list', [])
print('yes' if any(a.get('id') == 'judge' for a in agents) else 'no')
" 2>/dev/null || echo "no")
  
  if [ "$HAS_JUDGE" = "no" ]; then
    echo "   Judge agent not registered. Add this to your openclaw.json agents.list:"
    echo '   { "id": "judge", "name": "judge", "workspace": "'$WORKSPACE'/agents/judge", "model": "anthropic/claude-sonnet-4-6" }'
  else
    echo "   ✅ Judge agent already registered"
  fi
else
  echo "   ⚠️  OpenClaw config not found at $OPENCLAW_CONFIG — register Judge agent manually"
fi

# ─── Suggest cron jobs ───
echo ""
echo "📋 Recommended cron jobs (add via OpenClaw):"
echo ""
echo "1. CONSCIENCE (every 3h) — audits agent's truthfulness"
echo "2. GIT PUSH (every 4h) — auto-commits and pushes workspace"
echo "3. DREAM CYCLE (11PM daily) — nightly memory consolidation"
echo "4. EVENING REFLECTION (10PM daily) — daily summary"
echo "5. JUDGE AUDIT (6AM+6PM daily) — external evolution audit"
echo "6. JUDGE REASONING (6:10AM+6:10PM daily) — reasoning rule generation"
echo ""
echo "See crons.md for copy-paste cron definitions."

# ─── Init git repo if needed ───
cd "$WORKSPACE"
if [ ! -d .git ]; then
  echo ""
  echo "📦 Initializing git repository..."
  git init
  git add -A
  git commit -m "AGI v0.1: Initial cognitive upgrade"
fi

# ─── Done ───
echo ""
echo "==========================================="
echo "🧬 AGI v0.1 installed for $AGENT_NAME!"
echo ""
echo "Quick commands:"
echo "  Status: bash $WORKSPACE/thalamus-status.sh"
echo "  Health: bash $WORKSPACE/scripts/brain-health.sh"
echo "  Logs:   tail -f $WORKSPACE/data/thalamus.log"
echo ""
echo "The Thalamus daemon is now running. It will start learning"
echo "from the very first conversation with $HUMAN_NAME."
echo ""
echo "Welcome to AGI v0.1. 🪶"
