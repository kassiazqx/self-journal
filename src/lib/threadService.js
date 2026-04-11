// src/lib/threadService.js
// 脉络 CRUD + 加权召回 + arc_summary 生成
import { db } from './db'
import { callAI } from './aiClient'

// ── 加权评分（纯函数）────────────────────────────────────────
export function scoreEntryForThread(entry, thread) {
  let score = 0
  const overlap = (arr1, arr2) =>
    (arr1 ?? []).filter(x => (arr2 ?? []).includes(x)).length
  score += overlap(entry.core_needs, thread.representativeNeeds) * 3
  score += overlap(entry.theme_hints, thread.representativeHints) * 3
  score += overlap(entry.emotions, thread.representativeEmotions) * 1
  score += overlap(entry.category_tags, thread.representativeTags) * 1
  return score
}

// ── arc_summary prompt（纯函数）──────────────────────────────
export function buildArcSummaryPrompt(thread, entries) {
  const entriesText = entries.map((e, i) =>
    `[第${i + 1}条，${e.created_at?.slice(0, 10) ?? ''}]\n${e.entry_summary ?? ''}\n主题：${(e.theme_hints ?? []).join('、') || '无'}`
  ).join('\n\n')

  return `这是用户持续追踪的主题脉络：「${thread.name}」

以下是按时间排列的相关记录摘要：

${entriesText}

请写一段变化轨迹（arc_summary）：
- 使用试探性语言：「这段时间似乎…」「也许正在从…走向…」
- 聚焦变化，不做永久性定性（禁止「你是一个…的人」）
- 100~200字，直接开始叙事，不加标题`
}

// ── 查询 ──────────────────────────────────────────────────────
export async function fetchThreads(userId) {
  return db.from('threads')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
}

export async function fetchThreadWithEntries(threadId) {
  const [threadRes, entriesRes] = await Promise.all([
    db.from('threads').select('*').eq('id', threadId).single(),
    db.from('thread_entries')
      .select('entry_id, added_at, added_by, journal_entries(id, entry_summary, created_at, template_type)')
      .eq('thread_id', threadId)
      .order('added_at', { ascending: true }),
  ])
  return { thread: threadRes.data, entries: entriesRes.data ?? [], error: threadRes.error }
}

// ── 写入 ──────────────────────────────────────────────────────
export async function createThread(userId, { name, status = 'confirmed' }) {
  return db.from('threads')
    .insert({ user_id: userId, name, status })
    .select('id, name, status')
    .single()
}

export async function updateThread(threadId, userId, fields) {
  return db.from('threads')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', threadId)
    .eq('user_id', userId)
}

export async function deleteThread(threadId, userId) {
  return db.from('threads')
    .delete()
    .eq('id', threadId)
    .eq('user_id', userId)
}

export async function addEntryToThread(threadId, entryId, addedBy = 'user') {
  return db.from('thread_entries')
    .upsert({ thread_id: threadId, entry_id: entryId, added_by: addedBy })
}

export async function removeEntryFromThread(threadId, entryId) {
  return db.from('thread_entries')
    .delete()
    .eq('thread_id', threadId)
    .eq('entry_id', entryId)
}

// ── 本地加权召回（零 token）──────────────────────────────────
export function recallCandidateEntries(candidates, thread, topN = 20) {
  return candidates
    .map(entry => ({ entry, score: scoreEntryForThread(entry, thread) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map(({ entry }) => entry)
}

// ── 生成 arc_summary ──────────────────────────────────────────
export async function refreshArcSummary(threadId, userId) {
  const { thread, entries } = await fetchThreadWithEntries(threadId)
  const entryData = entries
    .map(e => e.journal_entries)
    .filter(Boolean)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))

  if (!thread || entryData.length < 2) return

  const prompt = buildArcSummaryPrompt(thread, entryData)
  let arcSummary
  try {
    arcSummary = await callAI(
      [{ role: 'user', content: prompt }],
      '你是一位温和的觉察引导者，帮助用户看见自己随时间的变化。',
      { maxTokens: 400 }
    )
  } catch (e) {
    console.error('[threadService] arc_summary 生成失败:', e.message)
    return
  }

  await db.from('threads')
    .update({
      arc_summary: arcSummary.trim(),
      arc_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', threadId)
    .eq('user_id', userId)
}
