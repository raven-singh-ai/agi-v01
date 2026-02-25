#!/usr/bin/env node
// Extract ALL corrections from ALL session history
// Builds a corrections database the diagnosis engine uses

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const SESSIONS_DIR = path.join(process.env.HOME, '.openclaw', 'agents', 'main', 'sessions');
const OUTPUT = path.join(process.env.HOME, 'clawd', 'agents', 'judge', 'corrections-db.json');

// Correction signal patterns — comprehensive detection
const CORRECTION_PATTERNS = [
  // Direct corrections
  /\bbro\b/i,
  /\bwait\b/i,
  /that's not/i,
  /\bwrong\b/i,
  /get yourself back/i,
  /how comes/i,
  /i told you/i,
  /still not/i,
  /didn't work/i,
  /not what i/i,
  /you (said|told|claimed)/i,
  /check again/i,
  /\bnope\b/i,
  /that's wrong/i,
  /you forgot/i,
  /you missed/i,
  /not correct/i,
  /try again/i,
  /you're (wrong|missing)/i,
  /should(n't| not) have/i,
  /why did you/i,
  /don't (ask|report|tell)/i,
  /i already/i,
  /we already/i,
  /you already/i,
  /no[,.]? (that|it|this)/i,
  /but (i|we|you) (said|did|have)/i,
  // Subtle signals (more specific to avoid false positives)
  /^\s*fix\s*$/i,                    // "Fix" alone = correction, not "I'll fix that"
  /not (really|exactly|quite) what/i, // Needs "what" to be a correction
  /what (do you mean|are you talking)/i,
  /that doesn't (work|make sense|look)/i,
  /where (did|are) you (check|look)/i,
  /are you sure/i,
  /did you (even|actually) (read|check|look|test)/i,
  /come on\b/i,
  /too (much|long|many) (detail|text|info)/i,
  /\bshorter\b/i,
  /\bsimpler\b/i,
  /just (do|tell|give|show) me/i,
  /stop (asking|talking|reporting)/i,
  /not the (point|question|issue)/i,
  /you('re| are) not listen/i,
  /read (that|it|this) again/i,
];

// Positive signals that EXCLUDE a message from being a correction
const POSITIVE_EXCLUSIONS = [
  /^(yes|ok|okay|sure|great|nice|perfect|good|love|amazing|cool|awesome)/i,
  /that's (great|good|perfect|amazing|awesome|cool)/i,
  /^(👍|🔥|❤️|💪|✅|😂|🙏)/,
  /thank/i,
  /let's (go|do|build|ship)/i,
  /go for it/i,
  /^(yep|yup|yeah|ya)/i,
];

// Strong signals that this is definitely a correction
const STRONG_SIGNALS = [
  /get yourself back/i,
  /how comes/i,
  /that's not right/i,
  /you forgot/i,
  /you missed/i,
  /still not working/i,
  /i told you/i,
  /check again/i,
  /\bfix\b$/i,
  /stop/i,
  /focus/i,
  /are you sure/i,
  /read (that|it|this) again/i,
];

// Implicit corrections: short reply after long Raven response
function isImplicitCorrection(sunnyMsg, ravenMsg) {
  if (!sunnyMsg || !ravenMsg) return false;
  const sunnyWords = sunnyMsg.split(/\s+/).length;
  const ravenWords = ravenMsg.split(/\s+/).length;
  // Sunny sends ≤5 words after Raven sent 100+ = likely "too much" signal
  if (sunnyWords <= 5 && ravenWords > 100) return true;
  // Single word or emoji responses
  if (sunnyWords <= 2 && ravenWords > 50) return true;
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
      if (typeof content === 'string') {
        text = content;
      } else if (Array.isArray(content)) {
        text = content.filter(c => c?.type === 'text').map(c => c.text || '').join(' ');
      }
      
      if (!text || text.length < 2) continue;
      // Strip metadata headers from user messages
      text = text.replace(/^Conversation info.*?```\n/s, '').replace(/^\[Queued.*?---\n/sg, '').trim();
      if (!text) continue;
      
      messages.push({ role: role === 'user' ? 'sunny' : 'raven', text: text.slice(0, 1000) });
    } catch {}
  }

  // Find corrections
  for (let i = 1; i < messages.length; i++) {
    if (messages[i].role !== 'sunny') continue;
    if (i === 0 || messages[i - 1].role !== 'raven') continue;
    
    const sunnyText = messages[i].text;
    // Check for positive signals first — these override correction patterns
    const isPositive = POSITIVE_EXCLUSIONS.some(p => p.test(sunnyText));
    if (isPositive) continue;
    
    const isExplicit = CORRECTION_PATTERNS.some(p => p.test(sunnyText));
    const isImplicit = isImplicitCorrection(sunnyText, messages[i - 1].text);
    if (!isExplicit && !isImplicit) continue;
    
    const isStrong = STRONG_SIGNALS.some(p => p.test(sunnyText));
    const context = messages.slice(Math.max(0, i - 3), i + 1)
      .map(m => `[${m.role}]: ${m.text.slice(0, 300)}`)
      .join('\n');

    corrections.push({
      raven_said: messages[i - 1].text.slice(0, 800),
      sunny_corrected: sunnyText.slice(0, 500),
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
  
  // Process last 50 sessions (most recent, manageable size)
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
    } catch (err) {
      // Skip corrupt files
    }
  }

  // Dedupe by sunny_corrected text similarity
  const seen = new Set();
  const deduped = allCorrections.filter(c => {
    const key = c.sunny_corrected.slice(0, 50).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort: strong first, then by recency (later sessions first)
  deduped.sort((a, b) => {
    if (a.strength !== b.strength) return a.strength === 'strong' ? -1 : 1;
    return 0;
  });

  const db = {
    updated: new Date().toISOString(),
    sessions_processed: recentFiles.length,
    total_corrections: allCorrections.length,
    deduplicated: deduped.length,
    strong_corrections: deduped.filter(c => c.strength === 'strong').length,
    corrections: deduped
  };

  const tmpOut = OUTPUT + '.tmp';
  fs.writeFileSync(tmpOut, JSON.stringify(db, null, 2));
  fs.renameSync(tmpOut, OUTPUT);
  console.log(`\nTotal: ${allCorrections.length} corrections (${deduped.length} unique, ${db.strong_corrections} strong)`);
  console.log(`Written to: ${OUTPUT}`);
}

main().catch(err => { console.error(err); process.exit(1); });
