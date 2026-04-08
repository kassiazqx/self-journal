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

// ─── AI 设置（提供商 + API Key）───────────────────────────────

const AI_SETTINGS_KEY = 'ai_settings'

export function getAISettingsFromStorage() {
  const raw = _get(AI_SETTINGS_KEY)
  try {
    return raw ? JSON.parse(raw) : { provider: 'gemini', apiKey: '' }
  } catch {
    return { provider: 'gemini', apiKey: '' }
  }
}

export function saveAISettingsToStorage(settings) {
  _set(AI_SETTINGS_KEY, JSON.stringify(settings))
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

export function removeChatSession(entryId) {
  _remove(chatSessionKey(entryId))
}
