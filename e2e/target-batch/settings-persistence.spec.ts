import { expect, test } from '@playwright/test'

import { ensureSignedIn, getExistingUserStorageStatePath } from '../helpers/auth'
import { runResetFixtures } from '../helpers/reset'

const GEMINI_KEY = 'gemini-task8-test-key'
const DEEPSEEK_KEY = 'deepseek-task8-test-key'

async function openSettings(page) {
  await page.getByRole('button', { name: '我的' }).click()
  await expect(page.getByTestId('settings-page-root')).toBeVisible()
}

async function setProviderAndKey(page, provider, apiKey) {
  await page.getByTestId(`settings-provider-${provider}`).click()
  await page.getByTestId('settings-api-key-toggle').click()
  await page.getByTestId('settings-api-key-input').fill(apiKey)
  await page.getByTestId('settings-save-button').click()
}

test.describe('target batch settings persistence', () => {
  test.describe.configure({ mode: 'serial' })
  test.use({ storageState: getExistingUserStorageStatePath() })

  test.beforeEach(async () => {
    await runResetFixtures()
  })

  test('ai provider and api key persist after refresh and re-entering settings', async ({ page }) => {
    await ensureSignedIn(page)
    await page.evaluate(() => {
      localStorage.removeItem('ai_settings_v2')
      localStorage.removeItem('ai_settings')
    })
    await page.reload()
    await ensureSignedIn(page)

    await openSettings(page)

    await setProviderAndKey(page, 'gemini', GEMINI_KEY)
    await setProviderAndKey(page, 'deepseek', DEEPSEEK_KEY)

    await page.reload()
    await expect(page.getByTestId('settings-page-root')).toBeVisible()

    await expect(page.getByTestId('settings-provider-deepseek')).toHaveClass(/border-primary-400/)
    await page.getByTestId('settings-api-key-toggle').click()
    await expect(page.getByTestId('settings-api-key-input')).toHaveValue(DEEPSEEK_KEY)

    await page.getByRole('button', { name: '写' }).click()
    await openSettings(page)
    await expect(page.getByTestId('settings-provider-deepseek')).toHaveClass(/border-primary-400/)
    await page.getByTestId('settings-api-key-toggle').click()
    await expect(page.getByTestId('settings-api-key-input')).toHaveValue(DEEPSEEK_KEY)

    await page.getByTestId('settings-provider-gemini').click()
    await page.getByTestId('settings-api-key-toggle').click()
    await expect(page.getByTestId('settings-api-key-input')).toHaveValue(GEMINI_KEY)

    const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('ai_settings_v2') ?? 'null'))
    expect(persisted).toMatchObject({
      provider: 'deepseek',
      providers: {
        gemini: { apiKey: GEMINI_KEY },
        deepseek: { apiKey: DEEPSEEK_KEY },
      },
    })
  })
})
