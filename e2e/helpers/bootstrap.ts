import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT_DIR = path.resolve(__dirname, '../..')
const BOOTSTRAP_STATE_SCRIPT = path.join(ROOT_DIR, 'scripts/e2e/bootstrap-state.mjs')

export async function readBootstrapDbState() {
  const { stdout } = await execFileAsync('node', [BOOTSTRAP_STATE_SCRIPT], {
    cwd: ROOT_DIR,
    env: process.env,
  })

  return JSON.parse(stdout)
}

export async function readBootstrapSeedMarker(page, userId) {
  return page.evaluate((targetUserId) => {
    const raw = localStorage.getItem(`default_user_data_seed_${targetUserId}`)
    return raw ? JSON.parse(raw) : null
  }, userId)
}
