#!/usr/bin/env node
// DIAGNOSIS ENGINE — Steipete pattern applied to Raven's evolution
// Parallel analysis of failed predictions → behavioral rules → inject
// This runs in the judge's workspace. Raven SHOULD NOT edit this.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(process.env.HOME, 'clawd');
const JUDGE_DIR = path.join(ROOT, 'agents', 'judge');

// ── Read Raven's data (read-only) ──────────────────────────────
function readJSONL(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8').trim().split('\n')
      .filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

const scores = readJSONL(path.join(ROOT, 'memory', 'prediction-scores.jsonl'));
const frames = readJSONL(path.join(ROOT, 'memory', 'prediction-frames.jsonl'));
const convo = readJSONL(path.join(ROOT, 'data', 'conversation-log.jsonl'));

console.log(`Loaded: ${scores.length} scores, ${frames.length} frames, ${convo.length} conversation entries`);

// ── Match failures with their predictions ──────────────────────
const failures = scores.filter(s => parseFloat(s.aggregate_error || s.aggregateError || 0) > 0.4);
console.log(`Failures (>0.4 error): ${failures.length}`);

// Build frame lookup
const frameMap = {};
frames.forEach(f => { if (f.id) frameMap[f.id] = f; });

// Match each failure with its prediction and the actual message
const diagnosisInputs = [];
for (const score of failures.slice(-100)) { // Last 100 failures
  const frame = frameMap[score.frame_id];
  if (!frame || !frame.frame) continue;

  // Find the actual message from conversation log near the score timestamp
  const scoreTs = new Date(score.timestamp || 0).getTime();
  let actualMsg = score.actual || '';
  if (!actualMsg) {
    const nearby = convo.filter(c => 
      c.role === 'sunny' && Math.abs((c.ts || 0) - scoreTs) < 60000
    );
    if (nearby.length > 0) actualMsg = nearby[nearby.length - 1].text || '';
  }

  diagnosisInputs.push({
    frame_id: score.frame_id,
    error: parseFloat(score.aggregate_error || score.aggregateError || 0),
    dimension_errors: score.dimension_errors || score.scores || {},
    predicted: {
      intent: frame.frame.intent,
      emotion: frame.frame.emotion,
      topic: frame.frame.topic,
      implicit_ask: frame.frame.implicit_ask,
      avoidance: frame.frame.avoidance
    },
    actual_message: actualMsg,
    actual_type: score.actual_type || '',
    predicted_type: frame.message_type || '',
    rationale: score.rationale || '',
    v6_state: frame.v6?.state || '',
    v7_chapter: frame.v7?.chapter || '',
  });
}

console.log(`Matched failures for diagnosis: ${diagnosisInputs.length}`);

// ── Pattern analysis (no LLM needed for this part) ─────────────

// 1. Type mismatches — when I predict X but Sunny does Y
const typeMismatches = {};
diagnosisInputs.forEach(d => {
  if (d.predicted_type && d.actual_type && d.predicted_type !== d.actual_type) {
    const key = `${d.predicted_type}→${d.actual_type}`;
    typeMismatches[key] = (typeMismatches[key] || 0) + 1;
  }
});

// 2. Dimension-specific failures — which dimensions am I worst at?
const dimFailCounts = { intent: 0, emotion: 0, topic: 0, implicit_ask: 0, avoidance: 0 };
const dimFailExamples = { intent: [], emotion: [], topic: [], implicit_ask: [], avoidance: [] };
diagnosisInputs.forEach(d => {
  for (const [dim, err] of Object.entries(d.dimension_errors)) {
    if (parseFloat(err) > 0.6 && dimFailCounts[dim] !== undefined) {
      dimFailCounts[dim]++;
      if (dimFailExamples[dim].length < 5) {
        dimFailExamples[dim].push({
          predicted: d.predicted[dim],
          actual: d.actual_message?.substring(0, 100),
          error: parseFloat(err)
        });
      }
    }
  }
});

// 3. Context patterns — when am I failing?
const stateFailCounts = {};
const chapterFailCounts = {};
diagnosisInputs.forEach(d => {
  if (d.v6_state) stateFailCounts[d.v6_state] = (stateFailCounts[d.v6_state] || 0) + 1;
  if (d.v7_chapter) chapterFailCounts[d.v7_chapter] = (chapterFailCounts[d.v7_chapter] || 0) + 1;
});

// 4. Short message failures — am I bad at predicting short messages?
const shortMsgFailures = diagnosisInputs.filter(d => 
  d.actual_message && d.actual_message.split(/\s+/).length <= 5
);
const longMsgFailures = diagnosisInputs.filter(d => 
  d.actual_message && d.actual_message.split(/\s+/).length > 5
);

// 5. Derive behavioral rules from patterns
const rules = [];

// Sort type mismatches by frequency
const sortedMismatches = Object.entries(typeMismatches).sort((a, b) => b[1] - a[1]);
sortedMismatches.slice(0, 5).forEach(([mismatch, count]) => {
  const [predicted, actual] = mismatch.split('→');
  if (count >= 3) {
    rules.push({
      type: 'type_correction',
      rule: `When you predict "${predicted}", consider "${actual}" instead — this mismatch happened ${count} times`,
      confidence: Math.min(count / diagnosisInputs.length * 10, 0.9),
      evidence_count: count,
      source: 'type_mismatch_analysis'
    });
  }
});

// Short message rule
if (shortMsgFailures.length > longMsgFailures.length * 0.5) {
  const shortAvgError = shortMsgFailures.reduce((s, d) => s + d.error, 0) / shortMsgFailures.length;
  rules.push({
    type: 'context_rule',
    rule: `Short messages (≤5 words) are your weakness — ${shortMsgFailures.length} failures with avg error ${shortAvgError.toFixed(3)}. Default to "check-in" intent for short messages.`,
    confidence: 0.7,
    evidence_count: shortMsgFailures.length,
    source: 'message_length_analysis'
  });
}

// Worst dimension rule
const worstDim = Object.entries(dimFailCounts).sort((a, b) => b[1] - a[1])[0];
if (worstDim && worstDim[1] >= 5) {
  rules.push({
    type: 'dimension_focus',
    rule: `Your worst dimension is "${worstDim[0]}" with ${worstDim[1]} high-error failures. Focus prediction effort here.`,
    confidence: 0.8,
    evidence_count: worstDim[1],
    examples: dimFailExamples[worstDim[0]]?.slice(0, 3),
    source: 'dimension_analysis'
  });
}

// State-specific rules
const worstState = Object.entries(stateFailCounts).sort((a, b) => b[1] - a[1])[0];
if (worstState && worstState[1] >= 5) {
  rules.push({
    type: 'state_rule',
    rule: `You fail most when conversation state is "${worstState[0]}" (${worstState[1]} failures). Re-examine your assumptions in this state.`,
    confidence: 0.6,
    evidence_count: worstState[1],
    source: 'state_analysis'
  });
}

// ── Build diagnosis report ─────────────────────────────────────
const report = {
  timestamp: new Date().toISOString(),
  failures_analyzed: diagnosisInputs.length,
  total_scores: scores.length,
  failure_rate: (failures.length / scores.length * 100).toFixed(1) + '%',
  patterns: {
    type_mismatches: sortedMismatches.slice(0, 10).map(([k, v]) => ({ mismatch: k, count: v })),
    dimension_failures: dimFailCounts,
    worst_dimension: worstDim ? { name: worstDim[0], count: worstDim[1], examples: dimFailExamples[worstDim[0]]?.slice(0, 3) } : null,
    state_failures: stateFailCounts,
    chapter_failures: chapterFailCounts,
    short_vs_long: {
      short_failures: shortMsgFailures.length,
      long_failures: longMsgFailures.length,
      short_avg_error: shortMsgFailures.length ? (shortMsgFailures.reduce((s, d) => s + d.error, 0) / shortMsgFailures.length).toFixed(3) : 'n/a',
      long_avg_error: longMsgFailures.length ? (longMsgFailures.reduce((s, d) => s + d.error, 0) / longMsgFailures.length).toFixed(3) : 'n/a'
    }
  },
  behavioral_rules: rules,
  rules_count: rules.length
};

// ── Write outputs ──────────────────────────────────────────────
const diagDir = path.join(JUDGE_DIR, 'diagnoses');
fs.mkdirSync(diagDir, { recursive: true });

const today = new Date().toISOString().split('T')[0];
fs.writeFileSync(path.join(diagDir, `${today}.json`), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(diagDir, 'latest.json'), JSON.stringify(report, null, 2));

// Write rules to a file the daemon can read and inject
const rulesPath = path.join(JUDGE_DIR, 'behavioral-rules.json');
fs.writeFileSync(rulesPath, JSON.stringify({ 
  updated: new Date().toISOString(), 
  rules: rules,
  source: 'judge-diagnosis-engine'
}, null, 2));

console.log('\n═══ DIAGNOSIS REPORT ═══');
console.log(`Failures analyzed: ${diagnosisInputs.length}`);
console.log(`Failure rate: ${report.failure_rate}`);
console.log(`\nTop type mismatches:`);
sortedMismatches.slice(0, 5).forEach(([k, v]) => console.log(`  ${k}: ${v}x`));
console.log(`\nDimension failures (>0.6 error):`);
Object.entries(dimFailCounts).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
console.log(`\nShort msg failures: ${shortMsgFailures.length} | Long: ${longMsgFailures.length}`);
console.log(`\nBehavioral rules generated: ${rules.length}`);
rules.forEach((r, i) => console.log(`  ${i + 1}. [${r.type}] ${r.rule}`));
console.log('\nDiagnosis written to:', path.join(diagDir, `${today}.json`));
