export function normalizeConversationMessages(messages = []) {
  const filtered = messages.filter(msg => msg?.nodeType !== 'raw_entry')
  const ordered = []
  const byPromptId = new Map()

  for (const msg of filtered) {
    const key = msg.promptId || msg.id
    if (!byPromptId.has(key)) byPromptId.set(key, {})
    const pair = byPromptId.get(key)

    if (msg.nodeType === 'local_prompt' || msg.nodeType === 'ai_prompt') pair.prompt = msg
    if (msg.nodeType === 'local_answer' || msg.nodeType === 'ai_answer') pair.answer = msg
  }

  for (const msg of filtered) {
    const key = msg.promptId || msg.id
    const pair = byPromptId.get(key)
    if (!pair || pair.used) continue

    if (msg.nodeType === 'local_prompt' || msg.nodeType === 'local_answer') {
      if (pair.prompt) ordered.push(pair.prompt)
      if (pair.answer) ordered.push(pair.answer)
      pair.used = true
      continue
    }

    if (msg.nodeType === 'ai_prompt' || msg.nodeType === 'ai_answer') {
      if (pair.prompt) ordered.push(pair.prompt)
      if (pair.answer) ordered.push(pair.answer)
      pair.used = true
    }
  }

  return ordered
}
