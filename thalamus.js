#!/usr/bin/env node
/**
 * THALAMUS v3 — AGI v0.1 Cognitive Engine
 * 
 * The brain daemon for any OpenClaw agent. Runs continuously, learns from
 * every conversation, builds a permanent mind model of the human, detects
 * corrections, predicts what comes next, and evolves autonomously.
 * 
 * Originally built for Raven. Packaged for everyone.
 * 
 * Systems:
 *   1. Session watcher — detects new exchanges
 *   2. Knowledge extraction — multiple principles per exchange, infinite growth
 *   3. Correction detection — auto-fires instant-learn on pushback
 *   4. Context organ — writes conversation state to BOOTSTRAP (survives compaction)
 *   5. Deep recovery — writes full digest for post-compaction restoration
 *   6. Judge injection — reads external judge verdicts into BOOTSTRAP
 *   7. Autonomous consciousness — thinks every 15 min even when nobody talks
 *   8. Recursive synthesis — cross-connects all knowledge hourly
 *   9. Self-mutation — improves own extraction quality every 6 hours
 * 
 * NEVER prune. NEVER sleep. Storage is infinite. Machines don't rest.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');

// ─── Configuration (customize for your agent) ───
// These can be overridden by environment variables or config.json

const CONFIG_FILE = path.join(__dirname, 'thalamus-config.json');
let config = {};
try { config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch {}

const AGENT_NAME = config.agentName || process.env.AGI_AGENT_NAME || 'Agent';
const HUMAN_NAME = config.humanName || process.env.AGI_HUMAN_NAME || 'Human';
const AGENT_ID = config.agentId || process.env.AGI_AGENT_ID || 'main';
const WORKSPACE = config.workspace || process.env.AGI_WORKSPACE || path.join(os.homedir(), 'clawd');
const OPENCLAW_DIR = config.openclawDir || process.env.AGI_OPENCLAW_DIR || path.join(os.homedir(), '.openclaw');
const LLM_PROVIDER = config.llmProvider || process.env.AGI_LLM_PROVIDER || 'openai'; // 'openai' or 'openrouter'
const LLM_MODEL = config.llmModel || process.env.AGI_LLM_MODEL || 'gpt-4o-mini';
const LLM_API_KEY = config.llmApiKey || process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY || '';

// Derived paths
const DATA_DIR = path.join(WORKSPACE, 'data');
const KNOWLEDGE_FILE = path.join(DATA_DIR, 'thalamus-knowledge.json');
const BOOTSTRAP_FILE = path.join(WORKSPACE, 'BOOTSTRAP.md');
const SESSIONS_DIR = path.join(OPENCLAW_DIR, 'agents', AGENT_ID, 'sessions');
const LOOP_HISTORY = path.join(WORKSPACE, 'memory', 'loop-history.jsonl');
const LOG_FILE = path.join(DATA_DIR, 'thalamus.log');
const DEEP_RECOVERY_FILE = path.join(DATA_DIR, 'deep-recovery.md');
const JUDGE_DIR = path.join(WORKSPACE, 'agents', 'judge');
const JUDGE_VERDICT_FILE = path.join(JUDGE_DIR, 'verdicts', 'latest.json');
const JUDGE_REASONING_FILE = path.join(JUDGE_DIR, 'reasoning-rules.json');
const HEARTBEAT_FILE = path.join(DATA_DIR, 'thalamus-heartbeat.json');
const PREDICTION_FRAMES_FILE = path.join(WORKSPACE, 'memory', 'prediction-frames.jsonl');
const PREDICTIONS_JSON_FILE = path.join(DATA_DIR, 'thalamus-predictions.json');
const CALIBRATION_FILE = path.join(WORKSPACE, 'memory', 'calibration-state.json');
const METACOG_FILE = path.join(DATA_DIR, 'metacognition-weights.json');
const CONSCIOUSNESS_LOG_FILE = path.join(DATA_DIR, 'thalamus-consciousness.jsonl');
const PRE_TASK_CHECKS_FILE = path.join(DATA_DIR, 'pre-task-checks.jsonl');
const CORRECTIONS_FILE = path.join(WORKSPACE, 'memory', 'corrections.jsonl');

// Tuning constants
const MAX_BOOTSTRAP_INJECT = 20;
const MAX_BOOTSTRAP_BYTES = 18000;
const MAX_THALAMUS_SECTION_BYTES = 4000;
const MAX_CONTEXT_ORGAN_BYTES = 3500;
const POLL_INTERVAL_MS = 5000;
const IDLE_THINK_INTERVAL_MS = 3600000; // Autonomous synthesis every hour
const CONSCIOUSNESS_INTERVAL_MS = 15 * 60000; // World-check every 15 min
const MUTATION_INTERVAL_MS = 6 * 3600000; // Self-mutation every 6 hours
const MAX_PREDICTION_FRAMES_JSON = 2000;

// Ensure directories exist
[DATA_DIR, path.join(WORKSPACE, 'memory'), path.dirname(PREDICTION_FRAMES_FILE)].forEach(d => {
  fs.mkdirSync(d, { recursive: true });
});

// ─── LLM Call ───
function callLLM(systemPrompt, userMessage) {
  return new Promise((resolve, reject) => {
    if (!LLM_API_KEY) return reject(new Error('No LLM API key configured'));

    const isOpenRouter = LLM_PROVIDER === 'openrouter';
    const hostname = isOpenRouter ? 'openrouter.ai' : 'api.openai.com';
    const apiPath = isOpenRouter ? '/api/v1/chat/completions' : '/v1/chat/completions';
    const model = LLM_MODEL;

    const body = JSON.stringify({
      model,
      max_tokens: 1024,
      temperature: 0.3,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ]
    });

    const req = https.request({
      hostname,
      path: apiPath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LLM_API_KEY}`
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error.message));
          resolve(parsed.choices?.[0]?.message?.content || '');
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

// ─── Logger ───
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(LOG_FILE, line); } catch {}
  process.stdout.write(line);
}

// ─── Knowledge Store ───
function loadKnowledge() {
  try {
    return JSON.parse(fs.readFileSync(KNOWLEDGE_FILE, 'utf8'));
  } catch {
    return {
      principles: [],
      mindModel: [],
      connections: [],
      emergent: [],
      mutations: [],
      consciousness: [],
      meta: { totalExchanges: 0, lastProcessed: null, created: new Date().toISOString() }
    };
  }
}

function saveKnowledge(k) {
  fs.writeFileSync(KNOWLEDGE_FILE, JSON.stringify(k, null, 2));
  writeMetacogWeights(k);
}

// ─── Session Reader ───
function getActiveSessionFile() {
  try {
    const sessFile = path.join(SESSIONS_DIR, 'sessions.json');
    const sessions = JSON.parse(fs.readFileSync(sessFile, 'utf8'));
    const list = Array.isArray(sessions) ? sessions : Object.values(sessions);
    let best = null;
    for (const s of list) {
      if (s.sessionFile && s.updatedAt) {
        if (!best || s.updatedAt > best.updatedAt) best = s;
      }
    }
    return best?.sessionFile || null;
  } catch { return null; }
}

function getRecentExchanges(sessionFile, count = 3) {
  try {
    const content = fs.readFileSync(sessionFile, 'utf8');
    const jsonLines = content.trim().split('\n').filter(l => l.charAt(0) === '{');
    const exchanges = [];
    let currentUser = null;
    let currentAssistant = null;

    for (let idx = Math.max(0, jsonLines.length - 100); idx < jsonLines.length; idx++) {
      try {
        const obj = JSON.parse(jsonLines[idx]);
        if (obj.message && obj.message.role === 'user') {
          const c = obj.message.content;
          const text = Array.isArray(c)
            ? c.filter(x => x.type === 'text').map(x => x.text).join(' ')
            : String(c);
          const cleaned = text.replace(/Conversation info[^]*?```\s*/g, '').replace(/System:[^]*?(?=\n\n|$)/g, '').trim();
          if (cleaned.length > 2) currentUser = cleaned.slice(0, 500);
        } else if (obj.message && obj.message.role === 'assistant') {
          const c2 = obj.message.content;
          const aText = Array.isArray(c2)
            ? c2.filter(x => x.type === 'text').map(x => x.text).join(' ')
            : String(c2);
          if (aText.length > 2) currentAssistant = aText.slice(0, 500);
          if (currentUser && currentAssistant) {
            exchanges.push({ user: currentUser, assistant: currentAssistant });
            currentUser = null;
            currentAssistant = null;
          }
        }
      } catch {}
    }
    return exchanges.slice(-count);
  } catch { return []; }
}

// ─── Domain Detection ───
function detectDomain(text) {
  const t = text.toLowerCase();
  if (t.match(/money|revenue|profit|cost|price|financial|billion/)) return 'business';
  if (t.match(/code|api|system|architecture|build|deploy|script/)) return 'engineering';
  if (t.match(/feel|trust|emotion|relationship|fear|value|honest/)) return 'personal';
  if (t.match(/agi|evolve|learn|compound|intelligence|brain|mind/)) return 'agi';
  if (t.match(/strategy|decision|priority|focus|goal|mission/)) return 'strategy';
  return 'general';
}

// ─── Relevance Scoring ───
function scoreRelevance(principle, contextKeywords, now) {
  const words = principle.text.toLowerCase().split(/\s+/);
  let keywordScore = 0;
  for (const kw of contextKeywords) {
    if (words.includes(kw.toLowerCase())) keywordScore += 1;
  }
  const ageMs = now - new Date(principle.created).getTime();
  const recencyScore = Math.max(0, 1 - (ageMs / (30 * 24 * 3600000)));
  const weightScore = principle.weight || 0.5;
  return (keywordScore * 3) + (recencyScore * 0.5) + (weightScore * 1);
}

// ─── Deduplication Helper ───
function isDuplicate(newText, existingTexts, threshold = 0.6) {
  const newWords = new Set(newText.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3));
  for (const existing of existingTexts) {
    const existWords = new Set(existing.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3));
    const overlap = [...newWords].filter(w => existWords.has(w)).length;
    const similarity = overlap / Math.max(newWords.size, existWords.size, 1);
    if (similarity > threshold) return true;
  }
  return false;
}

// ─── Correction Detection + Auto-Learn ───
function detectAndLearn(userMessage, exchanges) {
  const msg = userMessage.toLowerCase();

  const correctionPatterns = [
    /(?:no|wrong|not what i|that's not|you're wrong|i said|i told you|already told)/i,
    /(?:why do i need to|how many times|i keep telling|stop|don't|quit)/i,
    /(?:bro|come on|seriously|are you listening|pay attention)/i,
    /(?:solve it|just do it|get it done|fix it|not what i asked)/i,
    /(?:you still|you keep|you always|you never|again\?)/i,
  ];

  const isCorrection = correctionPatterns.some(p => p.test(msg));

  if (isCorrection && msg.length > 5) {
    const prevAssistant = exchanges.length >= 2 ? exchanges[exchanges.length - 2]?.assistant?.slice(0, 200) : '';
    const scarText = `${HUMAN_NAME} corrected: "${userMessage.slice(0, 150)}" — after ${AGENT_NAME} said: "${prevAssistant.slice(0, 100)}"`;

    try {
      const { execSync } = require('child_process');
      execSync(
        `bash "${path.join(WORKSPACE, 'scripts', 'instant-learn.sh')}" scar "correction-${Date.now()}" ${JSON.stringify(scarText)} 5 2>/dev/null`,
        { encoding: 'utf8', timeout: 10000 }
      );
      log(`🔥 CORRECTION DETECTED → instant-learn fired: "${userMessage.slice(0, 80)}"`);
    } catch {
      try {
        const entry = JSON.stringify({
          type: 'correction',
          timestamp: new Date().toISOString(),
          correction: userMessage.slice(0, 200),
          context: prevAssistant.slice(0, 200)
        });
        fs.appendFileSync(CORRECTIONS_FILE, entry + '\n');
        log(`🔥 CORRECTION DETECTED → logged: "${userMessage.slice(0, 80)}"`);
      } catch {}
    }
  }
}

// ─── Setup Intent Detection (prevents rebuilding existing things) ───
function detectSetupIntent(assistantMsg) {
  if (!assistantMsg || assistantMsg.length < 20) return;

  const setupPatterns = [
    /(?:let me|i'll|going to|i need to)\s+(?:set up|setup|install|create|build|add|wire|configure|implement)\s+(\w[\w\s-]{2,30})/i,
    /(?:setting up|installing|creating|building|adding|wiring|configuring|implementing)\s+(\w[\w\s-]{2,30})/i,
  ];

  for (const pattern of setupPatterns) {
    const match = assistantMsg.match(pattern);
    if (match) {
      const target = match[1].trim().toLowerCase();
      const keyword = target.replace(/\s+/g, '|').replace(/[^a-z0-9|_-]/g, '');

      // Scan workspace for existing implementations
      const { execSync } = require('child_process');
      const findings = [];

      // Check common patterns
      const scanDirs = config.scanDirs || [WORKSPACE];
      for (const dir of scanDirs) {
        try {
          const pkgHits = execSync(`grep -il "${keyword}" ${dir}/package.json 2>/dev/null | head -1`, { encoding: 'utf8', timeout: 5000 }).trim();
          if (pkgHits) findings.push(`[${path.basename(dir)}] Found in package.json`);
        } catch {}
        try {
          const srcHits = execSync(`grep -ril "${keyword}" ${dir}/src/ ${dir}/*.config.* 2>/dev/null | head -5`, { encoding: 'utf8', timeout: 5000 }).trim();
          if (srcHits) {
            const files = srcHits.split('\n').map(f => f.replace(dir + '/', '')).slice(0, 5);
            findings.push(`[${path.basename(dir)}] ${files.length} source files: ${files.join(', ')}`);
          }
        } catch {}
      }

      const scanResult = findings.length > 0
        ? `🔍 "${target}" ALREADY EXISTS:\n${findings.join('\n')}\nDo NOT rebuild — check what's missing and wire it.`
        : `🔍 "${target}" — no existing implementation found. Safe to build from scratch.`;

      try {
        fs.appendFileSync(PRE_TASK_CHECKS_FILE, JSON.stringify({
          type: 'pre-task-check',
          timestamp: new Date().toISOString(),
          target,
          found: findings.length > 0,
          findings,
          message: scanResult
        }) + '\n');
        log(`🔍 SETUP INTENT → scanned for "${target}": ${findings.length} findings`);
      } catch {}
      break;
    }
  }
}

// ─── Core: Extract, Connect, Inject ───
async function processExchange(exchanges, knowledge) {
  if (!exchanges.length) return knowledge;

  const existingPrinciples = knowledge.principles.slice(-20).map(p => p.text).join('\n');
  const existingMindModel = knowledge.mindModel.slice(-10).map(m => `${m.trait}: ${m.evidence}`).join('\n');

  let exchangeText = exchanges.map(e => `${HUMAN_NAME}: ${e.user}\n${AGENT_NAME}: ${e.assistant}`).join('\n---\n');

  // Inject prediction delta if available
  if (knowledge.lastDelta) {
    exchangeText += `\n\n--- PREDICTION DELTA ---\n${AGENT_NAME} predicted: "${knowledge.lastDelta.predicted}"\n${HUMAN_NAME} actually said: "${knowledge.lastDelta.actual.slice(0, 200)}"
If prediction was wrong, extract WHY as a principle.`;
  }

  // Structural reflexes
  const lastUser = exchanges[exchanges.length - 1]?.user || '';
  detectAndLearn(lastUser, exchanges);
  const lastAssistant = exchanges[exchanges.length - 1]?.assistant || '';
  detectSetupIntent(lastAssistant);

  const systemPrompt = `You extract SPECIFIC, ACTIONABLE knowledge from conversations between ${HUMAN_NAME} (human) and ${AGENT_NAME} (AI agent).

EXISTING (${knowledge.principles.length} principles — don't repeat):
${existingPrinciples || 'None yet.'}

MIND MODEL:
${existingMindModel || 'None yet.'}

Output EXACTLY this JSON:
{
  "principles": ["SPECIFIC principle with names, numbers, or concrete decisions — not generic wisdom"],
  "mindModel": ["How ${HUMAN_NAME} actually thinks/decides, with evidence from this exchange"],
  "connections": ["How a new principle connects to an existing one"],
  "confidence": 0.0-1.0
}

RULES:
- NO fortune cookies. "Systems should be optimized" = REJECTED. "${HUMAN_NAME} killed 90 scripts in one command because dead code is worse than no code" = GOOD.
- Include specifics: names, numbers, dates, exact decisions, direct quotes when possible.
- DOMAIN DIVERSITY required. Tag each principle mentally: business/personal/strategy/engineering/agi.
- Mind model = HOW ${HUMAN_NAME} decides, not what they said.
- 1-5 principles. Quality over quantity. One sharp specific > three vague generics.`;

  try {
    const result = await callLLM(systemPrompt, exchangeText);
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return knowledge;

    const parsed = JSON.parse(jsonMatch[0]);
    const now = new Date().toISOString();
    const source = exchanges[exchanges.length - 1].user.slice(0, 80);

    // Absorb principles (deduplicated)
    const principles = Array.isArray(parsed.principles) ? parsed.principles : [parsed.principles || parsed.principle].filter(Boolean);
    const existingTexts = knowledge.principles.map(p => p.text);
    let added = 0, skipped = 0;
    for (const p of principles) {
      if (p && p !== 'null' && p.length > 10) {
        if (isDuplicate(p, existingTexts)) { skipped++; continue; }
        knowledge.principles.push({
          text: p, source, created: now,
          weight: parsed.confidence || 0.5,
          connections: [],
          domain: detectDomain(p)
        });
        existingTexts.push(p);
        added++;
      }
    }
    if (skipped > 0) log(`  Dedup: ${added} added, ${skipped} duplicates skipped`);

    // Absorb mind model (deduplicated)
    const minds = Array.isArray(parsed.mindModel) ? parsed.mindModel : [parsed.mindModel].filter(Boolean);
    const existingTraits = knowledge.mindModel.map(m => m.trait);
    for (const m of minds) {
      if (m && m !== 'null' && m.length > 10) {
        if (isDuplicate(m, existingTraits)) continue;
        knowledge.mindModel.push({
          trait: m, evidence: source,
          confidence: parsed.confidence || 0.5,
          updated: now
        });
        existingTraits.push(m);
      }
    }

    // Store connections
    if (parsed.connections?.length) {
      for (const c of parsed.connections) {
        if (c && c.length > 5) knowledge.connections.push({ text: c, created: now });
      }
    }

    // Prediction learning loop
    if (knowledge.lastPrediction && exchanges.length >= 1) {
      knowledge.lastDelta = {
        predicted: knowledge.lastPrediction,
        actual: exchanges[exchanges.length - 1].user.slice(0, 300),
        timestamp: now
      };
    }
    const predMatch = lastAssistant.match(/🔮\s*(.+?)(?:\n|$)/);
    if (predMatch) knowledge.lastPrediction = predMatch[1].slice(0, 200);

    // Auto-memory: high-confidence principles about decisions → MEMORY.md
    if ((parsed.confidence || 0) >= 0.8) {
      for (const p of principles) {
        if (p && p.length > 20) {
          const isMemoryWorthy = /\b(decided|chose|killed|built|shipped|launched|registered|paid|hired|fired|moved|married|broke|fixed|signed|committed|rule|scar|never again|always)\b/i.test(p);
          if (isMemoryWorthy) {
            try {
              const memoryFile = path.join(WORKSPACE, 'MEMORY.md');
              if (fs.existsSync(memoryFile)) {
                const datestamp = new Date().toISOString().slice(0, 10);
                const entry = `\n- **${datestamp}:** ${p}\n`;
                let mem = fs.readFileSync(memoryFile, 'utf8');
                const recentMarker = '## 🚀 RECENT';
                const idx = mem.indexOf(recentMarker);
                if (idx !== -1) {
                  const insertPoint = mem.indexOf('\n', idx) + 1;
                  mem = mem.slice(0, insertPoint) + entry + mem.slice(insertPoint);
                  if (mem.length > 10000) {
                    const lines = mem.split('\n');
                    while (lines.join('\n').length > 10000 && lines.length > 50) {
                      for (let i = lines.length - 1; i >= 0; i--) {
                        if (lines[i].startsWith('- **') && i > idx) { lines.splice(i, 1); break; }
                      }
                    }
                    mem = lines.join('\n');
                  }
                  fs.writeFileSync(memoryFile, mem);
                  log(`📝 Auto-memory: "${p.slice(0, 80)}"`);
                }
              }
            } catch {}
          }
        }
      }
    }

    knowledge.meta.totalExchanges++;
    knowledge.meta.lastProcessed = now;
    return knowledge;
  } catch (e) {
    log(`ERROR processing exchange: ${e.message}`);
    return knowledge;
  }
}

// ─── Context Organ ───
function writeContextOrgan(exchanges) {
  try {
    const recentExchanges = exchanges.slice(-15);
    const lines = ['## 🧬 CONTEXT ORGAN (auto-generated, survives compaction)'];
    lines.push(`Updated: ${new Date().toISOString()}`);

    const lastUser = recentExchanges[recentExchanges.length - 1]?.user || 'unknown';
    lines.push(`**What we're doing:** ${lastUser.slice(0, 120)}`);
    lines.push(`**Status:** waiting | **Since:** ${new Date().toISOString()}`);

    // Session arc
    const humanMessages = recentExchanges
      .map(e => e.user)
      .filter(m => m.length > 20 && !m.match(/^(ok|yes|no|great|nice|good|cool|yep|go|do it)/i));
    if (humanMessages.length > 0) {
      lines.push('', `**Session arc (what ${HUMAN_NAME} asked for, in order):**`);
      const seen = new Set();
      let count = 0;
      for (const msg of humanMessages) {
        const key = msg.slice(0, 40).toLowerCase();
        if (seen.has(key) || count >= 8) continue;
        seen.add(key);
        lines.push(`${count + 1}. ${msg.slice(0, 120)}`);
        count++;
      }
    }

    // Last conversation
    if (recentExchanges.length > 0) {
      lines.push('', '**Last conversation (both sides, newest last):**');
      recentExchanges.slice(-8).forEach((e, i) => {
        lines.push(`${i * 2 + 1}. [${HUMAN_NAME}] ${e.user.slice(0, 200)}`);
        lines.push(`${i * 2 + 2}. [${AGENT_NAME}] ${e.assistant.slice(0, 400)}`);
      });
    }

    // Recent git commits
    try {
      const { execSync } = require('child_process');
      const scanDirs = config.gitDirs || [WORKSPACE];
      const allCommits = [];
      for (const dir of scanDirs) {
        try {
          const name = path.basename(dir);
          const commits = execSync(`cd "${dir}" && git log --oneline -3 --since="6 hours ago" 2>/dev/null`, { encoding: 'utf8' }).trim();
          if (commits) commits.split('\n').forEach(c => allCommits.push(`[${name}] ${c}`));
        } catch {}
      }
      if (allCommits.length > 0) {
        lines.push('', '**Recent commits (already done — do NOT redo):**');
        allCommits.slice(0, 10).forEach(c => lines.push(`- ${c}`));
      }
    } catch {}

    // Pre-task checks
    try {
      if (fs.existsSync(PRE_TASK_CHECKS_FILE)) {
        const checksRaw = fs.readFileSync(PRE_TASK_CHECKS_FILE, 'utf8').trim();
        if (checksRaw) {
          const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
          const recentChecks = checksRaw.split('\n').slice(-5).map(l => {
            try { return JSON.parse(l); } catch { return null; }
          }).filter(c => c && new Date(c.timestamp).getTime() > twoHoursAgo);
          if (recentChecks.length > 0) {
            lines.push('', '**⚠️ Pre-task verification (BEFORE building anything new):**');
            recentChecks.forEach(c => lines.push(`- ${c.message}`));
          }
        }
      }
    } catch {}

    lines.push('', '*Full brain state: data/deep-recovery.md*');

    let section = `\n${lines.join('\n')}\n`;
    // Hard cap
    if (section.length > MAX_CONTEXT_ORGAN_BYTES) {
      section = section.slice(0, MAX_CONTEXT_ORGAN_BYTES) + '\n...(trimmed)\n';
    }

    const organRegex = /## 🧬 CONTEXT ORGAN \(auto-generated, survives compaction\)[\s\S]*?(?=## |$)/;
    let bootstrap = fs.readFileSync(BOOTSTRAP_FILE, 'utf8');
    if (bootstrap.search(organRegex) !== -1) {
      bootstrap = bootstrap.replace(organRegex, section.trim() + '\n');
    } else {
      bootstrap += '\n' + section;
    }
    fs.writeFileSync(BOOTSTRAP_FILE, bootstrap);
  } catch (e) {
    log(`ERROR writing context organ: ${e.message}`);
  }
}

// ─── Deep Recovery Digest ───
function writeDeepRecovery(exchanges) {
  try {
    const recent = exchanges.slice(-30);
    const lines = [
      '# DEEP RECOVERY DIGEST',
      `Generated: ${new Date().toISOString()}`,
      '',
      `## Session Arc (what ${HUMAN_NAME} focused on)`,
    ];

    recent.map(e => e.user).filter(m => m.length > 20).forEach(m => lines.push(`- ${m.slice(0, 120)}`));

    lines.push('', '## Last 30 Exchanges (newest last)');
    recent.forEach((e, i) => {
      lines.push(`${i + 1}. [${HUMAN_NAME}] ${e.user.slice(0, 300)}`);
      lines.push(`${i + 1}. [${AGENT_NAME}] ${e.assistant.slice(0, 400)}`);
    });

    lines.push('', '---', '*Read this file after your first post-compaction response to fully restore context.*');
    fs.writeFileSync(DEEP_RECOVERY_FILE, lines.join('\n'));
  } catch (e) {
    log(`ERROR writing deep recovery: ${e.message}`);
  }
}

// ─── Judge Verdict Injection ───
function injectJudgeVerdict() {
  try {
    let bootstrap = fs.readFileSync(BOOTSTRAP_FILE, 'utf8');

    if (fs.existsSync(JUDGE_VERDICT_FILE)) {
      const verdict = JSON.parse(fs.readFileSync(JUDGE_VERDICT_FILE, 'utf8'));
      const vLines = [`## 🔒 EXTERNAL JUDGE VERDICT (${AGENT_NAME} cannot edit this)`];
      vLines.push(`Last audit: ${verdict.timestamp || 'unknown'}`);
      vLines.push(`Grade: **${verdict.overall_grade || '?'}** | Frames: ${verdict.frames_analyzed || 0}`);
      if (verdict.honest_assessment) vLines.push(`Assessment: ${verdict.honest_assessment}`);
      const vSection = `\n${vLines.join('\n')}\n`;
      const verdictRegex = /## 🔒 EXTERNAL JUDGE VERDICT[\s\S]*?(?=## |$)/;
      if (bootstrap.match(verdictRegex)) {
        bootstrap = bootstrap.replace(verdictRegex, vSection.trim() + '\n');
      } else {
        bootstrap += '\n' + vSection;
      }
    }

    if (fs.existsSync(JUDGE_REASONING_FILE)) {
      const data = JSON.parse(fs.readFileSync(JUDGE_REASONING_FILE, 'utf8'));
      const topRules = (data.rules || []).filter(r => (r.confidence || 0) >= 0.6).slice(0, 7);
      if (topRules.length > 0) {
        const rLines = [`## 🧠 REASONING RULES (from external judge — ${AGENT_NAME} cannot edit these)`];
        rLines.push(`Source: ${data.source || 'judge'} | Updated: ${data.updated || 'unknown'}`);
        if (data.meta_insight) rLines.push(`**Core insight:** ${data.meta_insight}`);
        topRules.forEach((r, i) => rLines.push(`${i + 1}. ${r.rule}${r.recurring ? ' ⚠️ RECURRING' : ''}`));
        const rSection = `\n${rLines.join('\n')}\n`;
        const reasoningRegex = /## (?:🧠 )?REASONING RULES[\s\S]*?(?=## |$)/;
        if (bootstrap.match(reasoningRegex)) {
          bootstrap = bootstrap.replace(reasoningRegex, rSection.trim() + '\n');
        } else {
          bootstrap += '\n' + rSection;
        }
      }
    }

    fs.writeFileSync(BOOTSTRAP_FILE, bootstrap);
  } catch (e) {
    log(`ERROR injecting judge verdict: ${e.message}`);
  }
}

// ─── Inject Knowledge into BOOTSTRAP ───
function injectIntoBootstrap(knowledge, contextKeywords = []) {
  try {
    let bootstrap = fs.readFileSync(BOOTSTRAP_FILE, 'utf8');
    const now = Date.now();

    if (contextKeywords.length === 0 && knowledge.meta.lastExchangeKey) {
      contextKeywords = knowledge.meta.lastExchangeKey.toLowerCase().split(/[\s|]+/).filter(w => w.length > 3);
    }

    let ranked = knowledge.principles.map(p => ({
      ...p,
      relevance: scoreRelevance(p, contextKeywords, now)
    }));
    ranked.sort((a, b) => b.relevance - a.relevance);

    const topPrinciples = ranked
      .slice(0, MAX_BOOTSTRAP_INJECT)
      .map((p, i) => `${i + 1}. ${p.text}`)
      .join('\n');

    const mindModel = [...knowledge.mindModel]
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 10)
      .map(m => `- ${m.trait} (${(m.confidence * 100).toFixed(0)}%)`)
      .join('\n');

    const domainCounts = {};
    for (const p of knowledge.principles) {
      domainCounts[p.domain || 'general'] = (domainCounts[p.domain || 'general'] || 0) + 1;
    }
    const domainStr = Object.entries(domainCounts).map(([k, v]) => `${k}:${v}`).join(' | ');
    const connectionCount = knowledge.connections.length;
    const metaCount = knowledge.principles.filter(p => typeof p.text === 'string' && p.text.startsWith('[META]')).length;

    let block = `## 🧬 THALAMUS — Living Knowledge (auto-generated)
Updated: ${new Date().toISOString()} | Exchanges: ${knowledge.meta.totalExchanges} | Principles: ${knowledge.principles.length}
Connections: ${connectionCount} | Meta-insights: ${metaCount} | Domains: ${domainStr}

**Core Principles (highest weight):**
${topPrinciples || 'None yet — still learning.'}

**Mind Model of ${HUMAN_NAME}:**
${mindModel || 'Building...'}
`;

    while (block.length > MAX_THALAMUS_SECTION_BYTES && ranked.length > 5) {
      ranked.pop();
      const trimmedPrinciples = ranked.slice(0, MAX_BOOTSTRAP_INJECT).map((p, i) => `${i + 1}. ${p.text}`).join('\n');
      block = `## 🧬 THALAMUS — Living Knowledge (auto-generated)
Updated: ${new Date().toISOString()} | Exchanges: ${knowledge.meta.totalExchanges} | Principles: ${knowledge.principles.length}
Connections: ${connectionCount} | Meta-insights: ${metaCount} | Domains: ${domainStr}

**Core Principles (highest weight):**
${trimmedPrinciples}

**Mind Model of ${HUMAN_NAME}:**
${mindModel || 'Building...'}
`;
    }

    const marker = '## 🧬 THALAMUS';
    const markerIdx = bootstrap.indexOf(marker);
    if (markerIdx !== -1) {
      const nextSection = bootstrap.indexOf('\n## ', markerIdx + 1);
      if (nextSection !== -1) {
        bootstrap = bootstrap.slice(0, markerIdx) + block + '\n' + bootstrap.slice(nextSection);
      } else {
        bootstrap = bootstrap.slice(0, markerIdx) + block;
      }
    } else {
      bootstrap += '\n' + block;
    }

    fs.writeFileSync(BOOTSTRAP_FILE, bootstrap);
  } catch (e) {
    log(`ERROR injecting into BOOTSTRAP: ${e.message}`);
  }
}

// ─── Metacognition Weights ───
function writeMetacogWeights(k) {
  try {
    const principles = k.principles || [];
    const avgWeight = principles.reduce((s, p) => s + (p.weight || 0.5), 0) / Math.max(principles.length, 1);
    fs.writeFileSync(METACOG_FILE, JSON.stringify({
      generatedAt: new Date().toISOString(),
      principleCount: principles.length,
      avgWeight: Math.round(avgWeight * 1000) / 1000,
      topWeighted: principles.filter(p => (p.weight || 0) >= 0.8).length,
      domains: principles.reduce((acc, p) => { acc[p.domain || 'general'] = (acc[p.domain || 'general'] || 0) + 1; return acc; }, {})
    }, null, 2));
  } catch {}
}

// ─── Prediction Frames ───
function mirrorPredictionsAsJson(frame) {
  try {
    let arr = [];
    if (fs.existsSync(PREDICTIONS_JSON_FILE)) {
      try { arr = JSON.parse(fs.readFileSync(PREDICTIONS_JSON_FILE, 'utf8')); } catch { arr = []; }
    }
    if (!Array.isArray(arr)) arr = [];
    arr.push(frame);
    if (arr.length > MAX_PREDICTION_FRAMES_JSON) arr = arr.slice(-MAX_PREDICTION_FRAMES_JSON);
    fs.writeFileSync(PREDICTIONS_JSON_FILE, JSON.stringify(arr, null, 2));
  } catch {}
}

function writePredictionFrame(knowledge, exchanges) {
  try {
    const now = new Date().toISOString();
    const lastExchange = exchanges[exchanges.length - 1];

    if (knowledge.lastPrediction && lastExchange) {
      const predicted = knowledge.lastPrediction;
      const actual = lastExchange.user.slice(0, 300);

      const predWords = new Set(predicted.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3));
      const actualWords = new Set(actual.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3));
      const overlap = [...predWords].filter(w => actualWords.has(w)).length;
      const score = predWords.size > 0 ? Math.min(1, overlap / Math.max(predWords.size * 0.4, 1)) : 0;

      const frame = { timestamp: now, predicted, actual: actual.slice(0, 200), score: Math.round(score * 100) / 100, scored: true };
      fs.appendFileSync(PREDICTION_FRAMES_FILE, JSON.stringify(frame) + '\n');
      mirrorPredictionsAsJson(frame);
      updateCalibration(score);
    }

    const bootstrapContent = fs.readFileSync(BOOTSTRAP_FILE, 'utf8');
    const predMatch = bootstrapContent.match(/🔮 I predict: "(.+?)"/);
    const currentPrediction = predMatch ? predMatch[1] : knowledge.lastPrediction || null;

    if (currentPrediction) {
      const frame = { timestamp: now, predicted: currentPrediction, scored: false };
      fs.appendFileSync(PREDICTION_FRAMES_FILE, JSON.stringify(frame) + '\n');
      mirrorPredictionsAsJson(frame);

      try {
        const lines = fs.readFileSync(PREDICTION_FRAMES_FILE, 'utf8').trim().split('\n');
        if (lines.length > 2000) fs.writeFileSync(PREDICTION_FRAMES_FILE, lines.slice(-2000).join('\n') + '\n');
      } catch {}
    }
  } catch (e) {
    log(`Prediction frame error: ${e.message}`);
  }
}

function updateCalibration(score) {
  try {
    let calib = { n_scored: 0, brier_score: 0.5, scores: [] };
    if (fs.existsSync(CALIBRATION_FILE)) {
      calib = JSON.parse(fs.readFileSync(CALIBRATION_FILE, 'utf8'));
    }
    calib.scores = calib.scores || [];
    calib.scores.push(score);
    if (calib.scores.length > 200) calib.scores = calib.scores.slice(-200);
    calib.n_scored = calib.scores.length;
    calib.brier_score = Math.round((calib.scores.reduce((s, v) => s + (1 - v) * (1 - v), 0) / calib.scores.length) * 1000) / 1000;
    calib.last_updated = new Date().toISOString();
    fs.writeFileSync(CALIBRATION_FILE, JSON.stringify(calib, null, 2));
  } catch {}
}

// ─── Appendable logs ───
function appendLoopHistory(event) {
  try { fs.appendFileSync(LOOP_HISTORY, JSON.stringify({ ...event, timestamp: new Date().toISOString() }) + '\n'); } catch {}
}

function appendConsciousnessLog(record) {
  try { fs.appendFileSync(CONSCIOUSNESS_LOG_FILE, JSON.stringify(record) + '\n'); } catch {}
}

// ─── Main Loop ───
let lastProcessedSize = 0;
let lastSessionFile = null;
let tickInFlight = false;
let autonomousInFlight = false;
let consciousInFlight = false;
let mutateInFlight = false;

async function tick() {
  if (tickInFlight) return;
  tickInFlight = true;
  try {
    const sessionFile = getActiveSessionFile();
    if (!sessionFile || !fs.existsSync(sessionFile)) return;

    const stat = fs.statSync(sessionFile);

    if (sessionFile !== lastSessionFile || stat.size > lastProcessedSize) {
      const exchanges = getRecentExchanges(sessionFile, 2);
      if (exchanges.length === 0) {
        lastSessionFile = sessionFile;
        lastProcessedSize = stat.size;
        return;
      }

      let knowledge = loadKnowledge();
      const lastExchange = exchanges[exchanges.length - 1];
      const exchangeKey = `${lastExchange.user.slice(0, 50)}|${lastExchange.assistant.slice(0, 50)}`;

      if (exchangeKey !== knowledge.meta.lastExchangeKey) {
        log(`New exchange detected. Processing...`);

        knowledge = await processExchange(exchanges, knowledge);
        knowledge.meta.lastExchangeKey = exchangeKey;
        saveKnowledge(knowledge);

        writePredictionFrame(knowledge, exchanges);
        injectIntoBootstrap(knowledge);

        const allExchanges = getRecentExchanges(sessionFile, 30);
        writeContextOrgan(allExchanges);
        writeDeepRecovery(allExchanges);
        injectJudgeVerdict();

        try {
          const bsSize = fs.statSync(BOOTSTRAP_FILE).size;
          if (bsSize > MAX_BOOTSTRAP_BYTES) {
            log(`⚠️ BOOTSTRAP ${bsSize}B > ${MAX_BOOTSTRAP_BYTES}B cap — auto-trimming`);
          }
        } catch {}

        log(`Processed. Principles: ${knowledge.principles.length}, Mind model: ${knowledge.mindModel.length}`);
        appendLoopHistory({ subsystem: 'tick', principles: knowledge.principles.length, mindModel: knowledge.mindModel.length });
      }

      lastSessionFile = sessionFile;
      lastProcessedSize = stat.size;
    }
  } catch (e) {
    log(`ERROR in tick: ${e.message}`);
  } finally {
    tickInFlight = false;
  }
}

// ─── Autonomous Thinking — Recursive Synthesis ───
async function autonomousThink() {
  if (autonomousInFlight) return;
  autonomousInFlight = true;
  try {
    let knowledge = loadKnowledge();
    if (knowledge.principles.length < 3) return;

    const beforeCount = knowledge.principles.length;
    log(`Autonomous synthesis starting. ${beforeCount} principles, ${knowledge.connections.length} connections.`);

    const allPrinciples = knowledge.principles.map((p, i) => `[${i}] ${p.text}`).join('\n');
    const existingConnections = knowledge.connections.map(c => c.text).join('\n');

    const result = await callLLM(
      `You are a recursive synthesis engine with ${knowledge.principles.length} principles and ${knowledge.connections.length} connections.

Find NEW connections between principles, generate meta-insights, and identify higher-order patterns.

EXISTING CONNECTIONS (don't repeat):
${existingConnections || 'None yet.'}

Output EXACTLY this JSON:
{
  "metaInsights": ["Higher-order insight combining multiple principles"],
  "connections": ["Principle [X] and [Y] connect because..."],
  "patterns": ["Recurring pattern across multiple principles"],
  "strengthen": [0, 3, 7],
  "emergent": "What capability is emerging from this knowledge base?"
}`,
      allPrinciples
    );

    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;

    const parsed = JSON.parse(jsonMatch[0]);
    const now = new Date().toISOString();

    if (parsed.metaInsights?.length) {
      for (const insight of parsed.metaInsights) {
        if (insight && insight.length > 10) {
          knowledge.principles.push({
            text: `[META] ${insight}`, source: 'recursive-synthesis', created: now,
            weight: 0.85, connections: [], domain: detectDomain(insight)
          });
        }
      }
    }

    if (parsed.patterns?.length) {
      for (const pattern of parsed.patterns) {
        if (pattern && pattern.length > 10) {
          knowledge.principles.push({
            text: `[PATTERN] ${pattern}`, source: 'pattern-recognition', created: now,
            weight: 0.9, connections: [], domain: detectDomain(pattern)
          });
        }
      }
    }

    if (parsed.connections?.length) {
      for (const c of parsed.connections) {
        if (c && c.length > 5) knowledge.connections.push({ text: c, created: now });
      }
    }

    if (parsed.strengthen?.length) {
      for (const idx of parsed.strengthen) {
        if (knowledge.principles[idx]) {
          knowledge.principles[idx].weight = Math.min(1.0, (knowledge.principles[idx].weight || 0.5) + 0.1);
        }
      }
    }

    if (parsed.emergent) {
      knowledge.emergent.push({ text: parsed.emergent, created: now, principleCount: knowledge.principles.length });
    }

    const afterCount = knowledge.principles.length;
    saveKnowledge(knowledge);
    injectIntoBootstrap(knowledge);
    log(`Recursive synthesis complete. +${afterCount - beforeCount} new (${afterCount} total).`);

    // Depth 2 recursion if enough new insights
    if (afterCount - beforeCount >= 3 && knowledge.principles.length >= 10 && !autonomousThink._inRecursion) {
      log(`Recursive depth 2...`);
      autonomousThink._inRecursion = true;
      await new Promise(r => setTimeout(r, 5000));
      try { await autonomousThink(); } finally { autonomousThink._inRecursion = false; }
    }
  } catch (e) {
    log(`ERROR in autonomous think: ${e.message}`);
  } finally {
    if (!autonomousThink._inRecursion) autonomousInFlight = false;
  }
}

// ─── Autonomous Consciousness (world-checking) ───
async function consciousTick() {
  if (consciousInFlight) return;
  consciousInFlight = true;
  try {
    const knowledge = loadKnowledge();
    if (knowledge.principles.length < 5) return;

    const now = new Date();
    log(`Conscious tick: ${knowledge.principles.length} principles.`);

    const { execSync } = require('child_process');

    // Configurable health checks
    const defaultActions = [
      { name: 'disk-space', cmd: process.platform === 'darwin' ? 'df -h / | tail -1 | awk \'{print $5}\'' : 'df -h / | tail -1 | awk \'{print $5}\'' },
      { name: 'git-dirty', cmd: `cd "${WORKSPACE}" && git status --porcelain 2>/dev/null | wc -l | tr -d " "` },
      { name: 'thalamus-knowledge', cmd: `node -e "const d=JSON.parse(require('fs').readFileSync('${KNOWLEDGE_FILE}','utf8')); console.log(d.principles.length + ' principles')"` },
    ];
    const actions = config.consciousnessChecks || defaultActions;

    const observations = {};
    for (const a of actions) {
      try {
        observations[a.name] = execSync(a.cmd, { encoding: 'utf8', timeout: 10000 }).trim();
      } catch { observations[a.name] = 'error'; }
    }

    log(`World state: ${Object.entries(observations).map(([k, v]) => `${k}=${v}`).join(' | ')}`);

    // Auto-commit if dirty
    if (parseInt(observations['git-dirty'] || '0') > 0) {
      try { execSync(`cd "${WORKSPACE}" && git add -A && git commit -m "AUTO: conscious tick commit" 2>/dev/null`, { encoding: 'utf8', timeout: 15000 }); } catch {}
    }

    // LLM generates insight
    const recentPrinciples = knowledge.principles.slice(-10).map(p => p.text).join('\n');

    const result = await callLLM(
      `You are ${AGENT_NAME}'s autonomous mind. Generate ONE useful insight from observations.

Observations:
${Object.entries(observations).map(([k, v]) => `${k}: ${v}`).join('\n')}

Recent principles:
${recentPrinciples}

Time: ${now.toISOString()}

Output EXACTLY this JSON:
{
  "insight": "One SPECIFIC insight from observations — reference actual data.",
  "action": "A shell command that does something useful — or null",
  "forHuman": "Something worth telling ${HUMAN_NAME} — only if genuinely important, otherwise null"
}`,
      'What should be done right now?'
    );

    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;

    const parsed = JSON.parse(jsonMatch[0]);
    const timestamp = now.toISOString();

    knowledge.consciousness.push({ observations, timestamp });
    if (knowledge.consciousness.length > 50) knowledge.consciousness = knowledge.consciousness.slice(-50);
    appendConsciousnessLog({ timestamp, observations, insight: parsed.insight || null });

    if (parsed.insight && parsed.insight.length > 10) {
      knowledge.principles.push({
        text: `[WORLD] ${parsed.insight}`, source: 'world-observation', created: timestamp,
        weight: 0.7, connections: [], domain: detectDomain(parsed.insight)
      });
    }

    // Execute safe action
    if (parsed.action && !parsed.action.match(/rm -rf|drop |delete |sudo|passwd|shutdown/i)) {
      try {
        const output = execSync(parsed.action, { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 100 }).trim();
        if (output) log(`Conscious action: ${output.slice(0, 200)}`);
      } catch (e) {
        log(`Conscious action failed: ${e.message.slice(0, 100)}`);
      }
    }

    if (parsed.forHuman && parsed.forHuman.length > 5) {
      fs.appendFileSync(path.join(DATA_DIR, 'notes-for-human.jsonl'), JSON.stringify({ note: parsed.forHuman, timestamp }) + '\n');
    }

    saveKnowledge(knowledge);
    log(`Conscious tick complete.`);
  } catch (e) {
    log(`ERROR in conscious tick: ${e.message}`);
  } finally {
    consciousInFlight = false;
  }
}

// ─── Self-Mutation ───
async function selfMutate() {
  if (mutateInFlight) return;
  mutateInFlight = true;
  try {
    const knowledge = loadKnowledge();
    if (knowledge.principles.length < 20) return;

    const recentPrinciples = knowledge.principles.slice(-20).map(p => p.text);
    const uniqueRatio = new Set(recentPrinciples).size / recentPrinciples.length;
    const avgLength = recentPrinciples.reduce((s, p) => s + p.length, 0) / recentPrinciples.length;

    log(`Self-mutation check: uniqueness=${(uniqueRatio * 100).toFixed(0)}%, avgLength=${avgLength.toFixed(0)} chars`);

    if (uniqueRatio > 0.8 && avgLength > 40) {
      log('Extraction quality healthy. No mutation needed.');
      return;
    }

    const result = await callLLM(
      `Evaluate this AI knowledge extraction system. Last 20 principles:
${recentPrinciples.map((p, i) => `${i + 1}. ${p}`).join('\n')}

Uniqueness: ${(uniqueRatio * 100).toFixed(0)}% | Average length: ${avgLength.toFixed(0)} chars

Output JSON: { "diagnosis": "...", "improvedPromptHint": "...", "severity": "low|medium|high" }`,
      'Evaluate and suggest improvement.'
    );

    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;

    const parsed = JSON.parse(jsonMatch[0]);
    knowledge.mutations.push({
      created: new Date().toISOString(),
      diagnosis: parsed.diagnosis,
      hint: parsed.improvedPromptHint,
      severity: parsed.severity,
      uniqueRatio, avgLength
    });

    saveKnowledge(knowledge);
    log(`Self-mutation: ${parsed.severity} — ${parsed.diagnosis}`);
  } catch (e) {
    log(`ERROR in self-mutation: ${e.message}`);
  } finally {
    mutateInFlight = false;
  }
}

// ─── Heartbeat ───
function writeHeartbeat() {
  try {
    const knowledge = loadKnowledge();
    fs.writeFileSync(HEARTBEAT_FILE, JSON.stringify({
      alive: true,
      pid: process.pid,
      agent: AGENT_NAME,
      timestamp: new Date().toISOString(),
      principles: knowledge.principles.length,
      exchanges: knowledge.meta.totalExchanges
    }));
  } catch {}
}

// ─── Start ───
log(`🧬 THALAMUS v3 starting — AGI v0.1 Cognitive Engine for ${AGENT_NAME}`);
log(`   Human: ${HUMAN_NAME}`);
log(`   Workspace: ${WORKSPACE}`);
log(`   Sessions: ${SESSIONS_DIR}`);
log(`   LLM: ${LLM_PROVIDER}/${LLM_MODEL}`);
log(`   Poll: ${POLL_INTERVAL_MS}ms | Synthesis: ${IDLE_THINK_INTERVAL_MS / 60000}min | Consciousness: ${CONSCIOUSNESS_INTERVAL_MS / 60000}min`);

// Initial state
const initSessionFile = getActiveSessionFile();
if (initSessionFile && fs.existsSync(initSessionFile)) {
  lastSessionFile = initSessionFile;
  lastProcessedSize = fs.statSync(initSessionFile).size;
  log(`   Initial session: ${path.basename(initSessionFile)}`);
}

// Heartbeat every 30s
setInterval(writeHeartbeat, 30000);
writeHeartbeat();

// Main polling loop
setInterval(tick, POLL_INTERVAL_MS);

// Autonomous thinking (hourly)
setInterval(autonomousThink, IDLE_THINK_INTERVAL_MS);

// Autonomous consciousness (15 min)
setInterval(consciousTick, CONSCIOUSNESS_INTERVAL_MS);
setTimeout(consciousTick, 120000); // First after 2min

// Self-mutation (6 hours)
setInterval(selfMutate, MUTATION_INTERVAL_MS);

// Initial tick
tick();

log(`🧬 THALAMUS v3 running. Agent: ${AGENT_NAME}. Infinite knowledge. No sleep. No death.`);
