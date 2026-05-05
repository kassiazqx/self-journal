import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const execFileAsync = promisify(execFile)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT_DIR = path.resolve(__dirname, '..')
const HOOKS_DIR = path.join(ROOT_DIR, '.githooks')

export async function setupGitHooks() {
  await execFileAsync('git', ['config', '--local', 'core.hooksPath', HOOKS_DIR], {
    cwd: ROOT_DIR,
  })
  return { status: 'ok', hooksPath: HOOKS_DIR }
}

const isDirectRun = process.argv[1] === __filename

if (isDirectRun) {
  setupGitHooks()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2))
    })
    .catch((error) => {
      console.error('[setup-git-hooks] failed:', error.message)
      process.exitCode = 1
    })
}
