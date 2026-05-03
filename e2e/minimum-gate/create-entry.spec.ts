import { expect, test } from '@playwright/test'

import { ensureSignedIn, getExistingUserStorageStatePath } from '../helpers/auth'
import { runResetFixtures } from '../helpers/reset'

const ENTRY_TEXT = 'Task4 create entry smoke text'
const FREEWRITE_LABEL = '随记'

test.describe('@smoke minimum gate create entry', () => {
  test.describe.configure({ mode: 'serial' })
  test.use({ storageState: getExistingUserStorageStatePath() })

  test.beforeEach(async () => {
    await runResetFixtures()
  })

  test('new entry saves and appears in records list', async ({ page }) => {
    await ensureSignedIn(page)

    await page.getByRole('button', { name: FREEWRITE_LABEL }).click()
    await page.getByTestId('home-editor').locator('[contenteditable="true"]').fill(ENTRY_TEXT)
    await page.getByTestId('home-done-button').click()

    await expect(page.getByTestId('records-page-title')).toBeVisible()
    await expect(page.getByTestId('records-entry-list').getByText(ENTRY_TEXT)).toBeVisible()
  })
})
