#!/usr/bin/env node
// COCOMO-II Semi-Detached cost estimation
// Usage: node scripts/stats/cocomo.js

const fs = require("fs");
const path = require("path");

// ── Configuration ──────────────────────────────────────────────

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "build",
  ".cache", "__pycache__", ".venv", "target", "vendor", ".claude",
]);

const SKIP_FILES = new Set([
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
]);

const EXT_MAP = {
  ".ts":   "TypeScript",
  ".tsx":  "TypeScript",
  ".js":   "JavaScript",
  ".jsx":  "JavaScript",
  ".py":   "Python",
  ".go":   "Go",
  ".rs":   "Rust",
  ".java": "Java",
  ".cs":   "C#",
  ".rb":   "Ruby",
  ".php":  "PHP",
  ".css":  "CSS",
  ".scss": "CSS",
  ".html": "HTML",
  ".json": "JSON",
};

const HOURS_PER_MONTH = 168;
const DEFAULT_HOURLY_RATE = 80;

// ── Helpers ────────────────────────────────────────────────────

function readConfig(dir) {
  const cfgPath = path.join(dir, ".cc-starter.json");
  try {
    const raw = fs.readFileSync(cfgPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function countLines(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.length === 0) return 0;
  let count = 1;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0a) count++;
  }
  // If the file ends with a newline, don't count the trailing empty line
  if (buf[buf.length - 1] === 0x0a) count--;
  return count;
}

function walkDir(dir, counts) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const name = entry.name;

    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(name)) {
        walkDir(path.join(dir, name), counts);
      }
      continue;
    }

    if (!entry.isFile()) continue;

    // Skip minified files
    if (name.endsWith(".min.js") || name.endsWith(".min.css")) continue;
    if (SKIP_FILES.has(name)) continue;

    const ext = path.extname(name).toLowerCase();
    const lang = EXT_MAP[ext];
    if (!lang) continue;

    const fullPath = path.join(dir, name);
    const lines = countLines(fullPath);

    // JSON: skip large generated files (package-lock etc.)
    if (lang === "JSON" && lines >= 1000) continue;

    counts[lang] = (counts[lang] || 0) + lines;
  }
}

function fmt(n) {
  return n.toLocaleString("en-US");
}

// ── COCOMO-II Semi-Detached ────────────────────────────────────

function cocomo(totalLines) {
  const kloc = totalLines / 1000;
  const effort = 3.0 * Math.pow(kloc, 1.12);          // Person-Months
  const schedule = 2.5 * Math.pow(effort, 0.35);       // Months
  const teamSize = effort / schedule;                   // Developers
  return { kloc, effort, schedule, teamSize };
}

// ── Main ───────────────────────────────────────────────────────

function main() {
  const root = process.cwd();
  const config = readConfig(root);
  const hourlyRate = config.hourlyRate || DEFAULT_HOURLY_RATE;

  // Count LOC
  const counts = {};
  walkDir(root, counts);

  const languages = Object.entries(counts)
    .sort((a, b) => b[1] - a[1]);

  const totalLines = languages.reduce((s, [, c]) => s + c, 0);

  if (totalLines === 0) {
    console.log("\n  No source files found in the current directory.\n");
    process.exit(0);
  }

  const est = cocomo(totalLines);
  const cost = est.effort * HOURS_PER_MONTH * hourlyRate;

  // Find longest language name for alignment
  const maxLangLen = Math.max(...languages.map(([l]) => l.length), 5);
  const maxNumLen = Math.max(...languages.map(([, c]) => fmt(c).length), fmt(totalLines).length);

  // ── Output ─────────────────────────────────────────────────

  console.log();
  console.log("  COCOMO-II Project Estimation");
  console.log("  " + "\u2550".repeat(32));
  console.log();
  console.log("  Lines of Code:");

  for (const [lang, count] of languages) {
    const label = lang.padEnd(maxLangLen);
    const num = fmt(count).padStart(maxNumLen);
    console.log(`    ${label}  ${num}`);
  }

  console.log("    " + "\u2500".repeat(maxLangLen + maxNumLen + 2));

  const totalLabel = "Total".padEnd(maxLangLen);
  const totalNum = fmt(totalLines).padStart(maxNumLen);
  console.log(`    ${totalLabel}  ${totalNum}`);

  console.log();
  console.log("  Estimation (Semi-Detached):");
  console.log(`    Effort:     ${est.effort.toFixed(1).padStart(8)} Person-Months`);
  console.log(`    Schedule:   ${est.schedule.toFixed(1).padStart(8)} Months`);
  console.log(`    Team Size:  ${est.teamSize.toFixed(1).padStart(8)} Developers`);
  const costStr = "\u20AC" + fmt(Math.round(cost));
  console.log(`    Cost:       ${costStr.padStart(8)} (at \u20AC${fmt(hourlyRate)}/h)`);

  console.log();
  console.log("  Note: COCOMO-II provides rough order-of-magnitude estimates.");
  console.log(`  Based on ${fmt(HOURS_PER_MONTH)}h/month at configured rate of \u20AC${fmt(hourlyRate)}/h.`);
  console.log();
}

main();
