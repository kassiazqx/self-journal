// 对话完成后的后台处理：保存对话 → 提取字段 → 更新记忆
// 与 UI 完全解耦，组件只调 saveConversation()
import { callAI } from './aiClient'
import { getExtractionPrompt, getMemoryUpdatePrompt } from './prompts'
import { updateEntry } from './journalService'
import { updateMemory, incrementConversationCount, resetConversationCount } from './memory'
import { db } from './db'
import { createPendingCoreNeed } from './coreNeedsService'

// 每完成多少次对话才更新一次 AI 记忆
const MEMORY_UPDATE_INTERVAL = 20

// 新用户默认 11 个内容大类标签（user_options 为空时使用并写入）
const DEFAULT_CATEGORY_TAGS = ['工作','家庭','恋爱与亲密关系','个人成长','学习','财务','运动健康','社交','玩乐休闲','灵性修行','日常生活']

// ─── 获取用户核心需求词库 ─────────────────────────────────────
async function getUserCoreNeeds(userId) {
  const { data } = await db.from('user_options')
    .select('option_value')
    .eq('user_id', userId)
    .eq('field_name', 'core_need')
    .order('sort_order', { ascending: true })
  return (data ?? []).map(r => r.option_value)
}

// ─── 获取用户标签（空时自动 seed）────────────────────────────────
async function getUserCategoryTags(userId) {
  const { data } = await db.from('user_options')
    .select('option_value, sort_order')
    .eq('user_id', userId)
    .eq('field_name', 'content_category')
    .order('sort_order', { ascending: true })
  if ((data ?? []).length > 0) {
    return data.map(r => r.option_value)
  }
  // 新用户：种入默认标签，并返回
  const rows = DEFAULT_CATEGORY_TAGS.map((label, i) => ({
    user_id: userId,
    field_name: 'content_category',
    option_value: label,
    sort_order: i,
  }))
  await db.from('user_options').insert(rows)
  return DEFAULT_CATEGORY_TAGS
}

// ─── 手动触发记忆更新（设置页按钮调用）──────────────────────
// 传入最近一次对话的 visibleMsgs，立即执行记忆更新并重置计数
// 如果没有最近对话，也可以传空数组（只重置计数）
export async function forceUpdateMemory({ visibleMsgs = [] } = {}) {

  if (visibleMsgs.length === 0) {
    await resetConversationCount()
    return { error: null }
  }

  const convoText = visibleMsgs
    .map(m => `${m.role === 'user' ? '我' : 'AI'}：${m.content}`)
    .join('\n\n')

  try {
    const memPrompt = getMemoryUpdatePrompt(convoText)
    const raw = await callAI(
      [{ role: 'user', content: memPrompt }],
      '你是用户记忆整理助手，只返回纯 JSON，不加任何说明或 markdown。',
      { maxTokens: 600 }
    )
    const match = raw.match(/\{[\s\S]*\}/)
    if (match) {
      const { rolling_summary, user_profile } = JSON.parse(match[0])
      await updateMemory({ rolling_summary, user_profile })
    }
    await resetConversationCount()
    return { error: null }
  } catch (e) {
    console.error('[memory] 手动更新失败:', e)
    return { error: e }
  }
}

// ─── 主入口 ──────────────────────────────────────────────────
// visibleMsgs: [{ role, content }]  已过滤 hidden 的消息列表
// entry: { id, user_id }
// 返回 { error }：只有主保存（full_conversation）失败才抛错
// 字段提取和记忆更新在后台静默执行，失败只打 console.error
export async function saveConversation({ visibleMsgs, entry }) {
  const convoRecord = visibleMsgs.map(m => ({ role: m.role, content: m.content }))

  // 1. 保存对话记录（调用方等待这一步）
  const { error } = await updateEntry({
    id: entry.id,
    userId: entry.user_id,
    fields: { full_conversation: convoRecord },
  })
  if (error) return { error }

  // 2. 后台：提取字段 + 更新记忆（fire-and-forget，不阻塞跳转）
  _backgroundProcess({ visibleMsgs, entry }).catch(() => {})

  return { error: null }
}

// ─── 后台处理（不 await，失败静默）────────────────────────────
async function _backgroundProcess({ visibleMsgs, entry }) {
  const convoText = visibleMsgs
    .map(m => `${m.role === 'user' ? '我' : 'AI'}：${m.content}`)
    .join('\n\n')

  // 提取字段（并行拉用户标签和核心需求词库）
  let extraction = {}
  try {
    const [userCategoryTags, userCoreNeeds] = await Promise.all([
      getUserCategoryTags(entry.user_id),
      getUserCoreNeeds(entry.user_id),
    ])
    const extractPrompt = `以下是我们的对话记录：\n\n${convoText}\n\n${getExtractionPrompt(userCategoryTags, userCoreNeeds)}`
    const raw = await callAI(
      [{ role: 'user', content: extractPrompt }],
      '你是数据提取助手，只返回纯 JSON，不加任何说明或 markdown。',
      { maxTokens: 1200 }
    )
    const match = raw.match(/\{[\s\S]*\}/)
    if (match) extraction = JSON.parse(match[0])
  } catch (e) {
    console.error('[extract] 提取失败:', e)
  }

  // 写回提取结果
  if (Object.keys(extraction).length > 0) {
    updateEntry({
      id: entry.id,
      userId: entry.user_id,
      fields: {
        entry_summary:             extraction.entry_summary             ?? null,
        theme_hints:               extraction.theme_hints               ?? [],
        emotions:                  extraction.emotions                  ?? [],
        overall_state_score:       extraction.overall_state_score       ?? null,
        body_sensations:           extraction.body_sensations           ?? null,
        current_thought:           extraction.current_thought           ?? null,
        core_needs:                extraction.core_needs                ?? [],
        current_behavior:          extraction.current_behavior          ?? null,
        handling_rating:           extraction.handling_rating           ?? null,
        cognitive_distortion_type: extraction.cognitive_distortion_type ?? null,
        cognitive_analysis:        extraction.cognitive_analysis        ?? null,
        reflection_insight:        extraction.reflection_insight        ?? null,
        category_tags:             extraction.category_tags             ?? [],
        people_involved:           extraction.people_involved           ?? [],
      },
    }).then(({ error: e }) => { if (e) console.error('[extract] 写回失败:', e) })

    // 写入未匹配词条到 pending_core_needs
    const unmatched = extraction.unmatched_core_needs
    if (Array.isArray(unmatched) && unmatched.length > 0) {
      await Promise.all(
        unmatched.map(word => createPendingCoreNeed(entry.id, word).catch(() => {}))
      )
    }
  }

  // 500ms 间隔后更新记忆（仅每 MEMORY_UPDATE_INTERVAL 次对话触发一次）
  await new Promise(r => setTimeout(r, 500))
  try {
    const newCount = await incrementConversationCount()
    if (newCount === null || newCount % MEMORY_UPDATE_INTERVAL !== 0) {
      // 未到阈值，跳过记忆更新
      return
    }
    const memPrompt = getMemoryUpdatePrompt(convoText)
    const raw = await callAI(
      [{ role: 'user', content: memPrompt }],
      '你是用户记忆整理助手，只返回纯 JSON，不加任何说明或 markdown。',
      { maxTokens: 600 }
    )
    const match = raw.match(/\{[\s\S]*\}/)
    if (match) {
      const { rolling_summary, user_profile } = JSON.parse(match[0])
      await updateMemory({ rolling_summary, user_profile })
    }
  } catch (e) {
    console.error('[memory] 记忆更新失败:', e)
  }
}

// ─── 手动 AI 分析（RecordDetail 页面「✦ AI 分析」按钮触发）───────
// fullText：原始写作 + 觉察对话内容拼接
// hasConversation：true 表示有觉察对话，false 表示只有日记原文
// userId：用于拉取用户自定义 category_tags
// 返回 extraction 对象（含 emotion_display 等字段）
export async function extractFields(fullText, hasConversation = true, userId = null) {
  const [userCategoryTags, userCoreNeeds] = await Promise.all([
    userId ? getUserCategoryTags(userId) : Promise.resolve([]),
    userId ? getUserCoreNeeds(userId) : Promise.resolve([]),
  ])
  const intro = hasConversation
    ? `以下是我们的对话记录：\n\n${fullText}\n\n`
    : `以下是用户的一篇日记原文：\n\n${fullText}\n\n请根据日记内容进行推断和分析，即使某些信息没有明确说明，也请基于文字线索给出合理推断（仅当完全无法判断时才填 null）。\n\n`
  const extractPrompt = intro + getExtractionPrompt(userCategoryTags, userCoreNeeds)
  const raw = await callAI(
    [{ role: 'user', content: extractPrompt }],
    '你是数据提取助手，只返回纯 JSON，不加任何说明或 markdown。',
    { maxTokens: 1200 }
  )
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) return {}
  try {
    return JSON.parse(match[0])
  } catch (e) {
    console.error('[extractFields] JSON 解析失败:', e)
    return {}
  }
}
