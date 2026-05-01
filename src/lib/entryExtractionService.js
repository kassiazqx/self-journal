import { callAI } from './aiClient'
import { db } from './db'
import { getExtractionPrompt } from './prompts'

async function getUserCategoryTags(userId) {
  const { data } = await db.from('user_options')
    .select('option_value, sort_order')
    .eq('user_id', userId)
    .eq('field_name', 'content_category')
    .order('sort_order', { ascending: true })

  return (data ?? []).map((row) => row.option_value)
}

async function getUserCoreNeeds(userId) {
  const { data } = await db.from('user_options')
    .select('option_value')
    .eq('user_id', userId)
    .eq('field_name', 'core_need')
    .order('sort_order', { ascending: true })

  return (data ?? []).map((row) => row.option_value)
}

export async function extractEntryFields(fullText, { userId } = {}) {
  const [userCategoryTags, userCoreNeeds] = await Promise.all([
    userId ? getUserCategoryTags(userId) : Promise.resolve([]),
    userId ? getUserCoreNeeds(userId) : Promise.resolve([]),
  ])

  const prompt = `以下是用户这条记录的完整内容：\n\n${fullText}\n\n${getExtractionPrompt(userCategoryTags, userCoreNeeds)}`
  const raw = await callAI(
    [{ role: 'user', content: prompt }],
    '你是数据提取助手，只返回纯 JSON，不加任何说明或 markdown。',
    { maxTokens: 1200 },
  )

  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) return {}

  try {
    return JSON.parse(match[0])
  } catch (error) {
    console.error('[extractEntryFields] JSON 解析失败:', error)
    return {}
  }
}
