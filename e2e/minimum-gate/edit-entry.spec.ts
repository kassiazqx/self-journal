import { expect, test } from '@playwright/test'

import { ensureSignedIn, getExistingUserStorageStatePath } from '../helpers/auth'
import { runResetFixtures } from '../helpers/reset'

const BASELINE_ENTRY_ID = '22222222-2222-4222-8222-222222222222'
const UPDATED_ENTRY_TEXT = 'Task5 edited baseline entry text'

test.describe('@smoke minimum gate edit entry', () => {
  test.describe.configure({ mode: 'serial' })
  test.use({ storageState: getExistingUserStorageStatePath() })

  test.beforeEach(async () => {
    await runResetFixtures()
  })

  test('editing an existing entry saves new content without flashing stale text', async ({ page }) => {
    await ensureSignedIn(page)

    await page.getByRole('button', { name: '记录' }).click()
    await page.getByTestId(`record-entry-card-${BASELINE_ENTRY_ID}`).click()
    await page.getByTestId('record-detail-edit-button').click()

    await page.getByTestId('edit-entry-editor').fill(UPDATED_ENTRY_TEXT)
    await page.getByTestId('edit-entry-save-button').click()

    await expect(page.getByTestId('record-detail-raw-content')).toContainText(UPDATED_ENTRY_TEXT)

    await page.getByTestId('record-detail-back-button').click()
    await expect(page.getByTestId(`record-entry-card-${BASELINE_ENTRY_ID}`)).toContainText(UPDATED_ENTRY_TEXT)

    await page.reload()
    await expect(page.getByTestId(`record-entry-card-${BASELINE_ENTRY_ID}`)).toContainText(UPDATED_ENTRY_TEXT)
  })
})
