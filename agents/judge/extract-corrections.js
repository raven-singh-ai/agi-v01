#!/usr/bin/env node
/**
 * AGI v0.1 — Correction Extractor
 * 
 * Scans all session history to find every time the human corrected the agent.
 * Builds a corrections database the diagnosis engine uses.
 * 
 * Usage: node extract-corrections.js
 * Config: reads from ../thalamus-config.json or env vars
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Load config
const ROOT = path.resolve(__dirname, '..', '..');
const CONFIG_FILE = path.join(ROOT, 'thalamus-config.json');
let config = {};
try { config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch {}

const AGENT_ID = config.agentId || process.env.AGI_AGENT_ID || 'main';
const OPENCLAW_DIR = config.openclawDir || process.env.AGI_OPENCLAW_DIR || path.join(process.env.HOME, '.openclaw');
const SESSIONS_DIR = path.join(OPENCLAW_DIR, 'agents', AGENT_ID, 'sessions');
const OUTPUT = path.join(__dirname, 'corrections-db.json');

// Correction signal patterns
const CORRECTION_PATTERNS = [
  /\bbro\b/i, /\bwait\b/i, /that's not/i, /\bwrong\b/i,
  /get yourself back/i, /how comes/i, /i told you/i,
  /still not/i, /didn't work/i, /not what i/i,
  /you (said|told|claimed)/i, /check again/i, /\bnope\b/i,
  /that's wrong/i, /you forgot/i, /you missed/i,
  /not correct/i, /try again/i, /you're (wrong|missing)/i,
  /should(n't| not) have/i, /why did you/i,
  /don't (ask|report|tell)/i, /i already/i, /we already/i,
  /no[,.]? (that|it|this)/i, /but (i|we|you) (said|did|have)/i,
  /^\s*fix\s*$/i, /not (really|exactly|quite) what/i,
  /what (do you mean|are you talking)/i,
  /that doesn't (work|make sense|look)/i,
  /are you sure/i, /did you (even|actually) (read|check|look|test)/i,
  /come on\b/i, /just (do|tell|give|show) me/i,
  /stop (asking|talking|reporting)/i, /not the (point|question|issue)/i,
  /read (that|it|this) again/i,
];

const POSITIVE_EXCLUSIONS = [
  /^(yes|ok|okay|sure|great|nice|perfect|good|love|amazing|cool|awesome)/i,
  /that's (great|good|perfect|amazing|awesome|cool)/i,
  /^(👍|🔥|❤️|💪|✅|😂|🙏)/, /thank/i,
  /let's (go|do|build|ship)/i, /go for it/i,
  /^(yep|yup|yeah|ya)/i,
];

const STRONG_SIGNALS = [
  /get yourself back/i, /how comes/i, /that's not right/i,
  /you forgot/i, /you missed/i, /still not working/i,
  /i told you/i, /check again/i, /\bfix\b$/i, /stop/i,
  /focus/i, /are you sure/i, /read (that|it|this) again/i,
];

function isImplicitCorrection(sunnyMsg, ravenMsg) {
  if (!sunnyMsg || !ravenMsg) return false;
  const sw = sunnyMsg.split(/\s+/).length;
  const rw = ravenMsg.split(/\s+/).length;
  if (sw <= 5 && rw > 100) return true;
  if (sw <= 2 && rw > 50) return true;
  return false;
}

async function extractFromSession(filePath) {
  const corrections = [];
  const messages = [];

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    try {
      const entry = JSON.parse(line);
      if (entry.type !== 'message') continue;
      let msg = entry.message;
      if (typeof msg === 'string') try { msg = JSON.parse(msg); } catch { continue; }
      if (!msg || typeof msg !== 'object') continue;

      const role = msg.role;
      if (role !== 'user' && role !== 'assistant') continue;

      let text = '';
      const content = msg.content;
      if (typeof content === 'string') text = content;
      else if (Array.isArray(content)) text = content.filter(c => c?.type === 'text').map(c => c.text || '').join(' ');

      if (!text || text.length < 2) continue;
      text = text.replace(/^Conversation info.*?```\n/s, '').replace(/^\[Queued.*?---\n/sg, '').trim();
      if (!text) continue;

      messages.push({ role: role === 'user' ? 'human' : 'agent', text: text.slice(0, 1000) });
    } catch {}
  }

  for (let i = 1; i < messages.length; i++) {
    if (messages[i].role !== 'human') continue;
    if (i === 0 || messages[i - 1].role !== 'agent') continue;

    const humanText = messages[i].text;
    if (POSITIVE_EXCLUSIONS.some(p => p.test(humanText))) continue;

    const isExplicit = CORRECTION_PATTERNS.some(p => p.test(humanText));
    const isImplicit = isImplicitCorrection(humanText, messages[i - 1].text);
    if (!isExplicit && !isImplicit) continue;

    const isStrong = STRONG_SIGNALS.some(p => p.test(humanText));
    const context = messages.slice(Math.max(0, i - 3), i + 1)
      .map(m => `[${m.role}]: ${m.text.slice(0, 300)}`)
      .join('\n');

    corrections.push({
      agent_said: messages[i - 1].text.slice(0, 800),
      human_corrected: humanText.slice(0, 500),
      context,
      strength: isStrong ? 'strong' : (isImplicit && !isExplicit ? 'implicit' : 'weak'),
      session: path.basename(filePath),
    });
  }

  return corrections;
}

async function main() {
  const files = fs.readdirSync(SESSIONS_DIR)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => path.join(SESSIONS_DIR, f));

  const recentFiles = files
    .map(f => { try { return { path: f, mtime: fs.statSync(f).mtimeMs }; } catch { return null; } })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 50)
    .map(f => f.path);

  console.log(`Processing ${recentFiles.length} recent sessions...`);

  let allCorrections = [];
  for (let i = 0; i < recentFiles.length; i++) {
    try {
      const corrections = await extractFromSession(recentFiles[i]);
      allCorrections.push(...corrections);
      if (corrections.length > 0) {
        process.stdout.write(`[${i + 1}/${recentFiles.length}] ${path.basename(recentFiles[i]).slice(0, 8)}... ${corrections.length} corrections\n`);
      }
    } catch {}
  }

  const seen = new Set();
  const deduped = allCorrections.filter(c => {
    const key = c.human_corrected.slice(0, 50).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  deduped.sort((a, b) => (a.strength === 'strong' ? -1 : 1) - (b.strength === 'strong' ? -1 : 1));

  const db = {
    updated: new Date().toISOString(),
    sessions_processed: recentFiles.length,
    total_corrections: allCorrections.length,
    deduplicated: deduped.length,
    strong_corrections: deduped.filter(c => c.strength === 'strong').length,
    corrections: deduped
  };

  fs.writeFileSync(OUTPUT + '.tmp', JSON.stringify(db, null, 2));
  fs.renameSync(OUTPUT + '.tmp', OUTPUT);
  console.log(`\nTotal: ${allCorrections.length} corrections (${deduped.length} unique, ${db.strong_corrections} strong)`);
}

main().catch(err => { console.error(err); process.exit(1); });
