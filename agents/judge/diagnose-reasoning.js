#!/usr/bin/env node
/**
 * AGI v0.1 — Reasoning Diagnosis Engine
 * 
 * Analyzes the agent's REPLIES to find patterns in how it fails the human.
 * Produces executable reasoning rules that get injected into BOOTSTRAP.md.
 * 
 * Usage: node diagnose-reasoning.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..', '..');
const JUDGE_DIR = __dirname;

// Load config
const CONFIG_FILE = path.join(ROOT, 'thalamus-config.json');
let config = {};
try { config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch {}

const AGENT_NAME = config.agentName || process.env.AGI_AGENT_NAME || 'Agent';
const HUMAN_NAME = config.humanName || process.env.AGI_HUMAN_NAME || 'Human';

// LLM setup — use OpenAI or OpenRouter
const LLM_PROVIDER = config.llmProvider || process.env.AGI_LLM_PROVIDER || 'openai';
const LLM_API_KEY = config.llmApiKey || process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY || '';
const LLM_MODEL_FAST = config.llmModel || 'gpt-4o-mini';
const LLM_MODEL_SMART = config.llmModelSmart || 'gpt-4o';

function callLLM(system, user, model = LLM_MODEL_FAST) {
  return new Promise((resolve, reject) => {
    const isOpenRouter = LLM_PROVIDER === 'openrouter';
    const hostname = isOpenRouter ? 'openrouter.ai' : 'api.openai.com';
    const apiPath = isOpenRouter ? '/api/v1/chat/completions' : '/v1/chat/completions';
    
    const body = JSON.stringify({ model, max_tokens: 1500, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] });
    const req = https.request({
      hostname, path: apiPath, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LLM_API_KEY}` }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const text = JSON.parse(data).choices?.[0]?.message?.content || '';
          if (!text) reject(new Error(`Empty: ${data.slice(0, 200)}`));
          else resolve(text);
        } catch (e) { reject(new Error(`Parse: ${data.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

function getCorrectionsDB() {
  try {
    return JSON.parse(fs.readFileSync(path.join(JUDGE_DIR, 'corrections-db.json'), 'utf8')).corrections || [];
  } catch { return []; }
}

function getScars() {
  try {
    const mem = fs.readFileSync(path.join(ROOT, 'MEMORY.md'), 'utf8');
    const match = mem.match(/## 🔴 SCARS[\s\S]*?(?=## |$)/);
    return match ? match[0] : '';
  } catch { return ''; }
}

async function analyzeCorrection(correction, index) {
  const system = `You analyze conversations between ${HUMAN_NAME} (human) and ${AGENT_NAME} (AI agent). ${HUMAN_NAME} corrected ${AGENT_NAME}. Your job: understand what ${AGENT_NAME} did wrong and produce a SPECIFIC, EXECUTABLE reasoning rule.

Rules must be ACTIONABLE CHECKS, not advice.
Bad: "Be more careful."
Good: "Before stating any system status, RUN the relevant command and quote the output."

Output ONLY valid JSON:
{
  "what_agent_did_wrong": "specific mistake with quote",
  "why_it_was_wrong": "root cause",
  "reasoning_rule": "Before/When/Always [trigger], [executable action] because [evidence]",
  "category": "stale_context|oververbose|overselling|wrong_assumption|not_listening|rushing|not_checking",
  "confidence": 0.0-1.0,
  "recurring": false
}`;

  try {
    const response = await callLLM(system, `CORRECTION #${index + 1}\n\n${correction.context}\n\nAGENT SAID:\n"${correction.agent_said}"\n\nHUMAN CORRECTED:\n"${correction.human_corrected}"`, LLM_MODEL_FAST);
    const match = response.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    return { error: 'no JSON' };
  } catch (err) { return { error: err.message }; }
}

async function synthesize(analyses, scars) {
  const system = `Synthesize analyses of an AI agent's mistakes into EXECUTABLE reasoning rules for injection into its boot context.

CRITICAL: Rules must be EXECUTABLE CHECKS, not advice.
❌ "Always verify before claiming" (vague)
✅ "Before stating anything about a running system, CHECK IT FIRST with a tool call — never trust documentation for current state"

Output ONLY valid JSON:
{
  "patterns": ["pattern1"],
  "reasoning_rules": [{ "rule": "...", "category": "...", "confidence": 0.0-1.0, "evidence_count": N, "recurring": false }],
  "meta_insight": "the one thing that would most change behavior"
}`;

  try {
    const response = await callLLM(system, `${analyses.length} analyses:\n\n${analyses.map((a, i) => `--- #${i + 1} ---\n${JSON.stringify(a, null, 1)}`).join('\n\n')}\n\nExisting scars:\n${scars}\n\nSynthesize into 5-7 rules.`, LLM_MODEL_SMART);
    const match = response.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    return { error: 'synthesis failed' };
  } catch (err) { return { error: err.message }; }
}

async function main() {
  console.log('=== REASONING DIAGNOSIS ===\n');

  let corrections = getCorrectionsDB();
  console.log(`Corrections DB: ${corrections.length} entries`);

  if (corrections.length === 0) {
    console.log('No corrections found.');
    process.exit(0);
  }

  const strong = corrections.filter(c => c.strength === 'strong');
  const rest = corrections.filter(c => c.strength !== 'strong').slice(-15);
  const toAnalyze = [...strong.slice(-10), ...rest].slice(-20);
  console.log(`Analyzing ${toAnalyze.length} corrections...`);

  const analyses = [];
  for (let i = 0; i < toAnalyze.length; i += 5) {
    const batch = toAnalyze.slice(i, i + 5);
    console.log(`Batch ${Math.floor(i / 5) + 1}/${Math.ceil(toAnalyze.length / 5)}...`);
    const results = await Promise.all(batch.map((c, j) => analyzeCorrection(c, i + j)));
    analyses.push(...results);
    if (i + 5 < toAnalyze.length) await new Promise(r => setTimeout(r, 1000));
  }

  const successful = analyses.filter(a => !a.error);
  console.log(`\nAnalyses: ${successful.length} successful, ${analyses.length - successful.length} failed`);

  if (successful.length < 2) { console.log('Too few analyses.'); process.exit(1); }

  const scars = getScars();
  console.log('\nSynthesizing reasoning rules...');
  const synthesis = await synthesize(successful, scars);

  if (synthesis.reasoning_rules) {
    synthesis.reasoning_rules.forEach((r, i) => console.log(`${i + 1}. [${r.category}] ${r.rule}`));
  }
  if (synthesis.meta_insight) console.log(`\nMeta: ${synthesis.meta_insight}`);

  // Write outputs
  const diagDir = path.join(JUDGE_DIR, 'diagnoses');
  fs.mkdirSync(diagDir, { recursive: true });

  const today = new Date().toISOString().split('T')[0];
  const report = {
    timestamp: new Date().toISOString(),
    corrections_found: corrections.length,
    corrections_analyzed: toAnalyze.length,
    analyses_successful: successful.length,
    individual_analyses: successful,
    synthesis
  };
  fs.writeFileSync(path.join(diagDir, `${today}-reasoning.json`), JSON.stringify(report, null, 2));

  // Write reasoning rules for BOOTSTRAP injection with rollback support
  if (synthesis.reasoning_rules) {
    const rulesPath = path.join(JUDGE_DIR, 'reasoning-rules.json');
    try {
      if (fs.existsSync(rulesPath)) fs.copyFileSync(rulesPath, path.join(JUDGE_DIR, 'reasoning-rules.prev.json'));
    } catch {}

    fs.writeFileSync(rulesPath, JSON.stringify({
      updated: new Date().toISOString(),
      source: 'reasoning-diagnosis',
      meta_insight: synthesis.meta_insight || '',
      rules: synthesis.reasoning_rules
    }, null, 2));
    console.log(`\nWrote ${synthesis.reasoning_rules.length} reasoning rules.`);
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
