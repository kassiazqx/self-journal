// 对话完成后的后台处理：保存对话 → 提取字段 → 更新记忆
// 与 UI 完全解耦，组件只调 saveConversation()
import { callAI } from './aiClient'
import { getExtractionPrompt, getMemoryUpdatePrompt } from './prompts'
import { updateEntry } from './journalService'
import { updateMemory, incrementConversationCount, resetConversationCount } from './memory'

// 每完成多少次对话才更新一次 AI 记忆
const MEMORY_UPDATE_INTERVAL = 20

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

  // 提取字段
  let extraction = {}
  try {
    const extractPrompt = `以下是我们的对话记录：\n\n${convoText}\n\n${getExtractionPrompt()}`
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
        emotions:                  extraction.emotions                ?? [],
        overall_state_score:       extraction.overall_state_score      ?? null,
        body_sensations:           extraction.body_sensations          ?? null,
        current_thought:           extraction.current_thought          ?? null,
        core_needs:                extraction.core_needs               ?? [],
        current_behavior:          extraction.current_behavior         ?? null,
        handling_rating:           extraction.handling_rating          ?? null,
        cognitive_distortion_type: extraction.cognitive_distortion_type ?? null,
        cognitive_analysis:        extraction.cognitive_analysis       ?? null,
        reflection_insight:        extraction.reflection_insight       ?? null,
        category_tags:             extraction.category_tags            ?? [],
        people_involved:           extraction.people_involved          ?? [],
      },
    }).then(({ error: e }) => { if (e) console.error('[extract] 写回失败:', e) })
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
// 返回 extraction 对象（含 emotion_display 等字段）
export async function extractFields(fullText) {
  const extractPrompt = `以下是我们的对话记录：\n\n${fullText}\n\n${getExtractionPrompt()}`
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
