# Token Efficiency Rules

## MANDATORY: Use Vibe-Code Scripts BEFORE reading large files!

**These scripts save ~90% tokens. ALWAYS use them before opening a file with Read.**

### Available Commands

```bash
# Extract types/interfaces/enums from a file (instead of reading the whole file)
node scripts/stats/vibe-code.js types <file>

# Show directory structure (instead of reading each folder individually)
node scripts/stats/vibe-code.js tree [dir]

# Show imports of a file (for dependency checks)
node scripts/stats/vibe-code.js imports <file>

# Extract function signatures (instead of reading the whole file)
node scripts/stats/vibe-code.js functions <file>
```

### When to Use

| Situation | Instead of | Use |
|-----------|------------|-----|
| You want to know what types a file has | `Read` the whole file | `vibe-code.js types <file>` |
| You need an overview of a folder | Multiple `Read`/`ls` calls | `vibe-code.js tree <dir>` |
| You want to check a file's dependencies | `Read` and search manually | `vibe-code.js imports <file>` |
| You want to understand a file's API | `Read` the whole file | `vibe-code.js functions <file>` |

### NEVER

- Read large files (200+ lines) completely without first checking `types` or `functions`
- Explore folder structures manually with `ls` or `Glob` when `tree` does it in one call
- Waste tokens by reading code you don't need

### Token Tracking

After usage, savings are automatically tracked in `.vibe-stats.json`.
Check progress:
```bash
node scripts/stats/vibe-stats.js summary    # One-liner: total savings
node scripts/stats/vibe-stats.js report     # Detailed report
```
