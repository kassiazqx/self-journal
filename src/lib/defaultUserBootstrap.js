import { db } from './db.js'
import {
  createDefaultCategoryRows,
  createDefaultCoreNeedRows,
  createDefaultContactRows,
} from './defaultUserData.js'
import {
  getDefaultUserDataSeedVersion,
  saveDefaultUserDataSeedVersion,
} from './storage.js'

export const DEFAULT_USER_DATA_SEED_VERSION = 1

export function shouldSeedDefaultUserData({
  entryCount,
  categoryCount,
  coreNeedCount,
  contactCount,
}) {
  return entryCount === 0
    && categoryCount === 0
    && coreNeedCount === 0
    && contactCount === 0
}

export function getMissingDefaultUserDataKinds({
  categoryCount,
  coreNeedCount,
  contactCount,
}) {
  const missing = []
  if (categoryCount === 0) missing.push('content_category')
  if (coreNeedCount === 0) missing.push('core_need')
  if (contactCount === 0) missing.push('user_contacts')
  return missing
}

async function fetchDefaultDataState(userId) {
  const [
    entryResult,
    categoryResult,
    coreNeedResult,
    contactResult,
  ] = await Promise.all([
    db.from('journal_entries').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    db.from('user_options').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('field_name', 'content_category'),
    db.from('user_options').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('field_name', 'core_need'),
    db.from('user_contacts').select('id', { count: 'exact', head: true }).eq('user_id', userId),
  ])

  return {
    entryCount: entryResult.count ?? 0,
    categoryCount: categoryResult.count ?? 0,
    coreNeedCount: coreNeedResult.count ?? 0,
    contactCount: contactResult.count ?? 0,
  }
}

function isDuplicateError(error) {
  return error?.code === '23505'
}

async function insertIgnoreDuplicate(query) {
  const result = await query
  if (result?.error && !isDuplicateError(result.error)) {
    throw result.error
  }
}

async function insertDefaultRows(userId, missingKinds) {
  const jobs = []

  if (missingKinds.includes('content_category')) {
    jobs.push(insertIgnoreDuplicate(
      db.from('user_options').insert(createDefaultCategoryRows(userId)),
    ))
  }
  if (missingKinds.includes('core_need')) {
    jobs.push(insertIgnoreDuplicate(
      db.from('user_options').insert(createDefaultCoreNeedRows(userId)),
    ))
  }
  if (missingKinds.includes('user_contacts')) {
    jobs.push(insertIgnoreDuplicate(
      db.from('user_contacts').insert(createDefaultContactRows(userId)),
    ))
  }

  await Promise.all(jobs)
}

export async function ensureDefaultUserData(userId, deps = {}) {
  if (!userId) return { status: 'no-user' }

  const getVersion = deps.getVersion ?? getDefaultUserDataSeedVersion
  const saveVersion = deps.saveVersion ?? saveDefaultUserDataSeedVersion
  const fetchState = deps.fetchState ?? fetchDefaultDataState
  const insertRows = deps.insertRows ?? insertDefaultRows

  if (getVersion(userId) >= DEFAULT_USER_DATA_SEED_VERSION) {
    return { status: 'already-seeded' }
  }

  const state = await fetchState(userId)

  if (state.entryCount > 0) {
    saveVersion(userId, DEFAULT_USER_DATA_SEED_VERSION)
    return { status: 'marked-legacy' }
  }

  const missingKinds = getMissingDefaultUserDataKinds(state)

  if (missingKinds.length === 0) {
    saveVersion(userId, DEFAULT_USER_DATA_SEED_VERSION)
    return { status: 'already-present' }
  }

  if (shouldSeedDefaultUserData(state)) {
    await insertRows(userId, missingKinds)
    saveVersion(userId, DEFAULT_USER_DATA_SEED_VERSION)
    return { status: 'seeded' }
  }

  await insertRows(userId, missingKinds)
  saveVersion(userId, DEFAULT_USER_DATA_SEED_VERSION)
  return { status: 'seeded-missing' }
}
