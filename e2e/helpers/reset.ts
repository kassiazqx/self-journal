import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT_DIR = path.resolve(__dirname, '../..')
const RESET_SCRIPT = path.join(ROOT_DIR, 'scripts/e2e/reset-fixtures.mjs')
const AUTH_SCRIPT = path.join(ROOT_DIR, 'scripts/e2e/create-auth-state.mjs')

export async function runResetFixtures() {
  await execFileAsync('node', [RESET_SCRIPT], {
    cwd: ROOT_DIR,
    env: process.env,
  })
}

export async function createAuthStates() {
  await execFileAsync('node', [AUTH_SCRIPT], {
    cwd: ROOT_DIR,
    env: process.env,
  })
}

export async function prepareE2EState() {
  await runResetFixtures()
  await createAuthStates()
}
