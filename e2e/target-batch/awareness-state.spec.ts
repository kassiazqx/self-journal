import { expect, test } from '@playwright/test'

import { installAIStub } from '../helpers/aiStub'
import { ensureSignedIn, getExistingUserStorageStatePath } from '../helpers/auth'
import { runResetFixtures } from '../helpers/reset'

const LOCAL_ENTRY_TEXT = 'Task7 local awareness persistence entry, 今天有点难受也有点乱，我想把这件事慢慢理清。'
const LOCAL_ENTRY_PREVIEW = 'Task7 local awareness persistence entry, 今天有点难受也有点乱，我想把这件事慢慢'
const LOCAL_FIRST_ANSWER = 'Task7 local first answer'
const LOCAL_SECOND_ANSWER = 'Task7 local second answer'

const SWITCH_ENTRY_TEXT = 'Task7 switch awareness persistence entry, 今天有点委屈，也想更深入看看自己在意什么。'
const SWITCH_ENTRY_PREVIEW = 'Task7 switch awareness persistence entry, 今天有点委屈，也想更深入看看自己在意'
const SWITCH_LOCAL_ANSWER = 'Task7 switch local answer'
const SWITCH_AI_ANSWER = 'Task7 switch ai answer'
const STUBBED_AI_TEXT = '这是 Task7 模式切换测试的固定 AI 回复。'

async function openRecordFromList(page, previewText) {
  await page.getByTestId('records-entry-list').getByText(previewText).first().click()
}

test.describe('target batch awareness state', () => {
  test.describe.configure({ mode: 'serial' })
  test.use({ storageState: getExistingUserStorageStatePath() })

  test.beforeEach(async () => {
    await runResetFixtures()
  })

  test('local awareness keeps answers across forward/back and after reopening from persisted conversation', async ({ page }) => {
    await ensureSignedIn(page)

    await page.getByTestId('home-editor').locator('[contenteditable="true"]').fill(LOCAL_ENTRY_TEXT)
    await page.getByTestId('home-done-button').click()

    await expect(page.getByTestId('awareness-answer-input')).toBeVisible()
    await page.getByTestId('awareness-answer-input').fill(LOCAL_FIRST_ANSWER)
    await page.getByTestId('awareness-next-button').click()

    await expect(page.getByTestId('awareness-answer-input')).toHaveValue('')
    await page.getByTestId('awareness-answer-input').fill(LOCAL_SECOND_ANSWER)

    await page.getByTestId('awareness-back-button').click()
    await expect(page.getByTestId('awareness-answer-input')).toHaveValue(LOCAL_FIRST_ANSWER)

    await page.getByTestId('awareness-next-button').click()
    await expect(page.getByTestId('awareness-answer-input')).toHaveValue(LOCAL_SECOND_ANSWER)

    await page.getByRole('button', { name: '保存' }).click()

    await expect(page.getByTestId('records-page-title')).toBeVisible()
    await openRecordFromList(page, LOCAL_ENTRY_PREVIEW)
    await expect(page.getByRole('button', { name: /深度觉察/ })).toBeVisible()
    await page.getByRole('button', { name: /深度觉察/ }).click()

    await expect(page.getByTestId('awareness-answer-input')).toBeVisible()
    await page.getByTestId('awareness-back-button').click()
    await expect(page.getByTestId('awareness-answer-input')).toHaveValue(LOCAL_SECOND_ANSWER)

    await page.getByTestId('awareness-back-button').click()
    await expect(page.getByTestId('awareness-answer-input')).toHaveValue(LOCAL_FIRST_ANSWER)
  })

  test('switching between local and ai keeps progress and persists both answers', async ({ page }) => {
    const aiStub = await installAIStub(page, {
      provider: 'gemini',
      expectedContextSubstring: SWITCH_LOCAL_ANSWER,
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

    await page.getByTestId('home-editor').locator('[contenteditable="true"]').fill(SWITCH_ENTRY_TEXT)
    await page.getByTestId('home-done-button').click()

    await expect(page.getByTestId('awareness-answer-input')).toBeVisible()
    await page.getByTestId('awareness-answer-input').fill(SWITCH_LOCAL_ANSWER)
    await page.getByTestId('awareness-toggle-ai').click()

    await expect(page.getByText(STUBBED_AI_TEXT)).toBeVisible()
    await aiStub.assertRequestObserved()

    await page.getByTestId('awareness-answer-input').fill(SWITCH_AI_ANSWER)
    await page.getByTestId('awareness-toggle-ai').click()

    await expect(page.getByTestId('awareness-toggle-ai')).toContainText('深入觉察')
    await expect(page.getByTestId('awareness-answer-input')).toHaveValue('')

    await page.getByRole('button', { name: '保存' }).click()

    await expect(page.getByTestId('records-page-title')).toBeVisible()
    await openRecordFromList(page, SWITCH_ENTRY_PREVIEW)
    await expect(page.getByRole('button', { name: /深度觉察/ })).toBeVisible()
    await page.getByRole('button', { name: /深度觉察/ }).click()

    await expect(page.getByTestId('awareness-answer-input')).toBeVisible()
    await page.getByTestId('awareness-back-button').click()
    await expect(page.getByText(STUBBED_AI_TEXT)).toBeVisible()
    await expect(page.getByTestId('awareness-answer-input')).toHaveValue(SWITCH_AI_ANSWER)

    await page.getByTestId('awareness-back-button').click()
    await expect(page.getByTestId('awareness-answer-input')).toHaveValue(SWITCH_LOCAL_ANSWER)
  })
})
