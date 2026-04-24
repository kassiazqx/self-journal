#!/usr/bin/env node
// cc-starter Project Report — generates a visual HTML report of project statistics.
// Two modes: "minimal" (zero deps, CSS bar charts) and "fancy" (Chart.js via CDN).
// CommonJS, zero npm dependencies.

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// ── Configuration (shared with cocomo.js) ────────────────────

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

// ── Helpers ──────────────────────────────────────────────────

function readConfig(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, ".cc-starter.json"), "utf-8"));
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
  if (buf[buf.length - 1] === 0x0a) count--;
  return count;
}

function fmt(n) {
  return Number(n).toLocaleString("en-US");
}

// ── Data Collection ──────────────────────────────────────────

function collectData(root) {
  const langCounts = {};
  const folderCounts = {};
  const fileList = []; // { path, lines, lang }

  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }

    for (const entry of entries) {
      const name = entry.name;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(name)) walk(path.join(dir, name));
        continue;
      }
      if (!entry.isFile()) continue;
      if (name.endsWith(".min.js") || name.endsWith(".min.css")) continue;
      if (SKIP_FILES.has(name)) continue;

      const ext = path.extname(name).toLowerCase();
      const lang = EXT_MAP[ext];
      if (!lang) continue;

      const fullPath = path.join(dir, name);
      const lines = countLines(fullPath);

      if (lang === "JSON" && lines >= 1000) continue;

      langCounts[lang] = (langCounts[lang] || 0) + lines;
      fileList.push({ path: path.relative(root, fullPath), lines, lang });

      // Top-level folder
      const rel = path.relative(root, fullPath);
      const topFolder = rel.includes(path.sep) ? rel.split(path.sep)[0] : "(root)";
      folderCounts[topFolder] = (folderCounts[topFolder] || 0) + lines;
    }
  }

  walk(root);

  // Sort
  const languages = Object.entries(langCounts).sort((a, b) => b[1] - a[1]);
  const folders = Object.entries(folderCounts).sort((a, b) => b[1] - a[1]);
  const largestFiles = fileList.sort((a, b) => b.lines - a.lines).slice(0, 10);
  const totalLines = languages.reduce((s, [, c]) => s + c, 0);

  return { languages, folders, largestFiles, totalLines };
}

function cocomoEstimate(totalLines, hourlyRate) {
  const kloc = totalLines / 1000;
  const effort = 3.0 * Math.pow(kloc, 1.12);
  const schedule = 2.5 * Math.pow(effort, 0.35);
  const teamSize = effort / schedule;
  const cost = effort * HOURS_PER_MONTH * hourlyRate;
  return { kloc, effort, schedule, teamSize, cost };
}

function loadVibeStats(root) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(root, ".vibe-stats.json"), "utf-8"));
    if (data.operationsCount > 0) return data;
  } catch {}
  return null;
}

function getGitStats(root) {
  try {
    const opts = { cwd: root, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] };
    const totalCommits = parseInt(execSync("git rev-list --count HEAD", opts).trim(), 10);
    const lastCommitDate = execSync('git log -1 --format=%ci', opts).trim();
    // Active days: unique dates of commits
    const logOutput = execSync('git log --format=%cd --date=short', opts).trim();
    const uniqueDays = new Set(logOutput.split("\n").filter(Boolean));
    const firstCommitDate = execSync('git log --reverse --format=%cd --date=short -1', opts).trim();
    return {
      totalCommits,
      lastCommitDate: lastCommitDate.slice(0, 10),
      firstCommitDate,
      activeDays: uniqueDays.size,
    };
  } catch {
    return null;
  }
}

// ── Escape HTML ──────────────────────────────────────────────

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── Color palette ────────────────────────────────────────────

const PALETTE = [
  "#58a6ff", // blue
  "#3fb950", // green
  "#bc8cff", // purple
  "#79c0ff", // light blue
  "#d2a8ff", // lavender
  "#56d4dd", // teal
  "#f778ba", // pink
  "#ffa657", // orange
  "#ff7b72", // red
  "#e3b341", // gold
  "#7ee787", // lime
  "#a5d6ff", // sky
];

function colorFor(i) {
  return PALETTE[i % PALETTE.length];
}

// ── HTML Generation ──────────────────────────────────────────

function generateMinimal(projectName, data, cocomo, vibeStats, gitStats) {
  const { languages, folders, largestFiles, totalLines } = data;
  const genDate = new Date().toISOString().slice(0, 10);
  const maxLangLines = languages.length > 0 ? languages[0][1] : 1;
  const maxFolderLines = folders.length > 0 ? folders[0][1] : 1;

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Project Report — ${esc(projectName)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #0d1117; color: #e6edf3;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    line-height: 1.6; padding: 2rem 1rem;
  }
  .container { max-width: 860px; margin: 0 auto; }
  h1 { font-size: 1.75rem; font-weight: 600; margin-bottom: 0.25rem; }
  .subtitle { color: #8b949e; font-size: 0.9rem; margin-bottom: 2rem; }
  .section { margin-bottom: 2.5rem; }
  .section-title {
    font-size: 1.1rem; font-weight: 600; margin-bottom: 1rem;
    padding-bottom: 0.5rem; border-bottom: 1px solid #21262d;
  }
  .bar-row { display: flex; align-items: center; margin-bottom: 0.5rem; gap: 0.75rem; }
  .bar-label { width: 120px; flex-shrink: 0; font-size: 0.85rem; text-align: right; color: #c9d1d9; }
  .bar-track { flex: 1; height: 22px; background: #161b22; border-radius: 4px; overflow: hidden; }
  .bar { height: 100%; border-radius: 4px; min-width: 2px; transition: width 0.3s; }
  .bar-value { width: 90px; flex-shrink: 0; font-size: 0.8rem; color: #8b949e; text-align: right; font-variant-numeric: tabular-nums; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1rem; }
  .card {
    background: #161b22; border: 1px solid #21262d; border-radius: 8px; padding: 1.25rem;
  }
  .card-title { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: #8b949e; margin-bottom: 0.5rem; }
  .card-value { font-size: 1.5rem; font-weight: 600; color: #58a6ff; }
  .card-detail { font-size: 0.8rem; color: #8b949e; margin-top: 0.25rem; }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  th { text-align: left; color: #8b949e; font-weight: 500; padding: 0.5rem 0.75rem; border-bottom: 1px solid #21262d; }
  td { padding: 0.5rem 0.75rem; border-bottom: 1px solid #161b22; }
  tr:hover td { background: #161b22; }
  .mono { font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace; font-size: 0.8rem; }
  .text-right { text-align: right; }
  .footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid #21262d; font-size: 0.75rem; color: #484f58; text-align: center; }
</style>
</head>
<body>
<div class="container">
  <h1>${esc(projectName)}</h1>
  <div class="subtitle">Project Report &middot; Generated ${esc(genDate)} &middot; ${fmt(totalLines)} total lines of code</div>

  <div class="section">
    <div class="section-title">Lines of Code by Language</div>
`;

  for (let i = 0; i < languages.length; i++) {
    const [lang, count] = languages[i];
    const pct = Math.max(1, Math.round((count / maxLangLines) * 100));
    html += `    <div class="bar-row">
      <span class="bar-label">${esc(lang)}</span>
      <div class="bar-track"><div class="bar" style="width:${pct}%;background:${colorFor(i)}"></div></div>
      <span class="bar-value">${fmt(count)}</span>
    </div>\n`;
  }

  html += `  </div>

  <div class="section">
    <div class="section-title">Lines of Code by Folder</div>
`;

  const foldersToShow = folders.slice(0, 15);
  for (let i = 0; i < foldersToShow.length; i++) {
    const [folder, count] = foldersToShow[i];
    const pct = Math.max(1, Math.round((count / maxFolderLines) * 100));
    html += `    <div class="bar-row">
      <span class="bar-label">${esc(folder)}/</span>
      <div class="bar-track"><div class="bar" style="width:${pct}%;background:${colorFor(i + 3)}"></div></div>
      <span class="bar-value">${fmt(count)}</span>
    </div>\n`;
  }

  html += `  </div>

  <div class="section">
    <div class="section-title">Largest Files</div>
    <table>
      <thead><tr><th>#</th><th>File</th><th>Language</th><th class="text-right">Lines</th></tr></thead>
      <tbody>
`;

  for (let i = 0; i < largestFiles.length; i++) {
    const f = largestFiles[i];
    html += `        <tr><td>${i + 1}</td><td class="mono">${esc(f.path.replace(/\\/g, "/"))}</td><td>${esc(f.lang)}</td><td class="text-right">${fmt(f.lines)}</td></tr>\n`;
  }

  html += `      </tbody>
    </table>
  </div>

  <div class="section">
    <div class="section-title">Estimation</div>
    <div class="cards">
      <div class="card">
        <div class="card-title">COCOMO-II Effort</div>
        <div class="card-value">${cocomo.effort.toFixed(1)} PM</div>
        <div class="card-detail">Person-Months (Semi-Detached)</div>
      </div>
      <div class="card">
        <div class="card-title">Schedule</div>
        <div class="card-value">${cocomo.schedule.toFixed(1)} mo</div>
        <div class="card-detail">${cocomo.teamSize.toFixed(1)} developers</div>
      </div>
      <div class="card">
        <div class="card-title">Estimated Cost</div>
        <div class="card-value">&euro;${fmt(Math.round(cocomo.cost))}</div>
        <div class="card-detail">${fmt(cocomo.kloc.toFixed(1))} KLOC at &euro;${fmt(cocomo.hourlyRate)}/h</div>
      </div>
    </div>
  </div>
`;

  if (vibeStats) {
    html += `
  <div class="section">
    <div class="section-title">Token Savings</div>
    <div class="cards">
      <div class="card">
        <div class="card-title">Tokens Saved</div>
        <div class="card-value">${fmt(vibeStats.totalSaved)}</div>
        <div class="card-detail">across ${fmt(vibeStats.operationsCount)} operations</div>
      </div>
    </div>
  </div>
`;
  }

  if (gitStats) {
    html += `
  <div class="section">
    <div class="section-title">Git Statistics</div>
    <div class="cards">
      <div class="card">
        <div class="card-title">Total Commits</div>
        <div class="card-value">${fmt(gitStats.totalCommits)}</div>
        <div class="card-detail">since ${esc(gitStats.firstCommitDate)}</div>
      </div>
      <div class="card">
        <div class="card-title">Active Days</div>
        <div class="card-value">${fmt(gitStats.activeDays)}</div>
        <div class="card-detail">days with at least one commit</div>
      </div>
      <div class="card">
        <div class="card-title">Last Commit</div>
        <div class="card-value">${esc(gitStats.lastCommitDate)}</div>
        <div class="card-detail">&nbsp;</div>
      </div>
    </div>
  </div>
`;
  }

  html += `
  <div class="footer">Generated by cc-starter &middot; project-report.js</div>
</div>
</body>
</html>`;

  return html;
}

function generateFancy(projectName, data, cocomo, vibeStats, gitStats) {
  const { languages, folders, largestFiles, totalLines } = data;
  const genDate = new Date().toISOString().slice(0, 10);
  const maxFolderLines = folders.length > 0 ? folders[0][1] : 1;

  // Prepare chart data
  const langLabels = JSON.stringify(languages.map(([l]) => l));
  const langValues = JSON.stringify(languages.map(([, c]) => c));
  const langColors = JSON.stringify(languages.map((_, i) => colorFor(i)));

  const foldersToShow = folders.slice(0, 15);
  const folderLabels = JSON.stringify(foldersToShow.map(([f]) => f + "/"));
  const folderValues = JSON.stringify(foldersToShow.map(([, c]) => c));
  const folderColors = JSON.stringify(foldersToShow.map((_, i) => colorFor(i + 3)));

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Project Report — ${esc(projectName)}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #0d1117; color: #e6edf3;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    line-height: 1.6; padding: 2rem 1rem;
  }
  .container { max-width: 920px; margin: 0 auto; }
  h1 { font-size: 1.75rem; font-weight: 600; margin-bottom: 0.25rem; }
  .subtitle { color: #8b949e; font-size: 0.9rem; margin-bottom: 2rem; }
  .section { margin-bottom: 2.5rem; }
  .section-title {
    font-size: 1.1rem; font-weight: 600; margin-bottom: 1rem;
    padding-bottom: 0.5rem; border-bottom: 1px solid #21262d;
  }
  .chart-row { display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; align-items: start; }
  @media (max-width: 700px) { .chart-row { grid-template-columns: 1fr; } }
  .chart-wrap { position: relative; background: #161b22; border: 1px solid #21262d; border-radius: 8px; padding: 1.25rem; }
  .chart-wrap canvas { width: 100% !important; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1rem; }
  .card {
    background: #161b22; border: 1px solid #21262d; border-radius: 8px; padding: 1.25rem;
  }
  .card-title { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: #8b949e; margin-bottom: 0.5rem; }
  .card-value { font-size: 1.5rem; font-weight: 600; color: #58a6ff; }
  .card-detail { font-size: 0.8rem; color: #8b949e; margin-top: 0.25rem; }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  th { text-align: left; color: #8b949e; font-weight: 500; padding: 0.5rem 0.75rem; border-bottom: 1px solid #21262d; }
  td { padding: 0.5rem 0.75rem; border-bottom: 1px solid #161b22; }
  tr:hover td { background: #161b22; }
  .mono { font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace; font-size: 0.8rem; }
  .text-right { text-align: right; }
  .footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid #21262d; font-size: 0.75rem; color: #484f58; text-align: center; }
</style>
</head>
<body>
<div class="container">
  <h1>${esc(projectName)}</h1>
  <div class="subtitle">Project Report &middot; Generated ${esc(genDate)} &middot; ${fmt(totalLines)} total lines of code</div>

  <div class="section">
    <div class="section-title">Code Distribution</div>
    <div class="chart-row">
      <div class="chart-wrap">
        <canvas id="langChart"></canvas>
      </div>
      <div class="chart-wrap">
        <canvas id="folderChart"></canvas>
      </div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Largest Files</div>
    <table>
      <thead><tr><th>#</th><th>File</th><th>Language</th><th class="text-right">Lines</th></tr></thead>
      <tbody>
`;

  for (let i = 0; i < largestFiles.length; i++) {
    const f = largestFiles[i];
    html += `        <tr><td>${i + 1}</td><td class="mono">${esc(f.path.replace(/\\/g, "/"))}</td><td>${esc(f.lang)}</td><td class="text-right">${fmt(f.lines)}</td></tr>\n`;
  }

  html += `      </tbody>
    </table>
  </div>

  <div class="section">
    <div class="section-title">Estimation</div>
    <div class="cards">
      <div class="card">
        <div class="card-title">COCOMO-II Effort</div>
        <div class="card-value">${cocomo.effort.toFixed(1)} PM</div>
        <div class="card-detail">Person-Months (Semi-Detached)</div>
      </div>
      <div class="card">
        <div class="card-title">Schedule</div>
        <div class="card-value">${cocomo.schedule.toFixed(1)} mo</div>
        <div class="card-detail">${cocomo.teamSize.toFixed(1)} developers</div>
      </div>
      <div class="card">
        <div class="card-title">Estimated Cost</div>
        <div class="card-value">&euro;${fmt(Math.round(cocomo.cost))}</div>
        <div class="card-detail">${fmt(cocomo.kloc.toFixed(1))} KLOC at &euro;${fmt(cocomo.hourlyRate)}/h</div>
      </div>
    </div>
  </div>
`;

  if (vibeStats) {
    html += `
  <div class="section">
    <div class="section-title">Token Savings</div>
    <div class="cards">
      <div class="card">
        <div class="card-title">Tokens Saved</div>
        <div class="card-value">${fmt(vibeStats.totalSaved)}</div>
        <div class="card-detail">across ${fmt(vibeStats.operationsCount)} operations</div>
      </div>
    </div>
  </div>
`;
  }

  if (gitStats) {
    html += `
  <div class="section">
    <div class="section-title">Git Statistics</div>
    <div class="cards">
      <div class="card">
        <div class="card-title">Total Commits</div>
        <div class="card-value">${fmt(gitStats.totalCommits)}</div>
        <div class="card-detail">since ${esc(gitStats.firstCommitDate)}</div>
      </div>
      <div class="card">
        <div class="card-title">Active Days</div>
        <div class="card-value">${fmt(gitStats.activeDays)}</div>
        <div class="card-detail">days with at least one commit</div>
      </div>
      <div class="card">
        <div class="card-title">Last Commit</div>
        <div class="card-value">${esc(gitStats.lastCommitDate)}</div>
        <div class="card-detail">&nbsp;</div>
      </div>
    </div>
  </div>
`;
  }

  html += `
  <div class="footer">Generated by cc-starter &middot; project-report.js</div>
</div>

<script>
  Chart.defaults.color = '#8b949e';
  Chart.defaults.borderColor = '#21262d';

  new Chart(document.getElementById('langChart'), {
    type: 'doughnut',
    data: {
      labels: ${langLabels},
      datasets: [{
        data: ${langValues},
        backgroundColor: ${langColors},
        borderWidth: 0,
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true,
      plugins: {
        title: { display: true, text: 'By Language', color: '#e6edf3', font: { size: 14, weight: '600' } },
        legend: { position: 'bottom', labels: { padding: 12, usePointStyle: true, pointStyleWidth: 8 } },
        tooltip: {
          callbacks: {
            label: function(ctx) {
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
              const pct = ((ctx.raw / total) * 100).toFixed(1);
              return ctx.label + ': ' + ctx.raw.toLocaleString() + ' lines (' + pct + '%)';
            }
          }
        }
      }
    }
  });

  new Chart(document.getElementById('folderChart'), {
    type: 'bar',
    data: {
      labels: ${folderLabels},
      datasets: [{
        label: 'Lines of Code',
        data: ${folderValues},
        backgroundColor: ${folderColors},
        borderWidth: 0,
        borderRadius: 3
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      plugins: {
        title: { display: true, text: 'By Folder', color: '#e6edf3', font: { size: 14, weight: '600' } },
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function(ctx) { return ctx.raw.toLocaleString() + ' lines'; }
          }
        }
      },
      scales: {
        x: { grid: { color: '#161b22' }, ticks: { color: '#8b949e' } },
        y: { grid: { display: false }, ticks: { color: '#c9d1d9', font: { family: '"SFMono-Regular", Consolas, monospace', size: 11 } } }
      }
    }
  });
</script>
</body>
</html>`;

  return html;
}

// ── Main ─────────────────────────────────────────────────────

function main() {
  const root = process.cwd();
  const config = readConfig(root);
  const hourlyRate = config.hourlyRate || DEFAULT_HOURLY_RATE;
  const reportStyle = config.reportStyle || "minimal";

  // Determine project name from package.json or folder name
  let projectName = path.basename(root);
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));
    if (pkg.name) projectName = pkg.name;
  } catch {}

  // Collect data
  const data = collectData(root);

  if (data.totalLines === 0) {
    console.log("\n  No source files found in the current directory.\n");
    process.exit(0);
  }

  const est = cocomoEstimate(data.totalLines, hourlyRate);
  est.hourlyRate = hourlyRate;

  const vibeStats = loadVibeStats(root);
  const gitStats = getGitStats(root);

  // Generate HTML
  const html = reportStyle === "fancy"
    ? generateFancy(projectName, data, est, vibeStats, gitStats)
    : generateMinimal(projectName, data, est, vibeStats, gitStats);

  // Write output
  const outDir = path.join(root, "stats");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "report.html");
  fs.writeFileSync(outPath, html, "utf-8");

  console.log(`\n  Report generated: ${outPath}\n`);

  // Try to open in browser
  try {
    const platform = process.platform;
    if (platform === "win32") {
      execSync(`start "" "${outPath}"`, { stdio: "ignore", shell: true });
    } else if (platform === "darwin") {
      execSync(`open "${outPath}"`, { stdio: "ignore" });
    } else {
      execSync(`xdg-open "${outPath}"`, { stdio: "ignore" });
    }
  } catch {
    // Silently ignore if browser can't be opened
  }
}

main();
