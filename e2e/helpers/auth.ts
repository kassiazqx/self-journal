import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect } from '@playwright/test'

import { getRequiredEnv, loadLocalE2EEnv } from '../../scripts/e2e/e2e-contract.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const AUTH_STATE_DIR = path.resolve(__dirname, '../../playwright/.auth')

export function getExistingUserStorageStatePath() {
  return path.join(AUTH_STATE_DIR, 'existing-user.json')
}

export function getBootstrapUserStorageStatePath() {
  return path.join(AUTH_STATE_DIR, 'bootstrap-user.json')
}

export function getE2EAccountCredentials(env = process.env) {
  loadLocalE2EEnv(env)
  const config = getRequiredEnv(env)
  return {
    existingUser: config.existingUser,
    bootstrapUser: config.bootstrapUser,
  }
}

export async function ensureSignedIn(page, account = 'existingUser') {
  await page.goto('/')

  if (await page.getByTestId('home-editor').count()) {
    return
  }

  const credentials = getE2EAccountCredentials()
  const target = credentials[account]

  await page.getByPlaceholder('your@email.com').fill(target.email)
  await page.getByPlaceholder('请输入密码').fill(target.password)
  await page.getByRole('button', { name: '登录' }).last().click()

  await expect(page.getByTestId('home-editor')).toBeVisible()
}
