import { expect, test } from '@playwright/test'

import { getBootstrapUserStorageStatePath, getE2EAccountCredentials } from '../helpers/auth'
import { readBootstrapDbState, readBootstrapSeedMarker } from '../helpers/bootstrap'
import { runResetFixtures } from '../helpers/reset'

test.describe('@smoke minimum gate bootstrap', () => {
  test.describe.configure({ mode: 'serial' })
  test.use({ storageState: getBootstrapUserStorageStatePath() })

  test.beforeEach(async () => {
    await runResetFixtures()
  })

  test('brand-new bootstrap user seeds defaults once and does not reseed on second entry', async ({ page }) => {
    const bootstrapUser = getE2EAccountCredentials().bootstrapUser

    const initialDbState = await readBootstrapDbState()
    expect(initialDbState).toEqual({
      categoryCount: 0,
      coreNeedCount: 0,
      contactCount: 0,
      entryCount: 0,
    })

    await page.goto('/')
    await expect(page.getByTestId('home-editor')).toBeVisible()

    await expect.poll(
      () => readBootstrapSeedMarker(page, bootstrapUser.id),
      { timeout: 15000 },
    ).toMatchObject({
      version: 1,
    })
    const firstSeedMarker = await readBootstrapSeedMarker(page, bootstrapUser.id)

    await expect.poll(
      () => readBootstrapDbState(),
      { timeout: 15000 },
    ).toEqual({
      categoryCount: 11,
      coreNeedCount: 20,
      contactCount: 22,
      entryCount: 0,
    })
    const firstDbState = await readBootstrapDbState()

    await page.reload()
    await expect(page.getByTestId('home-editor')).toBeVisible()

    const secondSeedMarker = await readBootstrapSeedMarker(page, bootstrapUser.id)
    expect(secondSeedMarker?.version).toBe(1)
    expect(secondSeedMarker?.savedAt).toBe(firstSeedMarker.savedAt)

    const secondDbState = await readBootstrapDbState()
    expect(secondDbState).toEqual(firstDbState)
  })
})
