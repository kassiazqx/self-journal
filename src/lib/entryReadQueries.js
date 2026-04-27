import { db } from './db'
import { getDayRange } from './dateUtils'

export async function queryAllEntries({ userId }) {
  return db
    .from('journal_entries')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
}

export async function queryEntriesForInsights({ userId }) {
  return db
    .from('journal_entries')
    .select('id, created_at, emotions, emotion_display, overall_state_score, category_tags, template_type')
    .eq('user_id', userId)
}

export async function queryEntriesForAI({ userId, ids } = {}) {
  let query = db
    .from('journal_entries')
    .select('id, content, created_at, emotions, emotion_display, entry_summary, category_tags, people_involved')
    .eq('user_id', userId)

  if (ids?.length) {
    query = query.in('id', ids)
  }

  return query
}

export async function queryTodayGratitudeCount(userId) {
  const { start, end } = getDayRange(new Date())

  const { count, error } = await db
    .from('journal_entries')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('template_type', 'gratitude')
    .gte('created_at', start.toISOString())
    .lt('created_at', end.toISOString())

  return { count: Math.min(count ?? 0, 3), error }
}
