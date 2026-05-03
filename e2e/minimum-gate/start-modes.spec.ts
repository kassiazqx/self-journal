import { expect, test } from '@playwright/test'

import { installAIStub } from '../helpers/aiStub'
import { ensureSignedIn, getExistingUserStorageStatePath } from '../helpers/auth'
import { runResetFixtures } from '../helpers/reset'

const LOCAL_ENTRY_TEXT = 'Task4 local awareness entry'
const AI_ENTRY_TEXT = 'Task4 ai awareness entry'
const STUBBED_AI_TEXT = '这是自动化测试专用 AI 固定回复。'

test.describe('@smoke minimum gate start modes', () => {
  test.describe.configure({ mode: 'serial' })
  test.use({ storageState: getExistingUserStorageStatePath() })

  test.beforeEach(async () => {
    await runResetFixtures()
  })

  test('new entry starts in local awareness mode by default', async ({ page }) => {
    await ensureSignedIn(page)

    await page.getByTestId('home-editor').locator('[contenteditable="true"]').fill(LOCAL_ENTRY_TEXT)
    await page.getByTestId('home-done-button').click()

    await expect(page.getByTestId('awareness-back-button')).toBeVisible()
    await expect(page.getByTestId('awareness-answer-input')).toBeVisible()
    await expect(page.getByTestId('awareness-toggle-ai')).not.toContainText('暂停引导')
  })

  test('new entry enters ai awareness mode from ✦ and sends real ai request to stub', async ({ page }) => {
    const aiStub = await installAIStub(page, {
      provider: 'gemini',
      expectedContextSubstring: AI_ENTRY_TEXT,
      responseText: STUBBED_AI_TEXT,
    })

    await ensureSignedIn(page)
    await page.evaluate(() => {
      localStorage.setItem('ai_settings_v2', JSON.stringify({
        provider: 'gemini',
        providers: {
          gemini: { apiKey: 'e2e-test-key' },
          deepseek: { apiKey: '' },
        },
      }))
    })
    await page.reload()
    await ensureSignedIn(page)

    await page.getByTestId('home-editor').locator('[contenteditable="true"]').fill(AI_ENTRY_TEXT)
    await page.getByTestId('home-start-ai-awareness').click()

    await expect(page.getByTestId('awareness-back-button')).toBeVisible()
    await expect(page.getByText(STUBBED_AI_TEXT)).toBeVisible()
    await expect(page.getByTestId('awareness-toggle-ai')).toContainText('暂停引导')
    await aiStub.assertRequestObserved()
  })
})
