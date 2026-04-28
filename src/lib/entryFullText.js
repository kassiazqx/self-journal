function normalizeContent(content) {
  return typeof content === 'string' ? content.trim() : ''
}

function isPromptType(nodeType) {
  return nodeType === 'local_prompt' || nodeType === 'ai_prompt'
}

function getExpectedAnswerType(nodeType) {
  if (nodeType === 'local_prompt') return 'local_answer'
  if (nodeType === 'ai_prompt') return 'ai_answer'
  return null
}

function formatConversationLine(message) {
  const content = normalizeContent(message?.content)
  if (!content) return null

  if (message.nodeType === 'local_prompt') return `本地问题：${content}`
  if (message.nodeType === 'local_answer') return `我的回答：${content}`
  if (message.nodeType === 'ai_prompt') return `AI问题：${content}`
  if (message.nodeType === 'ai_answer') return `我的回答：${content}`
  return null
}

export function getAnsweredConversationTurns(messages = []) {
  const normalized = messages
    .map((message) => {
      const content = normalizeContent(message?.content)
      if (!content) return null
      return { ...message, content }
    })
    .filter(Boolean)

  const turns = []

  for (let index = 0; index < normalized.length; index += 1) {
    const current = normalized[index]
    if (!isPromptType(current.nodeType)) continue

    const expectedAnswerType = getExpectedAnswerType(current.nodeType)
    const next = normalized[index + 1]
    if (next?.nodeType !== expectedAnswerType) continue

    turns.push(current, next)
    index += 1
  }

  return turns
}

export function hasAnsweredConversationTurns(messages = []) {
  return getAnsweredConversationTurns(messages).length > 0
}

export function pickLatestAnsweredConversation(rows = []) {
  return rows.find((row) => hasAnsweredConversationTurns(row?.messages ?? [])) ?? null
}

export function buildEntryFullText({ entry, messages = [] }) {
  const parts = []
  const raw = normalizeContent(entry?.content)

  if (raw) {
    parts.push(`原始写作：\n${raw}`)
  }

  for (const message of getAnsweredConversationTurns(messages)) {
    const line = formatConversationLine(message)
    if (line) parts.push(line)
  }

  return parts.join('\n\n')
}

export function buildConversationMessageIndex(rows = []) {
  return new Map(rows.map((row) => [row.entry_id, row.messages ?? []]))
}

export function buildMemoryConversationText(messages = []) {
  return getAnsweredConversationTurns(messages)
    .map(formatConversationLine)
    .filter(Boolean)
    .join('\n\n')
}

export function buildReviewLetterRichContent({ entry, messages = [] }) {
  const parts = [buildEntryFullText({ entry, messages })]
  const supplements = []

  if (entry?.current_thought) supplements.push(`当下念头：${entry.current_thought}`)
  if (entry?.body_sensations) supplements.push(`身体感受：${entry.body_sensations}`)
  if (entry?.core_needs?.length) supplements.push(`核心需求：${entry.core_needs.join('、')}`)
  if (entry?.cognitive_analysis) supplements.push(`认知：${entry.cognitive_analysis}`)
  if (entry?.reflection_insight) supplements.push(`洞见：${entry.reflection_insight}`)

  if (supplements.length > 0) {
    parts.push(`后续整理字段：\n${supplements.join('\n')}`)
  }

  return parts.filter(Boolean).join('\n\n')
}
