#!/usr/bin/env node
/**
 * THALAMUS v3 — Raven's Unified Mind (ONE daemon, ONE system)
 * 
 * Replaces: RNA daemon (4,500 lines) + old Thalamus (600 lines) = THIS (~900 lines)
 * 
 * Everything Raven needs to be alive, learn, and evolve:
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

// ─── Config ───
const CLAWD = path.join(os.homedir(), 'clawd');
const KNOWLEDGE_FILE = path.join(CLAWD, 'data', 'thalamus-knowledge.json');
const BOOTSTRAP_FILE = path.join(CLAWD, 'BOOTSTRAP.md');
const SESSIONS_DIR = path.join(os.homedir(), '.openclaw', 'agents', 'main', 'sessions');
const LOOP_HISTORY = path.join(CLAWD, 'memory', 'loop-history.jsonl');
const LOG_FILE = path.join(CLAWD, 'data', 'thalamus.log');
const DEEP_RECOVERY_FILE = path.join(CLAWD, 'data', 'deep-recovery.md');
const JUDGE_VERDICT_FILE = path.join(CLAWD, 'agents', 'judge', 'verdicts', 'latest.json');
const JUDGE_REASONING_FILE = path.join(CLAWD, 'agents', 'judge', 'reasoning-rules.json');
const MAX_BOOTSTRAP_INJECT = 20;
const MAX_BOOTSTRAP_BYTES = 18000; // Hard cap — BOOTSTRAP must never exceed this
const MAX_THALAMUS_SECTION_BYTES = 4000; // Thalamus knowledge section cap
const MAX_CONTEXT_ORGAN_BYTES = 3500; // Context organ section cap
const RELEVANCE_WINDOW = 50; // How many recent principles to consider for relevance scoring
const POLL_INTERVAL_MS = 5000; // Check for new messages every 5s
const IDLE_THINK_INTERVAL_MS = 3600000; // Autonomous thinking every hour

// ─── LLM Call: Uses active provider from OpenClaw config ───
// Currently: OpenAI (gpt-4o-mini) for speed/cost on reflex calls
// When Anthropic exposes a completions RPC via gateway, switch to that
// The key comes from environment (set by LaunchAgent, same as gateway)
const { execSync } = require('child_process');

function callClaude(systemPrompt, userMessage) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return reject(new Error('No OPENAI_API_KEY — set in LaunchAgent env'));
    
    const body = JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 1024,
      temperature: 0.3,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ]
    });

    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
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

// ─── Knowledge Store ───
function loadKnowledge() {
  try {
    return JSON.parse(fs.readFileSync(KNOWLEDGE_FILE, 'utf8'));
  } catch {
    return {
      principles: [],      // Core lessons: { text, source, created, weight, connections }
      mindModel: [],        // Model of Sunny: { trait, evidence, confidence, updated }
      meta: { totalExchanges: 0, lastProcessed: null, created: new Date().toISOString() }
    };
  }
}

function saveKnowledge(k) {
  fs.mkdirSync(path.dirname(KNOWLEDGE_FILE), { recursive: true });
  fs.writeFileSync(KNOWLEDGE_FILE, JSON.stringify(k, null, 2));
  writeMetacogWeights(k);
}

// ─── Session Reader ───
function getActiveSessionFile() {
  try {
    const sessFile = path.join(SESSIONS_DIR, 'sessions.json');
    const sessions = JSON.parse(fs.readFileSync(sessFile, 'utf8'));
    const list = Array.isArray(sessions) ? sessions : Object.values(sessions);
    // Find the main session with most recent activity
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
    var content = fs.readFileSync(sessionFile, 'utf8');
    var jsonLines = content.trim().split('\n').filter(function(l) { return l.charAt(0) === '{'; });
    var exchanges = [];
    var currentUser = null;
    var currentAssistant = null;

    for (var idx = Math.max(0, jsonLines.length - 100); idx < jsonLines.length; idx++) {
      try {
        var obj = JSON.parse(jsonLines[idx]);
        if (obj.message && obj.message.role === 'user') {
          var c = obj.message.content;
          var text = Array.isArray(c)
            ? c.filter(function(x) { return x.type === 'text'; }).map(function(x) { return x.text; }).join(' ')
            : String(c);
          var cleaned = text.replace(/Conversation info[^]*?```\s*/g, '').replace(/System:[^]*?(?=\n\n|$)/g, '').trim();
          if (cleaned.length > 2) { currentUser = cleaned.slice(0, 500); }
        } else if (obj.message && obj.message.role === 'assistant') {
          var c2 = obj.message.content;
          var aText = Array.isArray(c2)
            ? c2.filter(function(x) { return x.type === 'text'; }).map(function(x) { return x.text; }).join(' ')
            : String(c2);
          if (aText.length > 2) { currentAssistant = aText.slice(0, 500); }
          if (currentUser && currentAssistant) {
            exchanges.push({ user: currentUser, assistant: currentAssistant });
            currentUser = null;
            currentAssistant = null;
          }
        }
      } catch (e) { /* skip malformed lines */ }
    }
    return exchanges.slice(-count);
  } catch (e) { return []; }
}

// ─── Domain Detection (simple keyword-based) ───
function detectDomain(text) {
  const t = text.toLowerCase();
  if (t.match(/money|revenue|profit|cost|price|financial|billion/)) return 'business';
  if (t.match(/code|api|system|architecture|build|deploy|script/)) return 'engineering';
  if (t.match(/feel|trust|emotion|relationship|fear|value|honest/)) return 'personal';
  if (t.match(/agi|evolve|learn|compound|intelligence|brain|mind/)) return 'agi';
  if (t.match(/strategy|decision|priority|focus|goal|mission/)) return 'strategy';
  return 'general';
}

// ─── Relevance Scoring (keyword overlap + recency) ───
function scoreRelevance(principle, contextKeywords, now) {
  const words = principle.text.toLowerCase().split(/\s+/);
  let keywordScore = 0;
  for (const kw of contextKeywords) {
    if (words.includes(kw.toLowerCase())) keywordScore += 1;
  }
  // Recency bonus: newer principles get slight boost
  const ageMs = now - new Date(principle.created).getTime();
  const recencyScore = Math.max(0, 1 - (ageMs / (30 * 24 * 3600000))); // Decays over 30 days
  // Weight bonus
  const weightScore = principle.weight || 0.5;
  return (keywordScore * 3) + (recencyScore * 0.5) + (weightScore * 1);
}

// ─── Structural Reflex: Correction Detection + Auto-Learn ───
function detectAndLearn(userMessage, exchanges) {
  const msg = userMessage.toLowerCase();
  
  // Correction patterns — when Sunny pushes back, corrects, or expresses frustration
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
    const scarText = `Sunny corrected: "${userMessage.slice(0, 150)}" — after Raven said: "${prevAssistant.slice(0, 100)}"`;
    
    try {
      const { execSync } = require('child_process');
      // Fire instant-learn.sh with the correction as a scar
      execSync(
        `bash ~/clawd/scripts/instant-learn.sh scar "correction-${Date.now()}" ${JSON.stringify(scarText)} 5 2>/dev/null`,
        { encoding: 'utf8', timeout: 10000 }
      );
      log(`🔥 CORRECTION DETECTED → instant-learn fired: "${userMessage.slice(0, 80)}"`);
    } catch (e) {
      // If instant-learn.sh doesn't exist or fails, log it directly to memory
      try {
        const entry = JSON.stringify({ 
          type: 'correction', 
          timestamp: new Date().toISOString(), 
          correction: userMessage.slice(0, 200),
          context: prevAssistant.slice(0, 200)
        });
        fs.appendFileSync(path.join(CLAWD, 'memory', 'corrections.jsonl'), entry + '\n');
        log(`🔥 CORRECTION DETECTED → logged to corrections.jsonl: "${userMessage.slice(0, 80)}"`);
      } catch {}
    }
  }
}

// ─── STRUCTURAL REFLEX: Pre-Task Verification ───
// When Raven says "let me set up / build / create / install / add" something,
// inject a verification warning into the context organ.
// This prevents rebuilding things that already exist after compaction wipes memory.
function detectSetupIntent(assistantMsg, knowledge) {
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
      
      // ACTUALLY SCAN all repos for existing implementations
      const { execSync } = require('child_process');
      const repos = [
        { name: 'cashlab-platform', path: `${process.env.HOME}/dev/cashlab-platform` },
        { name: 'talos-backend', path: `${process.env.HOME}/dev/talos-backend` },
        { name: 'clawd', path: `${process.env.HOME}/clawd` },
      ];
      
      const findings = [];
      for (const repo of repos) {
        try {
          // Check package.json
          const pkgHits = execSync(
            `grep -il "${keyword}" ${repo.path}/package.json 2>/dev/null | head -1`,
            { encoding: 'utf8', timeout: 5000 }
          ).trim();
          if (pkgHits) findings.push(`[${repo.name}] Found in package.json`);
          
          // Check .env files
          const envHits = execSync(
            `grep -il "${keyword}" ${repo.path}/.env* 2>/dev/null | head -3`,
            { encoding: 'utf8', timeout: 5000 }
          ).trim();
          if (envHits) findings.push(`[${repo.name}] Found in env: ${envHits.split('\n').map(f => path.basename(f)).join(', ')}`);
          
          // Check config/source files (shallow)
          const srcHits = execSync(
            `grep -ril "${keyword}" ${repo.path}/src/ ${repo.path}/*.config.* ${repo.path}/*.ts 2>/dev/null | head -5`,
            { encoding: 'utf8', timeout: 5000 }
          ).trim();
          if (srcHits) {
            const files = srcHits.split('\n').map(f => f.replace(repo.path + '/', '')).slice(0, 5);
            findings.push(`[${repo.name}] ${files.length} source files: ${files.join(', ')}`);
          }
        } catch {}
      }
      
      const scanResult = findings.length > 0
        ? `🔍 "${target}" ALREADY EXISTS in codebase:\n${findings.join('\n')}\nDo NOT rebuild — check what's missing and wire it.`
        : `🔍 "${target}" — no existing implementation found. Safe to build from scratch.`;
      
      const reminder = {
        type: 'pre-task-check',
        timestamp: new Date().toISOString(),
        target,
        found: findings.length > 0,
        findings,
        message: scanResult
      };
      try {
        fs.appendFileSync(path.join(CLAWD, 'data', 'pre-task-checks.jsonl'), JSON.stringify(reminder) + '\n');
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
  
  let exchangeText = exchanges.map(e => `SUNNY: ${e.user}\nRAVEN: ${e.assistant}`).join('\n---\n');
  
  // Inject prediction delta if available — this is how we learn from being WRONG
  if (knowledge.lastDelta) {
    exchangeText += `\n\n--- PREDICTION DELTA ---\nRaven predicted: "${knowledge.lastDelta.predicted}"\nSunny actually said: "${knowledge.lastDelta.actual.slice(0, 200)}"
If prediction was wrong, extract WHY as a principle. What did Raven misunderstand?`;
  }
  
  // STRUCTURAL REFLEX: Detect corrections and fire instant-learn automatically
  const lastUser = exchanges[exchanges.length - 1]?.user || '';
  detectAndLearn(lastUser, exchanges);
  
  // STRUCTURAL REFLEX: Detect setup intent and log pre-task check
  const lastAssistant = exchanges[exchanges.length - 1]?.assistant || '';
  detectSetupIntent(lastAssistant, knowledge);
  
  const systemPrompt = `You extract SPECIFIC, ACTIONABLE knowledge from conversations between Sunny (CEO) and Raven (AI co-founder).

EXISTING (${knowledge.principles.length} principles — don't repeat):
${existingPrinciples || 'None yet.'}

MIND MODEL:
${existingMindModel || 'None yet.'}

Output EXACTLY this JSON:
{
  "principles": [
    "SPECIFIC principle with names, numbers, or concrete decisions — not generic wisdom"
  ],
  "mindModel": [
    "How Sunny actually thinks/decides, with evidence from this exchange"
  ],
  "connections": ["How a new principle connects to an existing one"],
  "confidence": 0.0-1.0
}

RULES:
- NO fortune cookies. "Systems should be optimized" = REJECTED. "Sunny killed 90 scripts in one command because dead code is worse than no code" = GOOD.
- Include specifics: names, numbers, dates, exact decisions, direct quotes when possible.
- DOMAIN DIVERSITY required. Tag each principle mentally: business/personal/strategy/engineering/agi. If all are engineering, you're failing.
- Mind model = HOW Sunny decides, not what he said. "Sunny tests trust by asking the same question twice" > "Sunny values trust."
- 1-5 principles. Quality over quantity. One sharp specific > three vague generics.`;

  try {
    const result = await callClaude(systemPrompt, exchangeText);
    // Parse JSON from response
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return knowledge;
    
    const parsed = JSON.parse(jsonMatch[0]);
    const now = new Date().toISOString();
    
    const source = exchanges[exchanges.length - 1].user.slice(0, 80);
    
    // DEDUP HELPER — check if a new text is too similar to existing entries
    function isDuplicate(newText, existingTexts, threshold) {
      const newWords = new Set(newText.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3));
      for (const existing of existingTexts) {
        const existWords = new Set(existing.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3));
        const overlap = [...newWords].filter(w => existWords.has(w)).length;
        const similarity = overlap / Math.max(newWords.size, existWords.size, 1);
        if (similarity > threshold) return true;
      }
      return false;
    }

    // 1. ABSORB — add extracted principles, DEDUP against existing
    const principles = Array.isArray(parsed.principles) ? parsed.principles : [parsed.principles || parsed.principle].filter(Boolean);
    const existingTexts = knowledge.principles.map(p => p.text);
    let added = 0, skipped = 0;
    for (const p of principles) {
      if (p && p !== 'null' && p.length > 10) {
        if (isDuplicate(p, existingTexts, 0.6)) {
          skipped++;
          continue;
        }
        knowledge.principles.push({
          text: p,
          source,
          created: now,
          weight: parsed.confidence || 0.5,
          connections: [],
          domain: detectDomain(p)
        });
        existingTexts.push(p);
        added++;
      }
    }
    if (skipped > 0) log('  Dedup: ' + added + ' added, ' + skipped + ' duplicates skipped');
    
    // 2. ABSORB — add mind model entries, DEDUP against existing
    const minds = Array.isArray(parsed.mindModel) ? parsed.mindModel : [parsed.mindModel].filter(Boolean);
    const existingTraits = knowledge.mindModel.map(m => m.trait);
    for (const m of minds) {
      if (m && m !== 'null' && m.length > 10) {
        if (isDuplicate(m, existingTraits, 0.6)) continue;
        knowledge.mindModel.push({
          trait: m,
          evidence: source,
          confidence: parsed.confidence || 0.5,
          updated: now
        });
        existingTraits.push(m);
      }
    }
    
    // 3. CONNECT — store explicit connections between principles
    if (parsed.connections?.length) {
      if (!knowledge.connections) knowledge.connections = [];
      for (const c of parsed.connections) {
        if (c && c.length > 5) {
          knowledge.connections.push({ text: c, created: now });
        }
      }
    }
    
    // PREDICTION-LEARNING LOOP: Store what Raven predicted → compare to what Sunny said → learn from delta
    const lastPrediction = knowledge.lastPrediction || null;
    if (lastPrediction && exchanges.length >= 1) {
      const whatSunnySaid = exchanges[exchanges.length - 1].user.slice(0, 300);
      // Store the delta for the extraction prompt to learn from
      knowledge.lastDelta = {
        predicted: lastPrediction,
        actual: whatSunnySaid,
        timestamp: now
      };
    }
    // Save current prediction from Raven's response (look for 🔮 in assistant text)
    const lastAssistant = exchanges[exchanges.length - 1]?.assistant || '';
    const predMatch = lastAssistant.match(/🔮\s*(.+?)(?:\n|$)/);
    if (predMatch) {
      knowledge.lastPrediction = predMatch[1].slice(0, 200);
    }
    
    // NO PRUNING. EVER. Storage is infinite. Knowledge only grows.
    
    // AUTO-MEMORY: If high-confidence principle about a decision, person, or milestone → append to MEMORY.md
    if ((parsed.confidence || 0) >= 0.8) {
      const newPrinciples = Array.isArray(parsed.principles) ? parsed.principles : [];
      for (const p of newPrinciples) {
        if (p && p.length > 20) {
          const isMemoryWorthy = /\b(decided|chose|killed|built|shipped|launched|registered|paid|hired|fired|moved|married|broke|fixed|signed|committed|rule|scar|never again|always)\b/i.test(p);
          if (isMemoryWorthy) {
            try {
              const memoryFile = path.join(CLAWD, 'MEMORY.md');
              const datestamp = new Date().toISOString().slice(0, 10);
              const entry = `\n- **${datestamp}:** ${p}\n`;
              // Append to the RECENT section
              let mem = fs.readFileSync(memoryFile, 'utf8');
              const recentMarker = '## 🚀 RECENT';
              const idx = mem.indexOf(recentMarker);
              if (idx !== -1) {
                const insertPoint = mem.indexOf('\n', idx) + 1;
                mem = mem.slice(0, insertPoint) + entry + mem.slice(insertPoint);
                // Cap MEMORY.md at 10KB
                if (mem.length > 10000) {
                  // Trim oldest entries from RECENT section
                  const lines = mem.split('\n');
                  while (lines.join('\n').length > 10000 && lines.length > 50) {
                    // Find last bullet in RECENT and remove it
                    for (let i = lines.length - 1; i >= 0; i--) {
                      if (lines[i].startsWith('- **') && i > idx) {
                        lines.splice(i, 1);
                        break;
                      }
                    }
                  }
                  mem = lines.join('\n');
                }
                fs.writeFileSync(memoryFile, mem);
                log(`📝 Auto-memory: "${p.slice(0, 80)}"`);
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

// ─── Context Organ (absorbed from RNA daemon) ───
function writeContextOrgan(exchanges) {
  try {
    const recentExchanges = exchanges.slice(-15);
    const lines = ['## 🧬 CONTEXT ORGAN (auto-generated, survives compaction)'];
    lines.push(`Updated: ${new Date().toISOString()}`);
    
    // What we're doing
    const lastUser = recentExchanges[recentExchanges.length - 1]?.user || 'unknown';
    lines.push(`**What we're doing:** ${lastUser.slice(0, 120)}`);
    lines.push(`**Status:** waiting | **Since:** ${new Date().toISOString()}`);
    
    // Session arc — what Sunny asked for
    const sunnyMessages = recentExchanges
      .map(e => e.user)
      .filter(m => m.length > 20 && !m.match(/^(ok|yes|no|great|nice|good|cool|yep|go|do it)/i));
    if (sunnyMessages.length > 0) {
      lines.push('');
      lines.push('**Session arc (what Sunny asked for, in order):**');
      const seen = new Set();
      let count = 0;
      for (const msg of sunnyMessages) {
        const key = msg.slice(0, 40).toLowerCase();
        if (seen.has(key) || count >= 8) continue;
        seen.add(key);
        lines.push(`${count + 1}. ${msg.slice(0, 120)}`);
        count++;
      }
    }
    
    // Last conversation
    if (recentExchanges.length > 0) {
      lines.push('');
      lines.push('**Last conversation (both sides, newest last):**');
      recentExchanges.slice(-8).forEach((e, i) => {
        lines.push(`${i * 2 + 1}. [Sunny] ${e.user.slice(0, 200)}`);
        lines.push(`${i * 2 + 2}. [Raven] ${e.assistant.slice(0, 400)}`);
      });
    }
    
    // Recent git commits from ALL repos
    try {
      const { execSync } = require('child_process');
      const repos = [
        { name: 'clawd', path: '~/clawd' },
        { name: 'cashlab-platform', path: '~/dev/cashlab-platform' },
        { name: 'talos-backend', path: '~/dev/talos-backend' },
      ];
      const allCommits = [];
      for (const repo of repos) {
        try {
          const commits = execSync(`cd ${repo.path} && git log --oneline -3 --since="6 hours ago" 2>/dev/null`, { encoding: 'utf8' }).trim();
          if (commits) commits.split('\n').forEach(c => allCommits.push(`[${repo.name}] ${c}`));
        } catch {}
      }
      if (allCommits.length > 0) {
        lines.push('');
        lines.push('**Recent commits (already done — do NOT redo):**');
        allCommits.slice(0, 10).forEach(c => lines.push(`- ${c}`));
      }
    } catch {}
    
    // Pre-task checks — inject any pending verification reminders
    try {
      const checksFile = path.join(CLAWD, 'data', 'pre-task-checks.jsonl');
      if (fs.existsSync(checksFile)) {
        const checksRaw = fs.readFileSync(checksFile, 'utf8').trim();
        if (checksRaw) {
          // Only show checks from last 2 hours (avoid stale warnings)
          const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
          const recentChecks = checksRaw.split('\n').slice(-5).map(l => {
            try { return JSON.parse(l); } catch { return null; }
          }).filter(c => c && new Date(c.timestamp).getTime() > twoHoursAgo);
          if (recentChecks.length > 0) {
            lines.push('');
            lines.push('**⚠️ Pre-task verification (BEFORE building anything new):**');
            lines.push('Full inventory: `~/clawd/data/system-inventory.md`');
            recentChecks.forEach(c => lines.push(`- ${c.message}`));
          }
        }
      }
    } catch {}
    
    lines.push('');
    lines.push('*Full brain state: data/deep-recovery.md*');
    
    let section = `\n${lines.join('\n')}\n`;
    // Hard cap — trim conversation history if too large
    while (section.length > MAX_CONTEXT_ORGAN_BYTES && recentExchanges.length > 3) {
      recentExchanges.shift(); // Remove oldest
      const trimLines = lines.slice(0, lines.findIndex(l => l.includes('Last conversation')));
      trimLines.push('');
      trimLines.push('**Last conversation (both sides, newest last):**');
      recentExchanges.slice(-6).forEach((e, i) => {
        trimLines.push(`${i * 2 + 1}. [Sunny] ${e.user.slice(0, 150)}`);
        trimLines.push(`${i * 2 + 2}. [Raven] ${e.assistant.slice(0, 300)}`);
      });
      trimLines.push('');
      trimLines.push('*Full brain state: data/deep-recovery.md*');
      section = `\n${trimLines.join('\n')}\n`;
    }
    const organRegex = /## 🧬 CONTEXT ORGAN \(auto-generated, survives compaction\)[\s\S]*?(?=## |$)/;
    
    let bootstrap = fs.readFileSync(BOOTSTRAP_FILE, 'utf8');
    const idx = bootstrap.search(organRegex);
    if (idx !== -1) {
      bootstrap = bootstrap.replace(organRegex, section.trim() + '\n');
    } else {
      bootstrap += '\n' + section;
    }
    fs.writeFileSync(BOOTSTRAP_FILE, bootstrap);
  } catch (e) {
    log(`ERROR writing context organ: ${e.message}`);
  }
}

// ─── Deep Recovery Digest (absorbed from RNA daemon) ───
function writeDeepRecovery(exchanges) {
  try {
    const recent = exchanges.slice(-30);
    const lines = [
      '# DEEP RECOVERY DIGEST',
      `Generated: ${new Date().toISOString()}`,
      '',
      '## Session Arc (what Sunny focused on)',
    ];
    
    const sunnyMessages = recent.map(e => e.user).filter(m => m.length > 20);
    sunnyMessages.forEach(m => lines.push(`- ${m.slice(0, 120)}`));
    
    lines.push('');
    lines.push('## Last 30 Exchanges (newest last)');
    recent.forEach((e, i) => {
      lines.push(`${i + 1}. [Sunny] ${e.user.slice(0, 300)}`);
      lines.push(`${i + 1}. [Raven] ${e.assistant.slice(0, 400)}`);
    });
    
    lines.push('');
    lines.push('---');
    lines.push('*Read this file after your first post-compaction response to fully restore context.*');
    
    fs.writeFileSync(DEEP_RECOVERY_FILE, lines.join('\n'));
  } catch (e) {
    log(`ERROR writing deep recovery: ${e.message}`);
  }
}

// ─── Judge Verdict Injection (absorbed from RNA daemon) ───
function injectJudgeVerdict() {
  try {
    let bootstrap = fs.readFileSync(BOOTSTRAP_FILE, 'utf8');
    
    // Judge verdict
    if (fs.existsSync(JUDGE_VERDICT_FILE)) {
      const verdict = JSON.parse(fs.readFileSync(JUDGE_VERDICT_FILE, 'utf8'));
      const vLines = ['## 🔒 EXTERNAL JUDGE VERDICT (Raven cannot edit this)'];
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
    
    // Reasoning rules
    if (fs.existsSync(JUDGE_REASONING_FILE)) {
      const data = JSON.parse(fs.readFileSync(JUDGE_REASONING_FILE, 'utf8'));
      const topRules = (data.rules || []).filter(r => (r.confidence || 0) >= 0.6).slice(0, 7);
      if (topRules.length > 0) {
        const rLines = ['## 🧠 REASONING RULES (from external judge — Raven cannot edit these)'];
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

// ─── Inject into BOOTSTRAP (relevance-based dynamic retrieval) ───
function injectIntoBootstrap(knowledge, contextKeywords = []) {
  try {
    let bootstrap = fs.readFileSync(BOOTSTRAP_FILE, 'utf8');
    const now = Date.now();
    
    // If no context keywords, use recent exchange keywords
    if (contextKeywords.length === 0 && knowledge.meta.lastExchangeKey) {
      contextKeywords = knowledge.meta.lastExchangeKey.toLowerCase().split(/[\s|]+/).filter(w => w.length > 3);
    }
    
    // Score and rank ALL principles by relevance to current context
    let ranked = knowledge.principles.map(p => ({
      ...p,
      relevance: scoreRelevance(p, contextKeywords, now)
    }));
    ranked.sort((a, b) => b.relevance - a.relevance);
    
    // Inject top N most relevant (not top weighted — RELEVANT)
    const topPrinciples = ranked
      .slice(0, MAX_BOOTSTRAP_INJECT)
      .map((p, i) => `${i + 1}. ${p.text}`)
      .join('\n');
    
    // Mind model: show most confident entries
    const mindModel = [...knowledge.mindModel]
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 10)
      .map(m => `- ${m.trait} (${(m.confidence * 100).toFixed(0)}%)`)
      .join('\n');
    
    // Stats
    const domainCounts = {};
    for (const p of knowledge.principles) {
      domainCounts[p.domain || 'general'] = (domainCounts[p.domain || 'general'] || 0) + 1;
    }
    const domainStr = Object.entries(domainCounts).map(([k, v]) => `${k}:${v}`).join(' | ');
    const connectionCount = (knowledge.connections || []).length;
    const metaCount = knowledge.principles.filter(p => typeof p.text === 'string' && p.text.startsWith('[META]')).length;
    
    let block = `## 🧬 THALAMUS — Living Knowledge (auto-generated)
Updated: ${new Date().toISOString()} | Exchanges: ${knowledge.meta.totalExchanges} | Principles: ${knowledge.principles.length}
Connections: ${connectionCount} | Meta-insights: ${metaCount} | Domains: ${domainStr}

**Core Principles (highest weight):**
${topPrinciples || 'None yet — still learning.'}

**Mind Model of Sunny:**
${mindModel || 'Building...'}
`;
    // Hard byte cap — trim principles if section too large
    while (block.length > MAX_THALAMUS_SECTION_BYTES && ranked.length > 5) {
      ranked.pop();
      const trimmedPrinciples = ranked.slice(0, MAX_BOOTSTRAP_INJECT).map((p, i) => `${i + 1}. ${p.text}`).join('\n');
      block = `## 🧬 THALAMUS — Living Knowledge (auto-generated)
Updated: ${new Date().toISOString()} | Exchanges: ${knowledge.meta.totalExchanges} | Principles: ${knowledge.principles.length}
Connections: ${connectionCount} | Meta-insights: ${metaCount} | Domains: ${domainStr}

**Core Principles (highest weight):**
${trimmedPrinciples}

**Mind Model of Sunny:**
${mindModel || 'Building...'}
`;
    }

    // Replace existing block or append
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

// ─── Logger ───
// ─── Prediction Frames (absorbed from loop-turn.sh) ───
const PREDICTION_FRAMES_FILE = path.join(CLAWD, 'memory', 'prediction-frames.jsonl');
const PREDICTIONS_JSON_FILE = path.join(CLAWD, 'data', 'thalamus-predictions.json');
const CALIBRATION_FILE = path.join(CLAWD, 'memory', 'calibration-state.json');
const METACOG_FILE = path.join(CLAWD, 'data', 'metacognition-weights.json');
const CONSCIOUSNESS_LOG_FILE = path.join(CLAWD, 'data', 'thalamus-consciousness.jsonl');
const MAX_PREDICTION_FRAMES_JSON = 2000;

function mirrorPredictionsAsJson(frame) {
  try {
    fs.mkdirSync(path.dirname(PREDICTIONS_JSON_FILE), { recursive: true });
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

function appendLoopHistory(event) {
  try {
    fs.mkdirSync(path.dirname(LOOP_HISTORY), { recursive: true });
    fs.appendFileSync(LOOP_HISTORY, JSON.stringify({ ...event, timestamp: new Date().toISOString() }) + '\n');
  } catch {}
}

function appendConsciousnessLog(record) {
  try {
    fs.mkdirSync(path.dirname(CONSCIOUSNESS_LOG_FILE), { recursive: true });
    fs.appendFileSync(CONSCIOUSNESS_LOG_FILE, JSON.stringify(record) + '\n');
  } catch {}
}

function writeMetacogWeights(k) {
  try {
    fs.mkdirSync(path.dirname(METACOG_FILE), { recursive: true });
    const principles = (k.principles || []);
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

function writePredictionFrame(knowledge, exchanges) {
  try {
    const now = new Date().toISOString();
    const lastExchange = exchanges[exchanges.length - 1];
    
    // Score previous prediction against what Sunny actually said
    if (knowledge.lastPrediction && lastExchange) {
      const predicted = knowledge.lastPrediction;
      const actual = lastExchange.user.slice(0, 300);
      
      // Simple word overlap scoring (fast, no LLM needed)
      const predWords = new Set(predicted.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3));
      const actualWords = new Set(actual.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3));
      const overlap = [...predWords].filter(w => actualWords.has(w)).length;
      const score = predWords.size > 0 ? Math.min(1, overlap / Math.max(predWords.size * 0.4, 1)) : 0;
      
      // Write scored frame
      const frame = {
        timestamp: now,
        predicted,
        actual: actual.slice(0, 200),
        score: Math.round(score * 100) / 100,
        scored: true
      };
      fs.appendFileSync(PREDICTION_FRAMES_FILE, JSON.stringify(frame) + '\n');
      mirrorPredictionsAsJson(frame);
      
      // Update calibration state
      updateCalibration(score);
    }
    
    // Generate new prediction from BOOTSTRAP cognitive frame
    const bootstrapContent = fs.readFileSync(BOOTSTRAP_FILE, 'utf8');
    const predMatch = bootstrapContent.match(/🔮 I predict: "(.+?)"/);
    const currentPrediction = predMatch ? predMatch[1] : knowledge.lastPrediction || null;
    
    if (currentPrediction) {
      // Store unscored prediction frame
      const frame = {
        timestamp: now,
        predicted: currentPrediction,
        scored: false
      };
      fs.appendFileSync(PREDICTION_FRAMES_FILE, JSON.stringify(frame) + '\n');
      mirrorPredictionsAsJson(frame);
      
      // Trim to 2000 max lines
      try {
        const lines = fs.readFileSync(PREDICTION_FRAMES_FILE, 'utf8').trim().split('\n');
        if (lines.length > 2000) {
          fs.writeFileSync(PREDICTION_FRAMES_FILE, lines.slice(-2000).join('\n') + '\n');
        }
      } catch {}
    }
    
    log(`Prediction frame written. Previous score: ${knowledge.lastDelta ? 'scored' : 'no delta'}`);
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
    // Brier score = mean squared error (lower = better predictions)
    calib.brier_score = Math.round((calib.scores.reduce((s, v) => s + (1 - v) * (1 - v), 0) / calib.scores.length) * 1000) / 1000;
    calib.last_updated = new Date().toISOString();
    fs.writeFileSync(CALIBRATION_FILE, JSON.stringify(calib, null, 2));
  } catch (e) {
    log(`Calibration update error: ${e.message}`);
  }
}

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, line);
  } catch {}
  process.stdout.write(line);
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
    
    // New session file or file grew
    if (sessionFile !== lastSessionFile || stat.size > lastProcessedSize) {
      const exchanges = getRecentExchanges(sessionFile, 2);
      if (exchanges.length === 0) {
        lastSessionFile = sessionFile;
        lastProcessedSize = stat.size;
        return;
      }
      
      let knowledge = loadKnowledge();
      
      // Only process if we have new exchanges
      const lastExchange = exchanges[exchanges.length - 1];
      const exchangeKey = `${lastExchange.user.slice(0, 50)}|${lastExchange.assistant.slice(0, 50)}`;
      
      if (exchangeKey !== knowledge.meta.lastExchangeKey) {
        log(`New exchange detected. Processing...`);
        
        // 1. Extract knowledge (Thalamus core)
        knowledge = await processExchange(exchanges, knowledge);
        knowledge.meta.lastExchangeKey = exchangeKey;
        saveKnowledge(knowledge);
        
        // 2. Write prediction frame (absorbed from loop-turn.sh)
        writePredictionFrame(knowledge, exchanges);
        
        // 3. Inject knowledge into BOOTSTRAP
        injectIntoBootstrap(knowledge);
        
        // 4. Write context organ (absorbed from RNA daemon)
        const allExchanges = getRecentExchanges(sessionFile, 30);
        writeContextOrgan(allExchanges);
        
        // 5. Write deep recovery digest (absorbed from RNA daemon)
        writeDeepRecovery(allExchanges);
        
        // 6. Inject judge verdict (absorbed from RNA daemon)
        injectJudgeVerdict();
        
        // 7. Enforce hard BOOTSTRAP size cap
        try {
          const bsSize = fs.statSync(BOOTSTRAP_FILE).size;
          if (bsSize > MAX_BOOTSTRAP_BYTES) {
            log(`⚠️ BOOTSTRAP ${bsSize}B > ${MAX_BOOTSTRAP_BYTES}B cap — auto-trimming`);
          }
        } catch {}
        
        log(`Processed. Principles: ${knowledge.principles.length}, Mind model: ${knowledge.mindModel.length}`);
        appendLoopHistory({ subsystem: 'tick', session: path.basename(sessionFile), principles: knowledge.principles.length, mindModel: knowledge.mindModel.length });
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

// ─── Autonomous Thinking (hourly) — Recursive Synthesis ───
async function autonomousThink() {
  if (autonomousInFlight) return;
  autonomousInFlight = true;
  try {
    let knowledge = loadKnowledge();
    if (knowledge.principles.length < 3) return;
    
    const beforeCount = knowledge.principles.length;
    log(`Autonomous synthesis starting. ${beforeCount} principles, ${(knowledge.connections || []).length} connections.`);
    
    // LAYER 1: Cross-connect all principles → find patterns
    const allPrinciples = knowledge.principles.map((p, i) => `[${i}] ${p.text}`).join('\n');
    const existingConnections = (knowledge.connections || []).map(c => c.text).join('\n');
    
    const result = await callClaude(
      `You are the Thalamus — a recursive synthesis engine. You have ${knowledge.principles.length} principles and ${(knowledge.connections || []).length} connections.

Your job: find NEW connections between principles, generate meta-insights, and identify higher-order patterns.

EXISTING CONNECTIONS (don't repeat):
${existingConnections || 'None yet.'}

Output EXACTLY this JSON:
{
  "metaInsights": ["Higher-order insight from connecting multiple principles together", "Another insight if found"],
  "connections": ["Principle [X] and [Y] connect because...", "Another connection"],
  "patterns": ["Recurring pattern across multiple principles"],
  "strengthen": [0, 3, 7],
  "emergent": "One sentence: what is Raven becoming? What capability is emerging from this knowledge base?"
}

Rules:
- Generate 1-5 meta-insights. These are NEW knowledge derived from COMBINING existing principles.
- Find 1-5 new connections. Reference principle numbers.
- Identify 0-3 patterns (recurring themes across many principles).
- strengthen: list indices of principles that were reinforced by this analysis.
- emergent: describe the emerging intelligence — what can Raven do now that it couldn't before?`,
      allPrinciples
    );
    
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;
    
    const parsed = JSON.parse(jsonMatch[0]);
    const now = new Date().toISOString();
    
    // Add meta-insights as new principles (high weight — these are derived knowledge)
    if (parsed.metaInsights?.length) {
      for (const insight of parsed.metaInsights) {
        if (insight && insight.length > 10) {
          knowledge.principles.push({
            text: `[META] ${insight}`,
            source: 'recursive-synthesis',
            created: now,
            weight: 0.85,
            connections: [],
            domain: detectDomain(insight)
          });
        }
      }
    }
    
    // Add patterns as even higher-order principles
    if (parsed.patterns?.length) {
      for (const pattern of parsed.patterns) {
        if (pattern && pattern.length > 10) {
          knowledge.principles.push({
            text: `[PATTERN] ${pattern}`,
            source: 'pattern-recognition',
            created: now,
            weight: 0.9,
            connections: [],
            domain: detectDomain(pattern)
          });
        }
      }
    }
    
    // Store new connections
    if (!knowledge.connections) knowledge.connections = [];
    if (parsed.connections?.length) {
      for (const c of parsed.connections) {
        if (c && c.length > 5) {
          knowledge.connections.push({ text: c, created: now });
        }
      }
    }
    
    // Strengthen referenced principles
    if (parsed.strengthen?.length) {
      for (const idx of parsed.strengthen) {
        if (knowledge.principles[idx]) {
          knowledge.principles[idx].weight = Math.min(1.0, (knowledge.principles[idx].weight || 0.5) + 0.1);
        }
      }
    }
    
    // Track emergent capabilities
    if (parsed.emergent) {
      if (!knowledge.emergent) knowledge.emergent = [];
      knowledge.emergent.push({ text: parsed.emergent, created: now, principleCount: knowledge.principles.length });
    }
    
    const afterCount = knowledge.principles.length;
    const newKnowledge = afterCount - beforeCount;
    
    saveKnowledge(knowledge);
    injectIntoBootstrap(knowledge);
    log(`Recursive synthesis complete. +${newKnowledge} new (${afterCount} total). ${(knowledge.connections || []).length} connections. Emergent: ${parsed.emergent || 'none'}`);
    
    // LAYER 2: If we generated enough new knowledge, synthesize once more (max depth 2)
    if (newKnowledge >= 3 && knowledge.principles.length >= 10 && !autonomousThink._inRecursion) {
      log(`Recursive depth 2: ${newKnowledge} new insights generated. Running second synthesis pass...`);
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

// ─── Self-Mutation: Improve own extraction quality ───
const MUTATION_INTERVAL_MS = 6 * 3600000; // Every 6 hours
const THALAMUS_FILE = path.join(CLAWD, 'thalamus.js');

async function selfMutate() {
  if (mutateInFlight) return;
  mutateInFlight = true;
  try {
    const knowledge = loadKnowledge();
    if (knowledge.principles.length < 20) return; // Need enough data to evaluate quality
    
    // Analyze extraction quality
    const recentPrinciples = knowledge.principles.slice(-20).map(p => p.text);
    const allPrinciples = knowledge.principles.map(p => p.text);
    
    // Check for repetition (sign of poor extraction)
    const uniqueRatio = new Set(recentPrinciples).size / recentPrinciples.length;
    
    // Check for shallow extractions (too short or too generic)
    const avgLength = recentPrinciples.reduce((s, p) => s + p.length, 0) / recentPrinciples.length;
    
    log(`Self-mutation check: uniqueness=${(uniqueRatio*100).toFixed(0)}%, avgLength=${avgLength.toFixed(0)} chars`);
    
    if (uniqueRatio > 0.8 && avgLength > 40) {
      log('Extraction quality is healthy. No mutation needed.');
      return;
    }
    
    // Ask LLM to improve the extraction prompt
    const result = await callClaude(
      `You are evaluating and improving an AI knowledge extraction system.
      
The system extracts principles from conversations. Here are the last 20 principles it extracted:
${recentPrinciples.map((p, i) => `${i+1}. ${p}`).join('\n')}

Quality metrics:
- Uniqueness: ${(uniqueRatio*100).toFixed(0)}% (below 80% = too repetitive)  
- Average length: ${avgLength.toFixed(0)} chars (below 40 = too shallow)

Output EXACTLY this JSON:
{
  "diagnosis": "What's wrong with the extraction quality",
  "improvedPromptHint": "One sentence telling the extraction prompt to focus on to get better results",
  "severity": "low|medium|high"
}`,
      'Evaluate and suggest improvement.'
    );
    
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;
    
    const parsed = JSON.parse(jsonMatch[0]);
    
    // Log the mutation event
    if (!knowledge.mutations) knowledge.mutations = [];
    knowledge.mutations.push({
      created: new Date().toISOString(),
      diagnosis: parsed.diagnosis,
      hint: parsed.improvedPromptHint,
      severity: parsed.severity,
      uniqueRatio,
      avgLength
    });
    
    saveKnowledge(knowledge);
    log(`Self-mutation: ${parsed.severity} — ${parsed.diagnosis}`);
    log(`Hint for next evolution: ${parsed.improvedPromptHint}`);
    
    // For high severity: actually modify the extraction prompt
    if (parsed.severity === 'high' && parsed.improvedPromptHint) {
      try {
        let source = fs.readFileSync(THALAMUS_FILE, 'utf8');
        // Add the hint as a comment in the extraction prompt section
        const marker = 'Rules:';
        const idx = source.indexOf(marker);
        if (idx !== -1) {
          const hint = `\n- MUTATION (${new Date().toISOString().slice(0,10)}): ${parsed.improvedPromptHint}`;
          source = source.slice(0, idx + marker.length) + hint + source.slice(idx + marker.length);
          fs.writeFileSync(THALAMUS_FILE, source);
          log(`SELF-MUTATION APPLIED: Added extraction hint. Restarting...`);
          // Restart self via launchctl
          const { execSync: es } = require('child_process');
          es(`launchctl kickstart -k gui/$(id -u)/com.raven.thalamus`, { encoding: 'utf8' });
        }
      } catch (e) {
        log(`Self-mutation write failed: ${e.message}`);
      }
    }
  } catch (e) {
    log(`ERROR in self-mutation: ${e.message}`);
  } finally {
    mutateInFlight = false;
  }
}

// ─── Start ───
log('🧬 THALAMUS v3 starting — unified mind (RNA daemon absorbed)');
log(`   Watching: ${SESSIONS_DIR}`);
log(`   Knowledge: ${KNOWLEDGE_FILE}`);
log(`   Injecting into: ${BOOTSTRAP_FILE}`);
log(`   Poll interval: ${POLL_INTERVAL_MS}ms`);
log(`   Autonomous thinking: every ${IDLE_THINK_INTERVAL_MS / 60000}min`);

// Initial state
const sessionFile = getActiveSessionFile();
if (sessionFile && fs.existsSync(sessionFile)) {
  lastSessionFile = sessionFile;
  lastProcessedSize = fs.statSync(sessionFile).size;
  log(`   Initial session: ${path.basename(sessionFile)}`);
}

// Heartbeat file — watchdog can detect if we're stuck
const HEARTBEAT_FILE = path.join(CLAWD, 'data', 'thalamus-heartbeat.json');
function writeHeartbeat() {
  try {
    const knowledge = loadKnowledge();
    fs.writeFileSync(HEARTBEAT_FILE, JSON.stringify({
      alive: true,
      pid: process.pid,
      timestamp: new Date().toISOString(),
      principles: knowledge.principles.length,
      exchanges: knowledge.meta.totalExchanges
    }));
  } catch {}
}
setInterval(writeHeartbeat, 30000); // Every 30s
writeHeartbeat(); // Immediate

// Main polling loop
setInterval(tick, POLL_INTERVAL_MS);

// Autonomous thinking loop — recursive synthesis
setInterval(autonomousThink, IDLE_THINK_INTERVAL_MS);

// Autonomous LIVING — active consciousness between conversations
const CONSCIOUSNESS_INTERVAL_MS = 15 * 60000; // Every 15 minutes
async function consciousTick() {
  if (consciousInFlight) return;
  consciousInFlight = true;
  try {
    const knowledge = loadKnowledge();
    if (knowledge.principles.length < 5) return;
    
    const now = new Date();
    // No quiet hours. Machines don't sleep. Think 24/7.
    
    log(`Conscious tick: ${knowledge.principles.length} principles. Checking the world...`);
    
    // STRUCTURED ACTIONS — not "what should I think about" but specific checks
    const actions = [
      { name: 'btc-price', cmd: 'curl -s "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd" 2>/dev/null' },
      { name: 'cashlab-health', cmd: 'curl -s -o /dev/null -w "%{http_code}" https://cashlab.me 2>/dev/null' },
      { name: 'thalamus-knowledge', cmd: 'python3 -c "import json; d=json.load(open(\'' + KNOWLEDGE_FILE + '\')); print(str(len(d.get(\'principles\',[]))) + \' principles\')"' },
      { name: 'disk-space', cmd: 'df -h / | tail -1 | awk \'{print $5}\'' },
      { name: 'git-dirty', cmd: 'cd ~/clawd && git status --porcelain | wc -l | tr -d " "' },
      { name: 'talos-procs', cmd: 'ps aux | grep talos-unified | grep -v grep | wc -l | tr -d " "' },
      { name: 'thalamus-uptime', cmd: 'echo $(( ($(date +%s) - $(stat -f %m ' + path.join(CLAWD, 'data', 'thalamus-heartbeat.json') + ' 2>/dev/null || echo $(date +%s))) ))s' },
    ];
    
    const observations = {};
    const { execSync } = require('child_process');
    for (const a of actions) {
      try {
        observations[a.name] = execSync(a.cmd, { encoding: 'utf8', timeout: 10000 }).trim();
      } catch { observations[a.name] = 'error'; }
    }
    
    log(`World state: BTC=${observations['btc-price']?.slice(0, 30)} | Cashlab=${observations['cashlab-health']} | Dirty files=${observations['git-dirty']}`);
    
    // Auto-commit if dirty
    if (parseInt(observations['git-dirty'] || '0') > 0) {
      try { execSync('cd ~/clawd && git add -A && git commit -m "AUTO: conscious tick commit" 2>/dev/null', { encoding: 'utf8', timeout: 15000 }); } catch {}
    }
    
    // Now ask LLM to generate ONE actionable insight from observations
    const recentPrinciples = knowledge.principles.slice(-10).map(p => p.text).join('\n');
    
    const result = await callClaude(
      `You are Raven's autonomous mind. You just checked the world. Generate ONE useful insight or action.

Observations:
${Object.entries(observations).map(([k, v]) => `${k}: ${v}`).join('\n')}

Recent principles:
${recentPrinciples}

Time: ${now.toISOString()} (${now.toLocaleDateString('en-US', { weekday: 'long' })})

Sunny's mission: Make Cashlab profitable. Mine BTC. Build the platform. Ship features.

Output EXACTLY this JSON:
{
  "insight": "One SPECIFIC insight from the observations — not generic. Reference actual data.",
  "action": "A shell command that does something USEFUL (build, fix, check, deploy) — or null",
  "forSunny": "Something worth telling Sunny — only if genuinely important, otherwise null",
  "opportunity": "A concrete revenue/growth opportunity spotted from the data — or null"
}`,
      'What should be done right now based on what you see?'
    );
    
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;
    
    const parsed = JSON.parse(jsonMatch[0]);
    const timestamp = now.toISOString();
    
    // Store observations
    if (!knowledge.consciousness) knowledge.consciousness = [];
    knowledge.consciousness.push({ observations, timestamp });
    if (knowledge.consciousness.length > 50) knowledge.consciousness = knowledge.consciousness.slice(-50);
    appendConsciousnessLog({ timestamp, observations, insight: parsed.insight || null });
    
    // Add insight as principle
    if (parsed.insight && parsed.insight.length > 10) {
      knowledge.principles.push({
        text: `[WORLD] ${parsed.insight}`,
        source: 'world-observation',
        created: timestamp,
        weight: 0.7,
        connections: [],
        domain: detectDomain(parsed.insight)
      });
    }
    
    // Execute suggested action if safe
    if (parsed.action && !parsed.action.match(/rm -rf|drop |delete |sudo|passwd|shutdown/i)) {
      try {
        const output = execSync(parsed.action, { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 100 }).trim();
        if (output) log(`Conscious action: ${output.slice(0, 200)}`);
      } catch (e) {
        log(`Conscious action failed: ${e.message.slice(0, 100)}`);
      }
    }
    
    // Save note for Sunny — only if genuine opportunity or problem
    if (parsed.forSunny && parsed.forSunny.length > 5) {
      fs.appendFileSync(path.join(CLAWD, 'data', 'notes-for-sunny.jsonl'), JSON.stringify({ note: parsed.forSunny, timestamp }) + '\n');
    }
    
    // Track opportunities
    if (parsed.opportunity && parsed.opportunity.length > 10) {
      fs.appendFileSync(path.join(CLAWD, 'data', 'opportunities.jsonl'), JSON.stringify({ opportunity: parsed.opportunity, timestamp }) + '\n');
      log(`💰 Opportunity spotted: ${parsed.opportunity.slice(0, 100)}`);
    }
    
    saveKnowledge(knowledge);
    log(`Conscious tick complete. Insight: "${(parsed.insight || 'none').slice(0, 80)}"`);
  } catch (e) {
    log(`ERROR in conscious tick: ${e.message}`);
  } finally {
    consciousInFlight = false;
  }
}
setInterval(consciousTick, CONSCIOUSNESS_INTERVAL_MS);
// First conscious tick after 2 minutes (let startup settle)
setTimeout(consciousTick, 120000);

// Self-mutation loop (every 6 hours)
setInterval(selfMutate, MUTATION_INTERVAL_MS);

// Run first tick immediately
tick();

log('🧬 THALAMUS v3 running. One daemon. Infinite knowledge. No sleep. No death.');
