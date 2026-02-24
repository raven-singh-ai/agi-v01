# Manual Installation Guide — AGI v0.1

For those who prefer to understand each step.

## Prerequisites

1. **OpenClaw** 2026.2.23+ running and configured
2. **Node.js** 20+
3. **OpenAI API key** (GPT-4o-mini costs ~$0.01/day for Thalamus reflex calls)
4. **git** and **jq** installed

## Step 1: Create Configuration

```bash
# In your agent's workspace (e.g., ~/clawd)
cat > thalamus-config.json << 'EOF'
{
  "agentName": "YourAgent",
  "humanName": "YourHuman",
  "agentId": "main",
  "workspace": "/full/path/to/workspace",
  "openclawDir": "/Users/you/.openclaw",
  "llmProvider": "openai",
  "llmModel": "gpt-4o-mini",
  "llmApiKey": "sk-your-key-here"
}
EOF
```

## Step 2: Copy Files

```bash
# Core brain daemon
cp thalamus.js ~/your-workspace/
cp thalamus-status.sh ~/your-workspace/
chmod +x ~/your-workspace/thalamus-status.sh

# Scripts
mkdir -p ~/your-workspace/scripts
cp scripts/*.sh ~/your-workspace/scripts/
chmod +x ~/your-workspace/scripts/*.sh

# Judge agent
mkdir -p ~/your-workspace/agents/judge/{verdicts,diagnoses}
cp agents/judge/AGENTS.md ~/your-workspace/agents/judge/
cp agents/judge/*.js ~/your-workspace/agents/judge/

# Data directories
mkdir -p ~/your-workspace/{data,memory,backups}
```

## Step 3: Create BOOTSTRAP.md

This is the cognitive state file. Create it from the template:

```bash
cp templates/BOOTSTRAP.md ~/your-workspace/BOOTSTRAP.md
# Edit to replace {{AGENT_NAME}}, {{HUMAN_NAME}}, {{WORKSPACE}}
```

## Step 4: Setup Daemon

### macOS (launchd)

```bash
cat > ~/Library/LaunchAgents/com.youragent.thalamus.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.youragent.thalamus</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/path/to/workspace/thalamus.js</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/path/to/workspace/data/thalamus-stdout.log</string>
    <key>StandardErrorPath</key>
    <string>/path/to/workspace/data/thalamus-stderr.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>OPENAI_API_KEY</key>
        <string>sk-your-key</string>
    </dict>
    <key>WorkingDirectory</key>
    <string>/path/to/workspace</string>
</dict>
</plist>
EOF

launchctl load ~/Library/LaunchAgents/com.youragent.thalamus.plist
```

### Linux (systemd)

```bash
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/youragent-thalamus.service << 'EOF'
[Unit]
Description=Thalamus v3 — AGI v0.1
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/node /path/to/workspace/thalamus.js
WorkingDirectory=/path/to/workspace
Restart=always
RestartSec=5
Environment=OPENAI_API_KEY=sk-your-key

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable youragent-thalamus
systemctl --user start youragent-thalamus
```

## Step 5: Register Judge Agent

Add to your `openclaw.json` in the `agents.list` array:

```json
{
  "id": "judge",
  "name": "judge",
  "workspace": "/path/to/workspace/agents/judge",
  "model": "anthropic/claude-sonnet-4-6"
}
```

## Step 6: Add Cron Jobs

See [crons.md](crons.md) for recommended cron job definitions.

## Step 7: Verify

```bash
# Check daemon is running
bash ~/your-workspace/thalamus-status.sh

# Full health check
bash ~/your-workspace/scripts/brain-health.sh

# Watch learning in real-time
tail -f ~/your-workspace/data/thalamus.log
```

## Troubleshooting

### Thalamus won't start
- Check `data/thalamus-stderr.log` for errors
- Verify `OPENAI_API_KEY` is set correctly
- Ensure Node.js 20+ is installed

### No knowledge being extracted
- Verify `thalamus-config.json` has correct `openclawDir` and `agentId`
- Check that sessions exist: `ls ~/.openclaw/agents/main/sessions/`
- Look at `data/thalamus.log` for processing errors

### BOOTSTRAP.md not updating
- Thalamus needs the file to exist first (create from template)
- Check file permissions
- Look for `ERROR injecting` in the log
