import { getRequiredEnv, loadLocalE2EEnv } from '../scripts/e2e/e2e-contract.mjs'
import { prepareE2EState } from './helpers/reset'

function hasConfiguredE2EEnv() {
  try {
    loadLocalE2EEnv(process.env)
    getRequiredEnv(process.env)
    return true
  } catch {
    return false
  }
}

export default async function globalSetup() {
  if (!hasConfiguredE2EEnv()) return
  await prepareE2EState()
}
