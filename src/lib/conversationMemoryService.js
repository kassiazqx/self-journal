import { callAI } from './aiClient'
import { buildMemoryConversationText } from './entryFullText'
import { updateMemory, resetConversationCount } from './memory'
import { getMemoryUpdatePrompt } from './prompts'

export async function forceUpdateMemory({ messages = [] } = {}) {
  const convoText = buildMemoryConversationText(messages)

  if (!convoText) {
    await resetConversationCount()
    return { error: null }
  }

  try {
    const raw = await callAI(
      [{ role: 'user', content: getMemoryUpdatePrompt(convoText) }],
      '你是用户记忆整理助手，只返回纯 JSON，不加任何说明或 markdown。',
      { maxTokens: 600 },
    )

    const match = raw.match(/\{[\s\S]*\}/)
    if (match) {
      const { rolling_summary, user_profile } = JSON.parse(match[0])
      await updateMemory({ rolling_summary, user_profile })
    }

    await resetConversationCount()
    return { error: null }
  } catch (error) {
    console.error('[memory] 手动更新失败:', error)
    return { error }
  }
}
