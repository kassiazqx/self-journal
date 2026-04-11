// src/lib/reviewLetterService.js
// 回顾信触发检查 + 生成逻辑
import { db } from './db'
import { callAI } from './aiClient'
import { getReviewLetterPrompt } from './prompts'
import { getMemory } from './memory'

// ── 读取用户触发偏好 ───────────────────────────────────────────
async function getUserLetterPrefs(userId) {
  // 主存储：user_memory（多端同步）
  try {
    const memory = await getMemory(userId)
    const prefs = memory?.user_profile?.letter_prefs
    if (prefs) return prefs
  } catch { /* ignore */ }

  // 降级：localStorage
  try {
    const stored = localStorage.getItem(`letter_prefs_${userId}`)
    if (stored) return JSON.parse(stored)
  } catch { /* ignore */ }

  // 默认：每写 10 条自动触发
  return { type: 'count', count_threshold: 10, day_interval: 7, require_new_entries: true }
}

// ── 保存用户触发偏好 ──────────────────────────────────────────
export async function saveUserLetterPrefs(userId, prefs, updateMemoryFn) {
  // 主存储：user_memory
  try {
    await updateMemoryFn({ user_profile: { letter_prefs: prefs } })
  } catch (e) {
    console.error('[reviewLetter] 保存偏好到 user_memory 失败:', e)
  }
  // 降级缓存：localStorage
  try {
    localStorage.setItem(`letter_prefs_${userId}`, JSON.stringify(prefs))
  } catch { /* ignore */ }
}

// ── 生成回顾信 ────────────────────────────────────────────────
async function generateReviewLetter(userId, periodStart, prefs) {
  const periodEnd = new Date().toISOString()

  const { data: entries } = await db.from('journal_entries')
    .select('id, content, emotions, emotion_display, core_needs, created_at')
    .eq('user_id', userId)
    .gt('created_at', periodStart ?? '1970-01-01')
    .lte('created_at', periodEnd)
    .order('created_at', { ascending: true })
    .limit(20)

  if (!entries?.length) return

  const entriesText = entries.map((e, i) =>
    `[第${i + 1}条，${e.created_at.slice(0, 10)}]\n${e.content}`
  ).join('\n\n---\n\n')

  const prompt = getReviewLetterPrompt(entriesText)
  const rawLetter = await callAI(
    [{ role: 'user', content: prompt }],
    '你是用户的内心陪伴者，写一封温和的回顾信，不评判，不说教，帮助用户看见自己。',
    { maxTokens: 1000 }
  )

  // 提取末尾 JSON insights
  const insightsMatch = rawLetter.match(/```json([\s\S]*?)```/)
  let insights = {}
  if (insightsMatch) {
    try { insights = JSON.parse(insightsMatch[1]) }
    catch (e) { console.warn('[reviewLetter] insights 解析失败:', e) }
  }
  const letterContent = rawLetter.replace(/```json[\s\S]*?```/, '').trim()

  const { error } = await db.from('review_letters').insert({
    user_id: userId,
    entry_ids: entries.map(e => e.id),
    content: letterContent,
    insights,
    trigger_type: prefs.type,
    period_start: periodStart ?? entries[0]?.created_at,
    period_end: periodEnd,
    is_read: false,
  })

  if (error) console.error('[reviewLetter] 插入失败:', error.message)
}

// ── 主入口：检查是否需要生成（应用启动 / 记录页加载时调用）──
export async function checkAndGenerateLetter(userId) {
  const prefs = await getUserLetterPrefs(userId)
  if (prefs.type === 'manual') return  // 手动触发，不自动生成

  const { data: lastLetter } = await db.from('review_letters')
    .select('created_at, period_end')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const lastDate = lastLetter?.created_at ? new Date(lastLetter.created_at) : null
  const daysSinceLast = lastDate
    ? (Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24)
    : Infinity

  const { count: newEntryCount } = await db.from('journal_entries')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gt('created_at', lastLetter?.period_end ?? '1970-01-01')
    .in('template_type', ['awareness', 'emotion', 'gratitude'])

  if (prefs.require_new_entries && newEntryCount === 0) return

  const shouldGenerate =
    (prefs.type === 'days'  && daysSinceLast >= prefs.day_interval) ||
    (prefs.type === 'count' && newEntryCount >= prefs.count_threshold)

  if (shouldGenerate) {
    await generateReviewLetter(userId, lastLetter?.period_end, prefs)
  }
}

// ── 手动立即生成（设置页按钮调用）──────────────────────────────
export async function generateLetterNow(userId) {
  const { data: lastLetter } = await db.from('review_letters')
    .select('period_end')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const prefs = await getUserLetterPrefs(userId)
  await generateReviewLetter(userId, lastLetter?.period_end ?? null, prefs)
}
