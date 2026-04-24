#!/usr/bin/env node
// scripts/stats/vibe-code.js — Multi-language token-saving extraction tool
// Usage: node scripts/stats/vibe-code.js <command> <target>
//
// Commands:
//   types <file>      Extract TS interfaces, types, enums
//   tree [dir]        Clean directory structure (default: src or .)
//   imports <file>    Show import statements grouped
//   functions <file>  Extract function/method signatures
//   help              Show all commands with examples

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Stats logging — writes to .vibe-stats.json in cwd, silent on errors
// ---------------------------------------------------------------------------
function logToStats(operation, fullSize, extractedSize, filename) {
  try {
    const STATS_FILE = path.join(process.cwd(), '.vibe-stats.json');

    let stats = { sessions: [], totalSaved: 0, operationsCount: 0, created: new Date().toISOString() };
    if (fs.existsSync(STATS_FILE)) {
      stats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
    }

    const traditionalTokens = Math.ceil(fullSize / 4);
    const vibeModeTokens = Math.ceil(extractedSize / 4);
    const saved = traditionalTokens - vibeModeTokens;
    const percentage = traditionalTokens > 0 ? Math.round((saved / traditionalTokens) * 100) : 0;

    stats.sessions.push({
      timestamp: new Date().toISOString(),
      operation,
      file: filename,
      traditionalTokens,
      vibeModeTokens,
      savedTokens: saved,
      percentage,
    });

    stats.totalSaved += saved;
    stats.operationsCount += 1;

    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
  } catch (_) {
    // Silently ignore — stats logging must never break the tool
  }
}

function printSavings(label, fullSize, extractedSize) {
  const pct = fullSize > 0 ? Math.round(((fullSize - extractedSize) / fullSize) * 100) : 0;
  const fullTokens = Math.ceil(fullSize / 4);
  const extractedTokens = Math.ceil(extractedSize / 4);
  console.log(
    `\n--- Token savings: ~${fullTokens} -> ~${extractedTokens} tokens (${pct}% saved) ---`
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function resolveFile(target) {
  if (!target) {
    console.error('Error: Please provide a file path.');
    process.exit(1);
  }
  const abs = path.resolve(target);
  if (!fs.existsSync(abs)) {
    console.error(`Error: File not found — ${abs}`);
    process.exit(1);
  }
  return abs;
}

function readFile(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

// ---------------------------------------------------------------------------
// Command: types <file>
// ---------------------------------------------------------------------------
function cmdTypes(target) {
  const filePath = resolveFile(target);
  const content = readFile(filePath);
  const fullSize = Buffer.byteLength(content, 'utf8');
  const lines = content.split('\n');

  // Patterns that start a type block
  const blockStartPatterns = [
    /^export\s+(interface|type|enum)\s+/,
    /^(interface|type|enum)\s+/,
    /^export\s+declare\s+(interface|type|enum)\s+/,
    /^declare\s+(interface|type|enum)\s+/,
  ];

  // Single-line type alias: type X = string | number;
  const singleLineType = /^(export\s+)?type\s+\w+.*=.*[^{]\s*;?\s*$/;

  const extracted = [];
  let insideBlock = false;
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();

    if (!insideBlock) {
      // Check for single-line type alias
      if (singleLineType.test(trimmed) && !trimmed.includes('{')) {
        extracted.push(lines[i]);
        continue;
      }

      // Check for block start
      const isBlockStart = blockStartPatterns.some((p) => p.test(trimmed));
      if (isBlockStart) {
        insideBlock = true;
        braceDepth = 0;
        // Count braces on this line
        for (const ch of lines[i]) {
          if (ch === '{') braceDepth++;
          if (ch === '}') braceDepth--;
        }
        extracted.push(lines[i]);
        if (braceDepth <= 0 && lines[i].includes('}')) {
          insideBlock = false;
        }
        continue;
      }
    } else {
      // Inside a block — count braces
      for (const ch of lines[i]) {
        if (ch === '{') braceDepth++;
        if (ch === '}') braceDepth--;
      }
      extracted.push(lines[i]);
      if (braceDepth <= 0) {
        insideBlock = false;
        extracted.push(''); // blank separator
      }
    }
  }

  const output = extracted.join('\n').trim();
  if (!output) {
    console.log(`No types/interfaces/enums found in ${path.basename(filePath)}`);
    return;
  }

  const extractedSize = Buffer.byteLength(output, 'utf8');
  console.log(`// Types extracted from ${path.basename(filePath)}\n`);
  console.log(output);
  printSavings('types', fullSize, extractedSize);
  logToStats('types', fullSize, extractedSize, path.basename(filePath));
}

// ---------------------------------------------------------------------------
// Command: tree [dir]
// ---------------------------------------------------------------------------
function cmdTree(target) {
  const IGNORED_DIRS = new Set([
    'node_modules', '.git', '.next', 'dist', 'build', '.cache',
    '__pycache__', '.venv', 'venv', 'env', 'target', 'vendor',
    '.mypy_cache', '.pytest_cache', '.tox', 'coverage', '.nyc_output',
    '.turbo', '.parcel-cache', '.DS_Store',
  ]);

  const RELEVANT_EXTS = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
    '.py', '.go', '.rs', '.java', '.rb', '.php', '.cs',
    '.vue', '.svelte', '.astro',
  ]);

  const TEST_PATTERNS = ['.test.', '.spec.', '_test.', '_spec.'];

  // Determine root directory
  let rootDir;
  if (target) {
    rootDir = path.resolve(target);
  } else if (fs.existsSync(path.resolve('src'))) {
    rootDir = path.resolve('src');
  } else {
    rootDir = process.cwd();
  }

  if (!fs.existsSync(rootDir)) {
    console.error(`Error: Directory not found — ${rootDir}`);
    process.exit(1);
  }

  function isTestFile(name) {
    return TEST_PATTERNS.some((p) => name.includes(p));
  }

  function walk(dir, prefix, isLast) {
    const entries = [];
    try {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      // Sort: directories first, then files, both alphabetical
      const dirs = items.filter((e) => e.isDirectory() && !IGNORED_DIRS.has(e.name) && !e.name.startsWith('.'));
      const files = items.filter((e) => e.isFile() && RELEVANT_EXTS.has(path.extname(e.name)) && !isTestFile(e.name));

      dirs.sort((a, b) => a.name.localeCompare(b.name));
      files.sort((a, b) => a.name.localeCompare(b.name));

      const all = [...dirs, ...files];
      all.forEach((entry, idx) => {
        const last = idx === all.length - 1;
        const connector = last ? '\u2514\u2500\u2500 ' : '\u251C\u2500\u2500 ';
        const childPrefix = prefix + (last ? '    ' : '\u2502   ');

        if (entry.isDirectory()) {
          entries.push(`${prefix}${connector}${entry.name}/`);
          entries.push(...walk(path.join(dir, entry.name), childPrefix, last));
        } else {
          entries.push(`${prefix}${connector}${entry.name}`);
        }
      });
    } catch (_) {
      // Permission error — skip
    }
    return entries;
  }

  const relRoot = path.relative(process.cwd(), rootDir) || '.';
  const lines = [`${relRoot}/`, ...walk(rootDir, '', true)];
  console.log(lines.join('\n'));
}

// ---------------------------------------------------------------------------
// Command: imports <file>
// ---------------------------------------------------------------------------
function cmdImports(target) {
  const filePath = resolveFile(target);
  const content = readFile(filePath);
  const lines = content.split('\n');
  const ext = path.extname(filePath).toLowerCase();

  const external = [];
  const local = [];

  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
    // JS/TS imports
    const importRe = /^import\s+.+\s+from\s+['"]([^'"]+)['"]/;
    const importSideEffect = /^import\s+['"]([^'"]+)['"]/;
    const requireRe = /(?:const|let|var)\s+.+=\s*require\(\s*['"]([^'"]+)['"]\s*\)/;

    for (const line of lines) {
      const trimmed = line.trim();
      let mod = null;
      let match;

      if ((match = trimmed.match(importRe))) {
        mod = match[1];
      } else if ((match = trimmed.match(importSideEffect))) {
        mod = match[1];
      } else if ((match = trimmed.match(requireRe))) {
        mod = match[1];
      }

      if (mod) {
        const bucket = (mod.startsWith('.') || mod.startsWith('/') || mod.startsWith('@/')) ? local : external;
        bucket.push(trimmed);
      }
    }
  } else if (ext === '.py') {
    // Python imports
    const pyImport = /^(?:from\s+(\S+)\s+import|import\s+(\S+))/;
    for (const line of lines) {
      const trimmed = line.trim();
      const match = trimmed.match(pyImport);
      if (match) {
        const mod = match[1] || match[2];
        const bucket = mod.startsWith('.') ? local : external;
        bucket.push(trimmed);
      }
    }
  } else if (ext === '.go') {
    // Go imports — handle both single and block import
    let inBlock = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('import (')) {
        inBlock = true;
        continue;
      }
      if (inBlock && trimmed === ')') {
        inBlock = false;
        continue;
      }
      if (inBlock) {
        const cleaned = trimmed.replace(/^[\w.]+\s+/, '').replace(/['"]/g, '');
        if (cleaned) {
          const bucket = cleaned.includes('.') || cleaned.includes('/') ? external : external;
          // Go stdlib has no dots in most packages but uses no domain prefix
          // Packages with dots (github.com/...) are external, rest is stdlib
          const isThirdParty = cleaned.includes('.');
          (isThirdParty ? external : local).push(trimmed);
        }
        continue;
      }
      const singleMatch = trimmed.match(/^import\s+["']([^"']+)["']/);
      if (singleMatch) {
        const mod = singleMatch[1];
        const isThirdParty = mod.includes('.');
        (isThirdParty ? external : local).push(trimmed);
      }
    }
  }

  console.log(`// Imports from ${path.basename(filePath)}\n`);

  if (external.length) {
    console.log(`--- External (${external.length}) ---`);
    external.forEach((l) => console.log(`  ${l}`));
  }
  if (local.length) {
    if (external.length) console.log('');
    console.log(`--- Local (${local.length}) ---`);
    local.forEach((l) => console.log(`  ${l}`));
  }
  if (!external.length && !local.length) {
    console.log('No imports found.');
  }
}

// ---------------------------------------------------------------------------
// Command: functions <file>
// ---------------------------------------------------------------------------
function cmdFunctions(target) {
  const filePath = resolveFile(target);
  const content = readFile(filePath);
  const fullSize = Buffer.byteLength(content, 'utf8');
  const lines = content.split('\n');
  const ext = path.extname(filePath).toLowerCase();

  const signatures = [];

  // Helper: collect a possibly multi-line signature starting at lineIdx.
  // Reads lines until balanced parens and hits `{` or `=>` or `:` (Python).
  function collectSignature(startIdx, terminator) {
    let sig = '';
    let parenDepth = 0;
    let foundOpenParen = false;
    for (let i = startIdx; i < lines.length; i++) {
      const line = lines[i];
      for (const ch of line) {
        if (ch === '(') { parenDepth++; foundOpenParen = true; }
        if (ch === ')') parenDepth--;
      }
      sig += (i === startIdx ? '' : ' ') + line.trim();
      // Once parens are balanced after opening, check for terminator
      if (foundOpenParen && parenDepth <= 0) {
        // Trim everything from the block opener onward
        sig = sig.replace(/\s*\{[\s\S]*$/, '').replace(/\s*=>[\s\S]*$/, ' => ...').trimEnd();
        return sig;
      }
    }
    // Fallback: return what we have
    return sig.replace(/\s*\{[\s\S]*$/, '').trimEnd();
  }

  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
    const startPatterns = [
      /^export\s+(async\s+)?function\s+/,
      /^export\s+default\s+(async\s+)?function/,
      /^export\s+const\s+\w+\s*=\s*(async\s*)?\(/,
      /^export\s+const\s+\w+\s*=\s*(async\s*)?function/,
      /^(async\s+)?function\s+\w+/,
      /^export\s+(default\s+)?const\s+\w+\s*=\s*(React\.)?(memo|forwardRef)\(/,
    ];

    const methodPattern = /^\s*(public|private|protected|static|async|get|set)\s+[\w]+\s*\(/;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trimStart();
      let matched = false;

      for (const pattern of startPatterns) {
        if (pattern.test(trimmed)) {
          matched = true;
          break;
        }
      }
      if (!matched && methodPattern.test(trimmed)) {
        matched = true;
      }

      if (matched) {
        const sig = collectSignature(i, '{');
        if (sig.trim()) signatures.push(sig);
      }
    }
  } else if (ext === '.py') {
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trimStart();
      if (/^(async\s+)?def\s+\w+/.test(trimmed) || /^class\s+\w+/.test(trimmed)) {
        let sig = '';
        // Collect until `:` at end of line with balanced parens
        let parenDepth = 0;
        for (let j = i; j < lines.length; j++) {
          const line = lines[j];
          for (const ch of line) {
            if (ch === '(') parenDepth++;
            if (ch === ')') parenDepth--;
          }
          sig += (j === i ? '' : ' ') + line.trim();
          if (parenDepth <= 0 && line.trim().endsWith(':')) {
            sig = sig.replace(/:\s*$/, '');
            break;
          }
        }
        signatures.push(sig);
      }
    }
  } else if (ext === '.go') {
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trimStart();
      if (/^func\s+/.test(trimmed)) {
        const sig = collectSignature(i, '{');
        if (sig.trim()) signatures.push(sig);
      }
    }
  } else if (ext === '.rs') {
    const rsPatterns = [
      /^(pub\s+)?(async\s+)?fn\s+\w+/,
      /^(pub\s+)?impl\s+/,
      /^(pub\s+)?struct\s+\w+/,
      /^(pub\s+)?trait\s+\w+/,
    ];
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trimStart();
      for (const pattern of rsPatterns) {
        if (pattern.test(trimmed)) {
          const sig = collectSignature(i, '{');
          if (sig.trim()) signatures.push(sig);
          break;
        }
      }
    }
  } else if (ext === '.java' || ext === '.cs') {
    const javaPatterns = [
      /^\s*(public|private|protected|static|final|abstract|synchronized|override|virtual|async)\s+/,
      /^class\s+\w+/,
    ];
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trimStart();
      if (javaPatterns.some((p) => p.test(trimmed)) && (trimmed.includes('(') || trimmed.startsWith('class '))) {
        const sig = collectSignature(i, '{');
        if (sig.trim()) signatures.push(sig);
      }
    }
  }

  const output = signatures.join('\n');
  if (!output) {
    console.log(`No function signatures found in ${path.basename(filePath)}`);
    return;
  }

  const extractedSize = Buffer.byteLength(output, 'utf8');
  console.log(`// Function signatures from ${path.basename(filePath)}\n`);
  console.log(output);
  printSavings('functions', fullSize, extractedSize);
  logToStats('functions', fullSize, extractedSize, path.basename(filePath));
}

// ---------------------------------------------------------------------------
// Command: help
// ---------------------------------------------------------------------------
function cmdHelp() {
  console.log(`
cc-starter vibe-code — Multi-language token-saving extraction tool

Usage: node scripts/stats/vibe-code.js <command> [target]

Commands:
  types <file>        Extract TypeScript interfaces, types, enums, type aliases
  tree [dir]          Clean directory tree (default: src/ or .)
  imports <file>      Show import statements grouped (external vs local)
  functions <file>    Extract function/method signatures only
  help                Show this help message

Supported languages:
  JS/TS (.js, .jsx, .ts, .tsx, .mjs, .cjs)
  Python (.py)
  Go (.go)
  Rust (.rs)
  Java (.java)
  C# (.cs)

Examples:
  node scripts/stats/vibe-code.js types src/types/user.ts
  node scripts/stats/vibe-code.js tree src
  node scripts/stats/vibe-code.js imports lib/utils.py
  node scripts/stats/vibe-code.js functions main.go
  node scripts/stats/vibe-code.js tree

Token savings are logged to .vibe-stats.json in the current directory.
`.trim());
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const cmd = process.argv[2];
const target = process.argv[3];

switch (cmd) {
  case 'types':
    cmdTypes(target);
    break;
  case 'tree':
    cmdTree(target);
    break;
  case 'imports':
    cmdImports(target);
    break;
  case 'functions':
    cmdFunctions(target);
    break;
  case 'help':
  case '--help':
  case '-h':
    cmdHelp();
    break;
  default:
    if (cmd) {
      console.error(`Unknown command: ${cmd}\n`);
    }
    cmdHelp();
    process.exit(cmd ? 1 : 0);
}
