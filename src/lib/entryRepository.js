import { db } from './db'
import { JOURNAL_ENTRY_FULL_SELECT } from './entrySnapshots'
import { store } from '../store'
import { entryActions, entrySelectors } from '../store/entrySlice'

const entryRequestCache = new Map()

function selectEntry(id) {
  return entrySelectors.selectById(store.getState(), id) ?? null
}

async function fetchEntry(id, queryBuilder) {
  const request = queryBuilder()
  const result = await request
  if (result.data) {
    store.dispatch(entryActions.upsertIfNewer(result.data))
  }
  return result
}

export async function getEntryById(id, { force = false } = {}) {
  if (!id) return { data: null, error: new Error('entry id required') }

  const cached = selectEntry(id)
  if (!force && cached && !cached._stale) {
    return { data: cached, error: null }
  }

  if (entryRequestCache.has(id)) {
    return entryRequestCache.get(id)
  }

  const request = fetchEntry(id, () => (
    db
      .from('journal_entries')
      .select(JOURNAL_ENTRY_FULL_SELECT)
      .eq('id', id)
      .single()
  )).finally(() => {
    entryRequestCache.delete(id)
  })

  entryRequestCache.set(id, request)
  return request
}

export async function listEntries({ userId, from = 0, limit = 50 } = {}) {
  const result = await db
    .from('journal_entries')
    .select(JOURNAL_ENTRY_FULL_SELECT)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(from, from + limit - 1)

  if (result.data) {
    store.dispatch(entryActions.upsertManyIfNewer(result.data))
  }

  return result
}

export function primeEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return
  store.dispatch(entryActions.upsertManyIfNewer(entries))
}

export async function createEntry(entry) {
  const result = await db
    .from('journal_entries')
    .insert(entry)
    .select(JOURNAL_ENTRY_FULL_SELECT)
    .single()

  if (result.data) {
    store.dispatch(entryActions.upsertIfNewer(result.data))
  }

  return result
}

export async function updateEntry({ id, userId, fields }) {
  const result = await db
    .from('journal_entries')
    .update(fields)
    .eq('id', id)
    .eq('user_id', userId)
    .select(JOURNAL_ENTRY_FULL_SELECT)
    .single()

  if (result.data) {
    store.dispatch(entryActions.upsertIfNewer(result.data))
  }

  return result
}

export async function deleteEntry({ id, userId }) {
  const result = await db
    .from('journal_entries')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)

  if (!result.error) {
    store.dispatch(entryActions.removeOne(id))
  }

  return result
}

export async function deleteEntries({ ids, userId }) {
  const result = await db
    .from('journal_entries')
    .delete()
    .in('id', ids)
    .eq('user_id', userId)

  if (!result.error) {
    store.dispatch(entryActions.removeMany(ids))
  }

  return result
}

export function invalidateEntry(id) {
  if (!id) return
  store.dispatch(entryActions.markStale(id))
}
