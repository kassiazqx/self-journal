// AI 调用抽象层，支持多个提供商，可随时切换

const PROVIDERS = {
  gemini: {
    name: 'Google Gemini',
    model: 'gemini-flash-latest',
  },
  deepseek: {
    name: 'Deepseek',
    model: 'deepseek-chat',
  },
}

// ─── 设置读写（存 localStorage）───────────────────────────────
export function getAISettings() {
  try {
    const raw = localStorage.getItem('ai_settings')
    return raw ? JSON.parse(raw) : { provider: 'gemini', apiKey: '' }
  } catch {
    return { provider: 'gemini', apiKey: '' }
  }
}

export function saveAISettings(settings) {
  localStorage.setItem('ai_settings', JSON.stringify(settings))
}

export function hasAIConfigured() {
  const { apiKey } = getAISettings()
  return Boolean(apiKey?.trim())
}

// ─── 统一调用入口 ──────────────────────────────────────────────
// messages: [{ role: 'user'|'assistant', content: string }]
// systemPrompt: string
// options: { maxTokens?: number }
//   对话默认 450（快），提取/记忆更新传 1200（JSON 较长）
export async function callAI(messages, systemPrompt = '', options = {}) {
  const { provider, apiKey } = getAISettings()

  if (!apiKey?.trim()) {
    throw new Error('请先在「设置」页面填写 API Key')
  }

  if (provider === 'gemini') {
    return callGemini(messages, systemPrompt, apiKey, options)
  }

  if (provider === 'deepseek') {
    return callDeepseek(messages, systemPrompt, apiKey, options)
  }

  throw new Error(`未知提供商：${provider}`)
}

// ─── Google Gemini ─────────────────────────────────────────────
async function callGemini(messages, systemPrompt, apiKey, options = {}) {
  const model = PROVIDERS.gemini.model
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

  // Gemini 要求 role 为 'user' 或 'model'，且必须交替出现
  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))

  const body = {
    contents,
    generationConfig: {
      temperature: 0.85,
      maxOutputTokens: options.maxTokens ?? 450,  // 对话用 450，提取/记忆更新调用时传 1200
    },
  }

  if (systemPrompt) {
    body.systemInstruction = { parts: [{ text: systemPrompt }] }
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    const msg = err.error?.message || res.statusText
    if (res.status === 400) {
      throw new Error(`参数错误：${msg}`)
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error('API Key 无效或无权限，请在设置中重新检查')
    }
    if (res.status === 404) {
      throw new Error('模型不存在，请检查模型名称是否正确')
    }
    if (res.status === 429) {
      throw new Error('超过免费额度限制，请稍等 1 分钟后重试')
    }
    throw new Error(`Gemini 出错 (${res.status})：${msg}`)
  }

  const data = await res.json()
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('AI 没有返回内容，请重试')
  return text
}

// ─── Deepseek（OpenAI 兼容格式）────────────────────────────────
async function callDeepseek(messages, systemPrompt, apiKey, options = {}) {
  const allMessages = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : messages

  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: PROVIDERS.deepseek.model,
      messages: allMessages,
      temperature: 0.85,
      max_tokens: options.maxTokens ?? 1024,
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    const msg = err.error?.message || res.statusText
    if (res.status === 401) throw new Error('Deepseek API Key 无效')
    if (res.status === 429) throw new Error('请求太频繁，稍等片刻再试')
    throw new Error(`Deepseek 出错：${msg}`)
  }

  const data = await res.json()
  const text = data.choices?.[0]?.message?.content
  if (!text) throw new Error('AI 没有返回内容，请重试')
  return text
}
