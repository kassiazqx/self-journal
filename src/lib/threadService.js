// src/lib/threadService.js
// 脉络 CRUD + 加权召回 + arc_summary 生成
import { db } from './db'
import { callAI } from './aiClient'
import { buildThreadAnalysisPrompt } from './prompts'

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

// ── 重新分析单条脉络（⚠️ 4.19：必须过滤 removed_by_user=true）──
// 只扫描从未被此脉络评估过的新 entry（不在 thread_entries 中）
// 已被 removed_by_user=true 标记的记录也跳过（用户排除意愿被尊重）
// 必须带入脉络名称 + arc_summary 作为上下文
export async function reAnalyzeThread(threadId, userId) {
  // Step 1：拉取该脉络已有的所有 thread_entries（含 removed_by_user=true 的）
  const { data: existing, error: existErr } = await db.from('thread_entries')
    .select('entry_id, removed_by_user')
    .eq('thread_id', threadId)

  if (existErr) {
    console.error('[reAnalyze] 读取已有 entries 失败:', existErr.message)
    return { newCount: 0, error: existErr }
  }

  // ⚠️ 4.19：排除所有已在 thread_entries 中的 entry_id
  // 不论 removed_by_user 是 true 还是 false，均排除
  const excludedIds = new Set((existing ?? []).map(e => e.entry_id))

  // Step 2：拉取脉络信息（需要 name + arc_summary 作为 AI 上下文）
  const { data: thread, error: threadErr } = await db.from('threads')
    .select('id, name, arc_summary')
    .eq('id', threadId)
    .eq('user_id', userId)
    .single()

  if (threadErr || !thread) {
    console.error('[reAnalyze] 读取脉络失败:', threadErr?.message)
    return { newCount: 0, error: threadErr }
  }

  // Step 3：拉取用户所有 entry 的摘要字段（候选池），排除已评估过的
  const { data: allEntries, error: allErr } = await db.from('journal_entries')
    .select('id, entry_summary, theme_hints, core_needs, emotions, category_tags, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(200)

  if (allErr) {
    console.error('[reAnalyze] 读取 entries 候选池失败:', allErr.message)
    return { newCount: 0, error: allErr }
  }

  // ⚠️ 4.19：过滤掉已评估过的（含 removed_by_user=true 的）
  const candidates = (allEntries ?? []).filter(e => !excludedIds.has(e.id))

  if (candidates.length === 0) {
    return { newCount: 0, error: null }
  }

  // Step 4：本地加权粗召回（零 token），取得高相关候选
  const existingFull = (allEntries ?? []).filter(e => excludedIds.has(e.id))
  const representativeNeeds = [...new Set(existingFull.flatMap(e => e.core_needs ?? []))]
  const representativeHints = [...new Set(existingFull.flatMap(e => e.theme_hints ?? []))]
  const representativeEmotions = [...new Set(existingFull.flatMap(e => e.emotions ?? []))]
  const representativeTags = [...new Set(existingFull.flatMap(e => e.category_tags ?? []))]

  const threadProfile = { representativeNeeds, representativeHints, representativeEmotions, representativeTags }
  const topCandidates = recallCandidateEntries(candidates, threadProfile, 15)

  if (topCandidates.length === 0) {
    return { newCount: 0, error: null }
  }

  // Step 5：AI 精筛（带入脉络名称 + arc_summary 作为上下文）
  const candidatesText = topCandidates.map((e, i) =>
    `[候选${i + 1}，id:${e.id}]\n摘要：${e.entry_summary ?? '无'}\n主题：${(e.theme_hints ?? []).join('、') || '无'}`
  ).join('\n\n---\n\n')

  const prompt = `这是用户正在追踪的脉络：「${thread.name}」
${thread.arc_summary ? `\n脉络当前轨迹：${thread.arc_summary}\n` : ''}
以下是从用户日记中初步筛选出的候选记录，请判断哪些与这条脉络相关。

${candidatesText}

请以 JSON 数组返回相关候选的 id 列表（不相关的不要包含）：
["id1", "id2", ...]
只返回 JSON 数组，不要解释。`

  let rawResponse
  try {
    rawResponse = await callAI(
      [{ role: 'user', content: prompt }],
      '你是一个精准的内容分析助手，只返回 JSON，不附加任何解释。',
      { maxTokens: 300 }
    )
  } catch (e) {
    console.error('[reAnalyze] AI 调用失败:', e.message)
    return { newCount: 0, error: e }
  }

  let matchedIds
  try {
    const cleaned = rawResponse.replace(/```json|```/g, '').trim()
    matchedIds = JSON.parse(cleaned)
    if (!Array.isArray(matchedIds)) throw new Error('不是数组')
  } catch (e) {
    console.error('[reAnalyze] JSON 解析失败:', e.message, rawResponse.slice(0, 200))
    return { newCount: 0, error: e }
  }

  // Step 6：写入 thread_entries（仅写入合法 id，跳过已存在的）
  const validIds = matchedIds.filter(id => candidates.some(e => e.id === id))
  if (validIds.length === 0) return { newCount: 0, error: null }

  await Promise.all(validIds.map(entryId =>
    db.from('thread_entries').upsert({
      thread_id: threadId,
      entry_id: entryId,
      added_by: 'ai',
      removed_by_user: false,
    })
  ))

  return { newCount: validIds.length, error: null }
}

// 查询某封回顾信关联的候选脉络（通过 review_letter_id 外键）
export async function fetchThreadsByLetterId(letterId) {
  const { data, error } = await db.from('threads')
    .select('id, name, status, arc_summary')
    .eq('review_letter_id', letterId)
    .order('created_at', { ascending: true })
  if (error) {
    console.error('[fetchThreadsByLetterId]', error.message)
    return []
  }
  return data ?? []
}

// ── 生成脉络详情分析（碎片 + 此刻这里）────────────────────────
// 用完整 content 字段（不用摘要），过滤 removed_by_user=true 的条目
export async function generateThreadAnalysis(threadId, userId) {
  const { data: rows, error: rowErr } = await db.from('thread_entries')
    .select('removed_by_user, journal_entries(id, content, created_at)')
    .eq('thread_id', threadId)
    .order('added_at', { ascending: true })

  if (rowErr) {
    console.error('[generateThreadAnalysis] 读取条目失败:', rowErr.message)
    return { error: rowErr }
  }

  const entries = (rows ?? [])
    .filter(r => !r.removed_by_user && r.journal_entries?.content)
    .map(r => ({
      date: r.journal_entries.created_at.slice(0, 10).replace(/-/g, '/'),
      content: r.journal_entries.content,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))

  if (entries.length === 0) return { error: new Error('无有效条目') }

  const { data: thread, error: threadErr } = await db.from('threads')
    .select('name')
    .eq('id', threadId)
    .eq('user_id', userId)
    .single()

  if (threadErr || !thread) return { error: threadErr }

  const prompt = buildThreadAnalysisPrompt(thread.name, entries)
  let raw
  try {
    raw = await callAI(
      [{ role: 'user', content: prompt }],
      '你是用户的内心陪伴者，帮助用户看见自己追踪的主题此刻在哪里。',
      { maxTokens: 800 }
    )
  } catch (e) {
    console.error('[generateThreadAnalysis] AI 调用失败:', e.message)
    return { error: e }
  }

  let parsed
  try {
    const cleaned = raw.replace(/```json|```/g, '').trim()
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('未找到 JSON 对象')
    parsed = JSON.parse(match[0])
    if (!Array.isArray(parsed.fragments) || typeof parsed.current_state !== 'string') {
      throw new Error('JSON 结构不符预期')
    }
  } catch (e) {
    console.error('[generateThreadAnalysis] JSON 解析失败:', e.message, raw.slice(-300))
    return { error: e }
  }

  const { error: saveErr } = await db.from('threads')
    .update({
      fragments: parsed.fragments,
      current_state: parsed.current_state.trim(),
      analysis_generated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', threadId)
    .eq('user_id', userId)

  if (saveErr) {
    console.error('[generateThreadAnalysis] 存储失败:', saveErr.message)
    return { error: saveErr }
  }

  return { fragments: parsed.fragments, current_state: parsed.current_state.trim(), error: null }
}
