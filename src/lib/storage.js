// ─── 本地存储抽象层 ─────────────────────────────────────────────
// 所有 localStorage 读写必须经过这里，不允许在组件或其他 lib 里裸调用。
//
// 为什么需要这一层：
// 当前用 localStorage；打包成 Capacitor App 后需要换成
// @capacitor/preferences（安全存储），届时只改这一个文件，
// 上层调用方零改动。
//
// 扩展点：
// - 把下面的实现替换成 Capacitor Preferences API 即可完成迁移
// - 可在此加加密层（敏感数据如 API Key）
// - 可在此加读写日志，便于调试

// ─── 底层读写 ──────────────────────────────────────────────────

function _get(key) {
  try {
    return localStorage.getItem(key)
  } catch (e) {
    console.warn('[storage] 读取失败:', key, e)
    return null
  }
}

function _set(key, value) {
  try {
    localStorage.setItem(key, value)
  } catch (e) {
    console.warn('[storage] 写入失败:', key, e)
  }
}

function _remove(key) {
  try {
    localStorage.removeItem(key)
  } catch (e) {
    console.warn('[storage] 删除失败:', key, e)
  }
}

function safeParse(raw) {
  try {
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

const DEFAULT_PROVIDER = 'gemini'

function normalizeProviderId(provider) {
  return provider === 'deepseek' ? 'deepseek' : DEFAULT_PROVIDER
}

function createEmptyProviderMap() {
  return {
    gemini: { apiKey: '' },
    deepseek: { apiKey: '' },
  }
}

// ─── AI 设置（提供商 + API Key）───────────────────────────────

const AI_SETTINGS_KEY = 'ai_settings_v2'
const LEGACY_AI_SETTINGS_KEY = 'ai_settings'

export function normalizeProviderSettings(raw) {
  const provider = normalizeProviderId(raw?.provider)
  const providers = createEmptyProviderMap()

  if (typeof raw?.apiKey === 'string') {
    providers[provider].apiKey = raw.apiKey
  }

  if (raw?.providers) {
    providers.gemini.apiKey = raw.providers.gemini?.apiKey ?? providers.gemini.apiKey
    providers.deepseek.apiKey = raw.providers.deepseek?.apiKey ?? providers.deepseek.apiKey
  }

  return {
    provider,
    providers,
  }
}

export function mergeProviderSettings(prev, provider, apiKey) {
  const nextProvider = normalizeProviderId(provider)
  const current = normalizeProviderSettings(prev)

  return {
    provider: nextProvider,
    providers: {
      ...current.providers,
      [nextProvider]: {
        apiKey: apiKey ?? '',
      },
    },
  }
}

export function getAISettingsFromStorage() {
  const parsed = safeParse(_get(AI_SETTINGS_KEY)) ?? safeParse(_get(LEGACY_AI_SETTINGS_KEY))
  const normalized = normalizeProviderSettings(parsed)
  const activeProvider = normalized.provider

  return {
    provider: activeProvider,
    apiKey: normalized.providers[activeProvider]?.apiKey ?? '',
    providers: normalized.providers,
  }
}

export function saveAISettingsToStorage(settings) {
  const normalized = typeof settings?.apiKey === 'string'
    ? mergeProviderSettings(settings, settings.provider, settings.apiKey)
    : normalizeProviderSettings(settings)

  _set(AI_SETTINGS_KEY, JSON.stringify(normalized))
  _remove(LEGACY_AI_SETTINGS_KEY)
}

// ─── 底部导航 Tab ──────────────────────────────────────────────

const ACTIVE_TAB_KEY = 'activeTab'

export function getActiveTab() {
  return _get(ACTIVE_TAB_KEY)
}

export function saveActiveTab(tabId) {
  _set(ACTIVE_TAB_KEY, tabId)
}

// ─── AI 对话缓存（防刷新丢失）─────────────────────────────────

function chatSessionKey(entryId) {
  return `chat_session_${entryId}`
}

export function getChatSession(entryId) {
  const raw = _get(chatSessionKey(entryId))
  try {
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function saveChatSession(entryId, data) {
  _set(chatSessionKey(entryId), JSON.stringify(data))
}
