#!/usr/bin/env node

// cc-starter Token Tracker
// Track token savings from vibe-coded tooling vs traditional approaches.
// CommonJS, zero external dependencies.

const fs = require('fs');
const path = require('path');

const STATS_FILE = path.join(process.cwd(), '.vibe-stats.json');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadStats() {
  if (!fs.existsSync(STATS_FILE)) {
    return { sessions: [], totalSaved: 0, operationsCount: 0, created: new Date().toISOString() };
  }
  try {
    return JSON.parse(fs.readFileSync(STATS_FILE, 'utf-8'));
  } catch {
    console.error('Error: could not parse .vibe-stats.json — starting fresh.');
    return { sessions: [], totalSaved: 0, operationsCount: 0, created: new Date().toISOString() };
  }
}

function saveStats(stats) {
  fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2), 'utf-8');
}

function fmt(n) {
  return Number(n).toLocaleString('en-US');
}

function estimateTokens(charCount) {
  return Math.ceil(charCount / 4);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function cmdLog(args) {
  const operation = args[0];
  const traditionalSize = parseInt(args[1], 10);
  const vibeSize = parseInt(args[2], 10);
  const file = args[3] || null;

  if (!operation || isNaN(traditionalSize) || isNaN(vibeSize)) {
    console.error('Usage: vibe-stats log <operation> <traditional-size> <vibe-size> [file]');
    process.exit(1);
  }

  const saved = traditionalSize - vibeSize;
  const percentage = traditionalSize > 0 ? Math.round((saved / traditionalSize) * 100) : 0;

  const entry = {
    timestamp: new Date().toISOString(),
    operation,
    file,
    traditionalTokens: traditionalSize,
    vibeModeTokens: vibeSize,
    savedTokens: saved,
    percentage,
  };

  const stats = loadStats();
  stats.sessions.push(entry);
  stats.totalSaved += saved;
  stats.operationsCount += 1;
  saveStats(stats);

  console.log(`Logged: ${operation} — saved ${fmt(saved)} tokens (${percentage}%)`);
}

function cmdReport() {
  const stats = loadStats();

  if (stats.operationsCount === 0) {
    console.log('No operations recorded yet. Use "vibe-stats log" to add entries.');
    return;
  }

  // Period
  const created = new Date(stats.created);
  const now = new Date();
  const days = Math.max(1, Math.ceil((now - created) / (1000 * 60 * 60 * 24)));

  console.log('');
  console.log('=== cc-starter Token Tracker — Report ===');
  console.log('');
  console.log(`Period:       ${created.toISOString().slice(0, 10)} → ${now.toISOString().slice(0, 10)} (${days} day${days !== 1 ? 's' : ''})`);
  console.log(`Operations:   ${fmt(stats.operationsCount)}`);
  console.log(`Total saved:  ${fmt(stats.totalSaved)} tokens`);
  console.log('');

  // Breakdown by operation type
  const byOp = {};
  for (const s of stats.sessions) {
    if (!byOp[s.operation]) {
      byOp[s.operation] = { count: 0, saved: 0, traditional: 0, vibe: 0 };
    }
    byOp[s.operation].count += 1;
    byOp[s.operation].saved += s.savedTokens;
    byOp[s.operation].traditional += s.traditionalTokens;
    byOp[s.operation].vibe += s.vibeModeTokens;
  }

  console.log('--- Breakdown by operation ---');
  const ops = Object.keys(byOp).sort((a, b) => byOp[b].saved - byOp[a].saved);
  for (const op of ops) {
    const d = byOp[op];
    const pct = d.traditional > 0 ? Math.round((d.saved / d.traditional) * 100) : 0;
    console.log(`  ${op}: ${fmt(d.saved)} tokens saved across ${d.count} op${d.count !== 1 ? 's' : ''} (${pct}% avg reduction)`);
  }

  // Recent 10
  const recent = stats.sessions.slice(-10).reverse();
  console.log('');
  console.log('--- Recent operations (last 10) ---');
  for (const s of recent) {
    const ts = s.timestamp.slice(0, 16).replace('T', ' ');
    const fileStr = s.file ? ` [${s.file}]` : '';
    console.log(`  ${ts}  ${s.operation}${fileStr}  saved ${fmt(s.savedTokens)} (${s.percentage}%)`);
  }
  console.log('');
}

function cmdEstimate(args) {
  const filePath = args[0];
  if (!filePath) {
    console.error('Usage: vibe-stats estimate <file>');
    process.exit(1);
  }

  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    console.error(`File not found: ${resolved}`);
    process.exit(1);
  }

  const content = fs.readFileSync(resolved, 'utf-8');
  const chars = content.length;
  const lines = content.split('\n').length;
  const tokens = estimateTokens(chars);

  console.log(`File:   ${path.basename(resolved)}`);
  console.log(`Chars:  ${fmt(chars)}`);
  console.log(`Lines:  ${fmt(lines)}`);
  console.log(`Tokens: ~${fmt(tokens)} (estimated at 1 token per 4 chars)`);
}

function cmdCompare(args) {
  const file1 = args[0];
  const file2 = args[1];
  if (!file1 || !file2) {
    console.error('Usage: vibe-stats compare <file1> <file2>');
    process.exit(1);
  }

  const resolved1 = path.resolve(file1);
  const resolved2 = path.resolve(file2);

  for (const f of [resolved1, resolved2]) {
    if (!fs.existsSync(f)) {
      console.error(`File not found: ${f}`);
      process.exit(1);
    }
  }

  const content1 = fs.readFileSync(resolved1, 'utf-8');
  const content2 = fs.readFileSync(resolved2, 'utf-8');
  const tokens1 = estimateTokens(content1.length);
  const tokens2 = estimateTokens(content2.length);
  const diff = tokens1 - tokens2;
  const pct = tokens1 > 0 ? Math.round((Math.abs(diff) / tokens1) * 100) : 0;

  console.log(`File 1: ${path.basename(resolved1)} — ~${fmt(tokens1)} tokens`);
  console.log(`File 2: ${path.basename(resolved2)} — ~${fmt(tokens2)} tokens`);
  console.log('');
  if (diff > 0) {
    console.log(`File 1 is larger by ~${fmt(diff)} tokens (${pct}% more)`);
  } else if (diff < 0) {
    console.log(`File 2 is larger by ~${fmt(Math.abs(diff))} tokens (${pct}% more)`);
  } else {
    console.log('Both files have approximately the same token count.');
  }
}

function cmdSummary() {
  const stats = loadStats();
  if (stats.operationsCount === 0) {
    console.log('No operations recorded yet.');
    return;
  }
  console.log(`Total: ${fmt(stats.totalSaved)} tokens saved across ${fmt(stats.operationsCount)} operations`);
}

function cmdReset(args) {
  if (!args.includes('--confirm')) {
    console.error('Usage: vibe-stats reset --confirm');
    console.error('This will delete all recorded statistics.');
    process.exit(1);
  }

  if (fs.existsSync(STATS_FILE)) {
    fs.unlinkSync(STATS_FILE);
  }
  console.log('Statistics reset.');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case 'log':
    cmdLog(args);
    break;
  case 'report':
    cmdReport();
    break;
  case 'estimate':
    cmdEstimate(args);
    break;
  case 'compare':
    cmdCompare(args);
    break;
  case 'summary':
    cmdSummary();
    break;
  case 'reset':
    cmdReset(args);
    break;
  default:
    console.log('cc-starter Token Tracker');
    console.log('');
    console.log('Commands:');
    console.log('  log <operation> <traditional-size> <vibe-size> [file]  Log a token savings entry');
    console.log('  report                                                  Show detailed statistics');
    console.log('  estimate <file>                                         Estimate tokens in a file');
    console.log('  compare <file1> <file2>                                 Compare token counts');
    console.log('  summary                                                 One-liner quick check');
    console.log('  reset --confirm                                         Reset all statistics');
    break;
}
