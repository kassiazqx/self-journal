import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const AUTH_STATE_DIR = path.resolve(__dirname, '../../playwright/.auth')

export function getExistingUserStorageStatePath() {
  return path.join(AUTH_STATE_DIR, 'existing-user.json')
}

export function getBootstrapUserStorageStatePath() {
  return path.join(AUTH_STATE_DIR, 'bootstrap-user.json')
}
