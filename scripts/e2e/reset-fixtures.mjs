import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'

import {
  getRequiredEnv,
  loadLocalE2EEnv,
  assertAllowedUserId,
  createServiceRoleClient,
} from './e2e-contract.mjs'
import {
  createDefaultCategoryRows,
  createDefaultCoreNeedRows,
  createDefaultContactRows,
} from '../../src/lib/defaultUserData.js'

const BASELINE_ENTRY_ID = '22222222-2222-4222-8222-222222222222'
const BASELINE_ENTRY_CREATED_AT = '2026-05-01T08:00:00.000Z'
const BASELINE_ENTRY_CONTENT = '今天和老板开会后，我有点紧绷，也想把事情讲清楚。'

export function buildResetPlan(envConfig) {
  return {
    existingUser: {
      userId: envConfig.existingUser.id,
      baselineEntry: {
        id: BASELINE_ENTRY_ID,
        user_id: envConfig.existingUser.id,
        content: BASELINE_ENTRY_CONTENT,
        template_type: 'learning',
        created_at: BASELINE_ENTRY_CREATED_AT,
        updated_at: BASELINE_ENTRY_CREATED_AT,
      },
    },
    bootstrapUser: {
      userId: envConfig.bootstrapUser.id,
    },
  }
}

async function deleteByUser(client, table, userId) {
  const { error } = await client.from(table).delete().eq('user_id', userId)
  if (error) throw error
}

async function deletePendingByEntryIds(client, entryIds) {
  if (entryIds.length === 0) return
  const { error } = await client.from('pending_core_needs').delete().in('entry_id', entryIds)
  if (error) throw error
}

async function deleteThreadEntriesByThreadIds(client, threadIds) {
  if (threadIds.length === 0) return
  const { error } = await client.from('thread_entries').delete().in('thread_id', threadIds)
  if (error) throw error
}

async function listIds(client, table, column, userId) {
  const { data, error } = await client.from(table).select(column).eq('user_id', userId)
  if (error) throw error
  return (data ?? []).map((row) => row[column]).filter(Boolean)
}

async function ensureUserOptionsBaseline(client, userId) {
  const { error: deleteError } = await client
    .from('user_options')
    .delete()
    .eq('user_id', userId)
    .in('field_name', ['content_category', 'core_need'])

  if (deleteError) throw deleteError

  const { error: insertError } = await client
    .from('user_options')
    .insert([
      ...createDefaultCategoryRows(userId),
      ...createDefaultCoreNeedRows(userId),
    ])

  if (insertError) throw insertError
}

async function ensureUserContactsBaseline(client, userId) {
  const { error: deleteError } = await client.from('user_contacts').delete().eq('user_id', userId)
  if (deleteError) throw deleteError

  const { error: insertError } = await client
    .from('user_contacts')
    .insert(createDefaultContactRows(userId))

  if (insertError) throw insertError
}

async function ensureExistingUserBaseline(client, plan) {
  const { userId, baselineEntry } = plan.existingUser
  assertAllowedUserId(userId, {
    existingUser: { id: userId },
    bootstrapUser: { id: plan.bootstrapUser.userId },
  })

  const threadIds = await listIds(client, 'threads', 'id', userId)
  await deleteThreadEntriesByThreadIds(client, threadIds)
  await deleteByUser(client, 'threads', userId)

  const entryIds = await listIds(client, 'journal_entries', 'id', userId)
  await deletePendingByEntryIds(client, entryIds)
  await deleteByUser(client, 'conversations', userId)
  await deleteByUser(client, 'review_letters', userId)
  await deleteByUser(client, 'journal_entries', userId)
  await deleteByUser(client, 'user_memory', userId)

  await ensureUserOptionsBaseline(client, userId)
  await ensureUserContactsBaseline(client, userId)

  const { error: entryError } = await client.from('journal_entries').insert({
    ...baselineEntry,
    sync_status: 'synced',
    deleted_at: null,
  })

  if (entryError) throw entryError

  const { error: convoError } = await client.from('conversations').insert({
    id: randomUUID(),
    user_id: userId,
    entry_id: baselineEntry.id,
    context_type: 'entry',
    messages: [],
  })

  if (convoError) throw convoError
}

async function ensureBootstrapUserBlank(client, plan) {
  const userId = plan.bootstrapUser.userId
  assertAllowedUserId(userId, {
    existingUser: { id: plan.existingUser.userId },
    bootstrapUser: { id: userId },
  })

  const threadIds = await listIds(client, 'threads', 'id', userId)
  await deleteThreadEntriesByThreadIds(client, threadIds)
  await deleteByUser(client, 'threads', userId)

  const entryIds = await listIds(client, 'journal_entries', 'id', userId)
  await deletePendingByEntryIds(client, entryIds)
  await deleteByUser(client, 'conversations', userId)
  await deleteByUser(client, 'review_letters', userId)
  await deleteByUser(client, 'journal_entries', userId)
  await deleteByUser(client, 'user_memory', userId)

  const { error: deleteOptionsError } = await client.from('user_options').delete().eq('user_id', userId)
  if (deleteOptionsError) throw deleteOptionsError

  const { error: deleteContactsError } = await client.from('user_contacts').delete().eq('user_id', userId)
  if (deleteContactsError) throw deleteContactsError
}

export async function resetFixtures(env = process.env) {
  loadLocalE2EEnv(env)
  const envConfig = getRequiredEnv(env)
  assertAllowedUserId(envConfig.existingUser.id, envConfig)
  assertAllowedUserId(envConfig.bootstrapUser.id, envConfig)

  const client = createServiceRoleClient(envConfig)
  const plan = buildResetPlan(envConfig)

  await ensureExistingUserBaseline(client, plan)
  await ensureBootstrapUserBlank(client, plan)

  return {
    status: 'ok',
    baselineEntryId: plan.existingUser.baselineEntry.id,
    existingUserId: plan.existingUser.userId,
    bootstrapUserId: plan.bootstrapUser.userId,
  }
}

const isDirectRun = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false

if (isDirectRun) {
  resetFixtures()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2))
    })
    .catch((error) => {
      console.error('[reset-fixtures] failed:', error.message)
      process.exitCode = 1
    })
}
