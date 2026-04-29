# Persistence Trust Batch A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复当前阶段最伤信任的“状态会丢 / 设置会跳回 / 草稿恢复不完整 / 深入觉察承诺与实际不一致”问题。

**Architecture:** 采用“本地优先、分层持久化”方案。小体积设置继续走 `storage.js` 抽象层；`letter_prefs` 当前阶段改为本地单一真源，不与 `user_profile` 混存，也不做 Web 阶段本地/云端双写；草稿正文与元数据走 draft storage；`RichTextEditor` 用命令式 `setValue()` 收口外部写入，避免 prop 驱动重建编辑器。`AwarenessFlow` 的“直接进 AI”不再靠注释表达，改成显式导航参数。

**Tech Stack:** React, existing `storage.js`, localStorage, Lexical, Supabase, existing AwarenessFlow state machine

---

## Scope

- 做：
  - API Key 按 provider 稳定持久化，不再因为切 provider 或长时间后重开而被意外清空
  - 回顾信触发偏好从 `user_profile` 拆出，当前阶段改为本地单一真源，避免设置跳回与数据互相覆盖
  - 草稿恢复完整化：正文、模板、时间、dismissedPeople 能恢复
  - `RichTextEditor` 支持命令式外部内容同步，收口草稿恢复 / 语音转写 / @ 替换同类问题
  - `深入觉察` 真正支持“保存后直接起首轮 AI”，且保存语义与 `✓` 一致（people / images / draft cleanup 不再漏）
  - `HomePage` 上传图片后首屏可见，不再必须手动下滑到第二屏
  - `RecordDetail` 原文最小分段渲染，先解决“整坨文字”问题，不等 UI 大改
- 不做：
  - UI 大改、全局排版系统、段间距系统
  - 云端草稿、多设备草稿同步
  - Web 阶段为 `letter_prefs` 做本地/云端双源协调
  - 未保存图片跨“刷新 / 关闭后重开”的本地恢复
  - 图片最终迁移到 Capacitor 本地目录（那是 P4 / APK 阶段）

## Assumptions

- 未保存图片在本批仍只活在当前页面内存；刷新/关闭后重开不承诺恢复
- 草稿图片在点击 `✓` / `深入觉察` 前不上传 Supabase Storage
- 当前阶段优先“别丢、别乱跳、行为一致”，不追求 UI 细节重做

## APK 终局备注

- APK 阶段不建议沿用 `selectedFiles + selectedPreviews` 双数组，也不建议把 `pendingImages[]` 当终局模型。
- APK 终局更适合统一成 `mediaItems[]`，每项同时描述本地路径/远端路径/预览/状态，避免“未保存图”和“已保存图”分裂成两套心智模型。

```js
{
  id,
  source: 'local' | 'remote',
  localUri,
  remotePath,
  previewUrl,
  status: 'draft' | 'saved' | 'uploading' | 'failed',
}
```

- 本批若讨论“未保存图片跨重开恢复”，它本质是 Web 过渡方案，不是 APK 终局方案；后续 APK 仍会把底层缓存改为 Capacitor/原生本地文件存储。
- 但本批不是“全部都会推翻”：
  - Task 1 的“设置规范化 / provider 分槽位 / 回顾信偏好主链收口”在 APK 仍然成立，只是底层存储适配器可能从 Web Storage 改成原生安全存储。
  - Task 3 的 `startInAi` 导航语义在 APK 仍然成立，属于业务行为，不依赖 Web。
  - Task 5 / Task 6 属于纯 UI/渲染修正，APK 仍然直接受益，不属于过渡债。
- 本轮已决定砍掉“未保存图片跨重开恢复”，原因：
  - 它最像 Web 过渡层，APK 阶段会改成本地文件存储，届时仍要重写
  - 牵连 `HomePage` 图片选择 / 删除 / 排序 / 清理链，当前收益不值这轮复杂度
  - 当前用户判断该能力不是刚需，不值得现在多花精力

## Task 1 Follow-up Decision

- 2026-04-28 复盘结论：`user_profile` 与 `letter_prefs` 是完全不同的数据职责，不能继续共用一个存储位。
- `user_profile`：只表示 AI 对用户的长期画像 / 记忆内容。
- `letter_prefs`：只表示产品设置（回顾信触发方式 / 阈值）。
- 当前 Web 阶段若继续把 `letter_prefs` 写入 `user_profile`，会出现：
  - 保存回顾信偏好时覆盖 AI 画像
  - AI 记忆更新时再把 `letter_prefs` 覆盖回去
  - prompt 把对象当字符串拼接，出现 `[object Object]` 风险

**因此本 plan 明确改口：**

- Task 1 不再把 `letter_prefs` 写入 `user_memory.user_profile`
- Task 1 不再追求“Web 阶段账号设置云端真源”
- Task 1 改为：
  - `API key`：设备级本地设置，继续走 `storage.js`
  - `letter_prefs`：当前阶段本地单一真源
  - 接口命名保留未来可升级空间，例如 `getLetterPrefs(userId)` / `saveLetterPrefs(userId, prefs)`，但底层实现先落本地

**为什么这样改不是浪费：**

- 当前产品预期：单设备、APK 阶段本地数据优先，不值得先做一套 Web 云端双源协调
- 未来若恢复多设备账号同步，只需替换 `letter_prefs` 的存储 adapter，不需要再把它塞回 `user_profile`
- 这次 follow-up 修的是“职责分仓”，不是临时补丁

## File Structure

- Modify: `src/lib/storage.js`
  - 统一 AI 设置与活动 tab 的持久化入口；补 provider 分槽位 API
- Create: `src/lib/storage.test.js`
  - 覆盖 AI settings 规范化 / provider 分槽位合并逻辑
- Create: `src/lib/draftStorage.js`
  - 草稿元数据读写：正文、模板、时间、dismissedPeople
- Create: `src/lib/draftStorage.test.js`
  - 覆盖 draft snapshot 序列化/反序列化与兼容逻辑
- Create: `src/lib/reviewLetterService.test.js`
  - 仅保留 review letter 业务链测试；回顾信偏好存储 follow-up 后不再以此文件为主
- Create: `src/lib/letterPrefsStorage.js`
  - 当前阶段本地单一真源；未来可替换为账号同步 adapter
- Create: `src/lib/letterPrefsStorage.test.js`
  - 覆盖默认值 / 规范化 / 读坏数据清理 / 写后读取
- Modify: `src/lib/aiClient.js`
  - 改用 provider-aware settings 读写
- Modify: `src/lib/reviewLetterService.js`
  - 回顾信生成逻辑保留；回顾信偏好读写 follow-up 后不再写入 `user_profile`
- Modify: `src/pages/SettingsPage.jsx`
  - API Key / 回顾信设置加载与保存改用新契约
- Modify: `src/pages/HomePage.jsx`
  - 草稿恢复改走 `draftStorage`；外部内容写入统一走 helper；`深入觉察` 传新标记
- Modify: `src/components/RichTextEditor.jsx`
  - 暴露命令式 `setValue()` 能力
- Modify: `src/components/MainLayout.jsx`
  - `onDone` / awareness 导航支持 `startInAi`
- Modify: `src/components/AwarenessFlow.jsx`
  - 首次启动若 `startInAi=true`，先请求首轮 AI block 再进入 AI 节点
- Modify: `src/components/RecordDetail.jsx`
  - 原文区改为最小分段渲染
- Modify: `src/components/AnnotatedText.jsx`
  - 提供不破坏标注 offset 的分段渲染能力
- Docs: `docs/arch-context.md`
- Docs: `docs/sync-cards/2026-04-28-persistence-trust-batch-a.md`

---

### Task 1: 收口 AI 设置与回顾信偏好持久化

**Files:**
- Modify: `src/lib/storage.js`
- Create: `src/lib/storage.test.js`
- Modify: `src/lib/aiClient.js`
- Modify: `src/lib/reviewLetterService.js`
- Create: `src/lib/reviewLetterService.test.js`
- Create: `src/lib/letterPrefsStorage.js`
- Create: `src/lib/letterPrefsStorage.test.js`
- Modify: `src/pages/SettingsPage.jsx`
- Test: `src/lib/storage.test.js`
- Test: `src/lib/reviewLetterService.test.js`

> **2026-04-28 follow-up override：** 以下 Task 1 原始 Step 5 / Step 7 把 `letter_prefs` 写进 `user_profile` 的方案，已确认方向错误，只保留作历史记录，不再照做。执行 Task 1 时，应以本节后面的“Follow-up Replacement”替换原 Step 5 / Step 7 / Step 8。

- [ ] **Step 1: 写 AI settings 纯函数测试**

```js
// src/lib/storage.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeProviderSettings,
  mergeProviderSettings,
} from './storage.js'

test('mergeProviderSettings 保留其他 provider 的 key', () => {
  const prev = {
    provider: 'gemini',
    providers: {
      gemini: { apiKey: 'g-1' },
      deepseek: { apiKey: 'd-1' },
    },
  }

  const next = mergeProviderSettings(prev, 'deepseek', 'd-2')

  assert.equal(next.provider, 'deepseek')
  assert.equal(next.providers.gemini.apiKey, 'g-1')
  assert.equal(next.providers.deepseek.apiKey, 'd-2')
})

test('normalizeProviderSettings 兼容旧结构', () => {
  const next = normalizeProviderSettings({ provider: 'gemini', apiKey: 'legacy-key' })
  assert.equal(next.provider, 'gemini')
  assert.equal(next.providers.gemini.apiKey, 'legacy-key')
  assert.equal(next.providers.deepseek.apiKey, '')
})
```

- [ ] **Step 2: 运行测试，确认先失败**

Run: `node --test src/lib/storage.test.js`

Expected: FAIL with missing exports like `normalizeProviderSettings`

- [ ] **Step 3: 在 `storage.js` 补 provider settings 纯函数层**

```js
// src/lib/storage.js
export function normalizeProviderSettings(raw) {
  if (raw?.providers) {
    const provider = raw.provider ?? 'gemini'
    return {
      provider,
      providers: {
        gemini: { apiKey: raw.providers.gemini?.apiKey ?? '' },
        deepseek: { apiKey: raw.providers.deepseek?.apiKey ?? '' },
      },
    }
  }

  if (raw?.apiKey) {
    return {
      provider: raw.provider ?? 'gemini',
      providers: {
        gemini: { apiKey: (raw.provider ?? 'gemini') === 'gemini' ? raw.apiKey : '' },
        deepseek: { apiKey: (raw.provider ?? 'gemini') === 'deepseek' ? raw.apiKey : '' },
      },
    }
  }

  const providers = raw?.providers ?? {}
  const provider = raw?.provider ?? 'gemini'
  return {
    provider,
    providers: {
      gemini: { apiKey: providers.gemini?.apiKey ?? '' },
      deepseek: { apiKey: providers.deepseek?.apiKey ?? '' },
    },
  }
}

export function mergeProviderSettings(prev, provider, apiKey) {
  const current = normalizeProviderSettings(prev)
  return {
    provider,
    providers: {
      ...current.providers,
      [provider]: { apiKey },
    },
  }
}
```

- [ ] **Step 4: 调整 `storage.js` 与 `aiClient.js` 的 AI 设置契约**

```js
// src/lib/storage.js
const AI_SETTINGS_KEY = 'ai_settings_v2'

export function getAISettingsFromStorage() {
  const normalized = normalizeProviderSettings(safeParse(_get(AI_SETTINGS_KEY)))
  const activeProvider = normalized.provider
  return {
    provider: activeProvider,
    apiKey: normalized.providers[activeProvider]?.apiKey ?? '',
    providers: normalized.providers,
  }
}

export function saveAISettingsToStorage(settings) {
  const normalized = normalizeProviderSettings(settings)
  _set(AI_SETTINGS_KEY, JSON.stringify(normalized))
}
```

```js
// src/lib/aiClient.js
export function saveAISettings(settings) {
  saveAISettingsToStorage(settings)
}

export function getAISettings() {
  return getAISettingsFromStorage()
}
```

- [ ] **Step 5: 写回顾信偏好行为测试**

```js
// src/lib/reviewLetterService.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { getUserLetterPrefs, saveUserLetterPrefs } from './reviewLetterService.js'

function createFakeStorage() {
  const store = new Map()
  return {
    getItem(key) { return store.has(key) ? store.get(key) : null },
    setItem(key, value) { store.set(key, value) },
    removeItem(key) { store.delete(key) },
    clear() { store.clear() },
  }
}

test('saveUserLetterPrefs 写入 local fallback 时会规范化数据', async () => {
  global.localStorage = createFakeStorage()
  await saveUserLetterPrefs('u1', { type: 'days', count_threshold: 7 }, async () => {})
  const raw = JSON.parse(global.localStorage.getItem('letter_prefs_u1'))
  assert.equal(raw.type, 'count')
  assert.equal(raw.count_threshold, 7)
})

test('getUserLetterPrefs 从 local fallback 读取旧 days 值时会回退为 count', async () => {
  global.localStorage = createFakeStorage()
  global.localStorage.setItem('letter_prefs_u1', JSON.stringify({ type: 'days', count_threshold: 10 }))
  const prefs = await getUserLetterPrefs('u1')
  assert.equal(prefs.type, 'count')
  assert.equal(prefs.count_threshold, 10)
})
```

- [ ] **Step 6: 修 `SettingsPage` 的 provider / API Key 行为**

```js
// src/pages/SettingsPage.jsx
onClick={() => {
  setSettings((s) => ({
    ...s,
    provider: p.id,
    apiKey: s.providers?.[p.id]?.apiKey ?? '',
  }))
  setKeyUnlocked(false)
}}

onChange={(e) => {
  const apiKey = e.target.value
  setSettings((s) => ({
    ...s,
    apiKey,
    providers: {
      ...(s.providers ?? {}),
      [s.provider]: { apiKey },
    },
  }))
}}
```

- [ ] **Step 7: 修回顾信偏好正式写入链**

```js
// src/pages/SettingsPage.jsx
import { updateMemory } from '../lib/memory'

saveUserLetterPrefs(user.id, updated, (patch) => updateMemory(patch))
```

```js
// src/lib/reviewLetterService.js
function normalizeLetterPrefs(raw) {
  if (!raw) return { type: 'count', count_threshold: 10, require_new_entries: true }
  return {
    type: raw.type === 'manual' ? 'manual' : 'count',
    count_threshold: raw.count_threshold ?? 10,
    require_new_entries: raw.require_new_entries ?? true,
  }
}

export async function saveUserLetterPrefs(userId, prefs, updateMemoryFn) {
  const normalized = normalizeLetterPrefs(prefs)
  try {
    await updateMemoryFn({ user_profile: { letter_prefs: normalized } })
  } catch (e) {
    console.error('[reviewLetter] 保存偏好到 user_memory 失败:', e)
  }
  try {
    localStorage.setItem(`letter_prefs_${userId}`, JSON.stringify(normalized))
  } catch {}
}
```

- [ ] **Step 8: 运行测试，确认通过**

Run: `node --test src/lib/storage.test.js src/lib/reviewLetterService.test.js`

Expected: PASS

#### Task 1 Follow-up Replacement

- [ ] **Replacement Step 5: 写 `letter_prefs` 本地真源测试**

```js
// src/lib/letterPrefsStorage.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { getLetterPrefs, saveLetterPrefs } from './letterPrefsStorage.js'

function createFakeStorage() {
  const store = new Map()
  return {
    getItem(key) { return store.has(key) ? store.get(key) : null },
    setItem(key, value) { store.set(key, value) },
    removeItem(key) { store.delete(key) },
    clear() { store.clear() },
  }
}

test('saveLetterPrefs 写入本地时会规范化旧 days 值', () => {
  global.localStorage = createFakeStorage()
  saveLetterPrefs('u1', { type: 'days', count_threshold: 7 })
  const raw = JSON.parse(global.localStorage.getItem('letter_prefs_u1'))
  assert.equal(raw.type, 'count')
  assert.equal(raw.count_threshold, 7)
})

test('getLetterPrefs 从本地读取旧 days 值时会回退为 count', () => {
  global.localStorage = createFakeStorage()
  global.localStorage.setItem('letter_prefs_u1', JSON.stringify({ type: 'days', count_threshold: 10 }))
  const prefs = getLetterPrefs('u1')
  assert.equal(prefs.type, 'count')
  assert.equal(prefs.count_threshold, 10)
})

test('getLetterPrefs 遇到坏 JSON 时返回默认值并清理脏数据', () => {
  global.localStorage = createFakeStorage()
  global.localStorage.setItem('letter_prefs_u1', '{bad json')
  const prefs = getLetterPrefs('u1')
  assert.equal(prefs.type, 'count')
  assert.equal(global.localStorage.getItem('letter_prefs_u1'), null)
})
```

- [ ] **Replacement Step 7: 回滚 `user_profile` 混存方案，改为本地单一真源**

```js
// src/lib/letterPrefsStorage.js
function normalizeLetterPrefs(raw) {
  if (!raw) return { type: 'count', count_threshold: 10, require_new_entries: true }
  return {
    type: raw.type === 'manual' ? 'manual' : 'count',
    count_threshold: raw.count_threshold ?? 10,
    require_new_entries: raw.require_new_entries ?? true,
  }
}

export function saveLetterPrefs(userId, prefs) {
  const normalized = normalizeLetterPrefs(prefs)
  try {
    localStorage.setItem(`letter_prefs_${userId}`, JSON.stringify(normalized))
  } catch {}
}

export function getLetterPrefs(userId) {
  try {
    const raw = localStorage.getItem(`letter_prefs_${userId}`)
    if (!raw) return normalizeLetterPrefs(null)
    return normalizeLetterPrefs(JSON.parse(raw))
  } catch {
    localStorage.removeItem(`letter_prefs_${userId}`)
    return normalizeLetterPrefs(null)
  }
}
```

```js
// src/pages/SettingsPage.jsx
import { getLetterPrefs, saveLetterPrefs } from '../lib/letterPrefsStorage'

// load
const prefs = getLetterPrefs(user.id)

// save
saveLetterPrefs(user.id, updated)
```

- [ ] **Replacement Step 7.5: 为未来账号同步留接口，但本批不实现双源**

```js
// 可选：src/lib/letterPrefsRepository.js
export function getLetterPrefs(userId) {
  return getLetterPrefsFromLocal(userId)
}

export function saveLetterPrefs(userId, prefs) {
  return saveLetterPrefsToLocal(userId, prefs)
}
```

说明：

- 当前实现只有本地一个真源，因此不需要 fallback / 时间戳 / 冲突合并
- 未来若要恢复账号同步，只替换 repository 内部实现，不改页面调用层

- [ ] **Replacement Step 8: 运行测试，确认通过**

Run: `node --test src/lib/storage.test.js src/lib/letterPrefsStorage.test.js`

Expected: PASS

---

### Task 2: 草稿正文恢复与外部内容同步收口

**Files:**
- Create: `src/lib/draftStorage.js`
- Modify: `src/pages/HomePage.jsx`
- Modify: `src/components/RichTextEditor.jsx`
- Test: `src/lib/draftStorage.test.js`

- [ ] **Step 1: 写 draft snapshot 测试**

```js
test('serializeDraftSnapshot 保留正文/模板/时间/人物 dismiss 信息', () => {
  const serialized = serializeDraftSnapshot({
    content: 'hello',
    template: 'awareness',
    selectedDatetime: '2026-04-28T08:00:00.000Z',
    manualOverride: true,
    dismissedPeople: new Set(['张三']),
  })

  assert.equal(serialized.content, 'hello')
  assert.equal(serialized.template, 'awareness')
  assert.equal(serialized.manualOverride, true)
  assert.deepEqual(serialized.dismissedPeople, ['张三'])
})

test('loadDraftSnapshot 遇到坏 JSON 时返回 null 并清掉脏数据', () => {
  localStorage.setItem('journal_draft_v2', '{bad json')
  const loaded = loadDraftSnapshot()
  assert.equal(loaded, null)
  assert.equal(localStorage.getItem('journal_draft_v2'), null)
})
```

- [ ] **Step 2: 运行测试，确认先失败**

Run: `node --test src/lib/draftStorage.test.js`

Expected: FAIL with missing export `serializeDraftSnapshot`

- [ ] **Step 3: 建立 draft metadata 存储层**

```js
// src/lib/draftStorage.js
const DRAFT_KEY = 'journal_draft_v2'

export function serializeDraftSnapshot(snapshot) {
  return {
    content: snapshot.content ?? '',
    template: snapshot.template ?? 'awareness',
    savedAt: snapshot.savedAt ?? new Date().toISOString(),
    selectedDatetime: snapshot.selectedDatetime ?? null,
    manualOverride: Boolean(snapshot.manualOverride),
    dismissedPeople: [...(snapshot.dismissedPeople ?? [])],
  }
}

export function saveDraftSnapshot(snapshot) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(serializeDraftSnapshot(snapshot)))
  } catch {
    // localStorage 容错
  }
}

export function loadDraftSnapshot() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return {
      ...parsed,
      selectedDatetime: parsed.selectedDatetime ? new Date(parsed.selectedDatetime) : null,
      dismissedPeople: new Set(parsed.dismissedPeople ?? []),
    }
  } catch {
    localStorage.removeItem(DRAFT_KEY)
    return null
  }
}
```

- [ ] **Step 4: 给 `RichTextEditor` 暴露命令式 `setValue()`**

```js
// src/components/RichTextEditor.jsx
useImperativeHandle(ref, () => ({
  focus() { contentEditableRef.current?.focus() },
  getValue() {
    if (!lexicalEditorRef.current) return ''
    let text = ''
    lexicalEditorRef.current.read(() => { text = $getRoot().getTextContent() })
    return text
  },
  setValue: (text) => {
    lexicalEditorRef.current?.update(() => {
      const root = $getRoot()
      root.clear()
      const para = $createParagraphNode()
      para.append($createTextNode(text ?? ''))
      root.append(para)
    }, { tag: 'imperative-set-value' })
  },
}))

// 明确不加 ValueSyncPlugin，不把 editor 变成 value 驱动受控组件
```

- [ ] **Step 5: `HomePage` 收口外部内容写入 helper**

```js
// src/pages/HomePage.jsx
const applyExternalContent = useCallback((text) => {
  setContent(text)
  textareaRef.current?.setValue?.(text)
}, [])
```

- [ ] **Step 6: 草稿恢复 / 语音转写 / @ 选人统一走 helper**

```js
// src/pages/HomePage.jsx
const handleResumeDraft = () => {
  if (draftRef.current) {
    applyExternalContent(draftRef.current.content)
    setTemplate(resolveTemplate(draftRef.current.template))
    if (draftRef.current.selectedDatetime) {
      setSelectedDatetime(draftRef.current.selectedDatetime)
      setManualOverride(draftRef.current.manualOverride ?? false)
    }
    if (draftRef.current.dismissedPeople?.size > 0) {
      setDismissedPeople(draftRef.current.dismissedPeople)
    }
  }
  setShowDraftBanner(false)
}

// 其他外部写入点也统一替换：
// - handleVoiceToggle 回调里的 setContent(...)
// - handleMentionSelect 里的 setContent(...)
```

- [ ] **Step 7: 运行测试，确认通过**

Run: `node --test src/lib/draftStorage.test.js`

Expected: PASS

---

### Task 3: 深入觉察真正支持“直接进 AI”

**Files:**
- Modify: `src/pages/HomePage.jsx`
- Modify: `src/components/MainLayout.jsx`
- Modify: `src/components/AwarenessFlow.jsx`
- Test: `src/lib/awarenessFlowState.test.js`

- [ ] **Step 1: 先补一个状态测试**

```js
// src/lib/awarenessFlowState.test.js
test('enterAiMode 后当前节点切到 ai', () => {
  const base = createFlowState({
    entryContent: 'hello',
    now: '2026-04-28T00:00:00.000Z',
    snapshot: null,
    messages: null,
  })

  const entered = enterAiMode(base, {
    draftLocalAnswer: '',
    aiBlock: 'AI prompt',
    aiNodeId: 'ai:1',
    now: '2026-04-28T00:00:01.000Z',
  })

  assert.equal(getCurrentNode(entered).kind, 'ai')
})
```

- [ ] **Step 2: 运行测试，确认现有基线通过**

Run: `node --test src/lib/awarenessFlowState.test.js`

Expected: PASS

- [ ] **Step 3: `HomePage` 改为显式传参**

```js
// src/pages/HomePage.jsx
const allPeople = [...new Set([...selectedPeople, ...autoDetected])]
  .filter((p) => !dismissedPeople.has(p))

const { data: entry } = await createEntry({
  user_id: user.id,
  content: latestContent.trim(),
  template_type: template.id,
  created_at: selectedDatetime.toISOString(),
  annotations,
  people_involved: allPeople,
})

clearDraft()
onDone?.(entry, { gotoAwareness: true, startInAi: true })

// 与普通保存路径对齐：若已有选图，后台继续上传并 updateEntry(image_urls)
```

- [ ] **Step 4: `MainLayout` 接新契约**

```js
// src/components/MainLayout.jsx
function handleHomeSaved(entry, navigation) {
  const gotoAwareness = Boolean(navigation?.gotoAwareness)
  const startInAi = Boolean(navigation?.startInAi)

  if (gotoAwareness) {
    push({ type: 'awareness', entryId: entry.id, startInAi })
    return
  }

  goTab('records')
}
```

- [ ] **Step 5: `AwarenessFlow` 启动时首轮 AI 引导**

```js
// src/components/AwarenessFlow.jsx
export default function AwarenessFlow({ entry, onComplete, onExit, initialFlowState, startInAi = false }) {
  // init() 内：
  if (startInAi && !initialFlowState && !data?.messages?.length) {
    const baseState = createFlowState({ entryContent: entry.content, now: new Date().toISOString(), snapshot: null, messages: null })
    const raw = await callAI(
      [{ role: 'user', content: buildAwarenessContext(entry.content, buildConversationMessages(entry, baseState)) }],
      AWARENESS_SYSTEM_PROMPT,
      { maxTokens: 220 }
    )
    const nextState = enterAiMode(baseState, {
      draftLocalAnswer: '',
      aiBlock: raw.trim(),
      aiNodeId: createAiNodeId(),
      now: new Date().toISOString(),
    })
    setFlowState(nextState)
    setCurrentAnswer(getDraftAnswer(nextState))
    return
  }
}
```

- [ ] **Step 6: 运行测试，确认状态层未回归**

Run: `node --test src/lib/awarenessFlowState.test.js`

Expected: PASS

- [ ] **Step 7: 手工补验 `深入觉察` 的保存语义**

```text
- 选 1 张图片、@ 1 个人，再点“深入觉察”
- 进入 AwarenessFlow 后返回记录详情
- people_involved 已保存
- 图片最终能出现在记录详情
- 草稿已清掉，不会再次弹恢复横幅
```

---

### Task 4: 验证、文档、手测矩阵

**Files:**
- Docs: `docs/arch-context.md`
- Docs: `docs/sync-cards/2026-04-28-persistence-trust-batch-a.md`

- [ ] **Step 1: 跑自动验证**

Run: `node --test src/lib/draftStorage.test.js src/lib/awarenessFlowState.test.js`

Expected: PASS

Run: `npm run lint`

Expected: PASS

Run: `npm run build`

Expected: PASS

- [ ] **Step 2: 启动开发环境给用户手测**

Run: `npm run dev`

Expected: Vite dev server starts without errors

- [ ] **Step 3: 手工验证清单**

1. API Key:

```text
- 先填 Gemini key，保存
- 切到 Deepseek，再切回 Gemini
- Gemini key 仍在
- 关闭网页，过一段时间重新打开
- 当前 provider 的 key 仍在
```

2. 回顾信设置:

```text
- 选“手动生成”
- 刷新页面
- 重新打开网页
- 仍保持“手动生成”
```

3. 草稿正文:

```text
- 新建一条未保存草稿，输入正文
- 刷新页面或关闭后重开
- 点“继续”
- 正文恢复
- 模板 / 时间 / dismissedPeople 也恢复
```

4. 深入觉察:

```text
- 在 HomePage 输入正文
- 点“深入觉察”
- 进入 AwarenessFlow 后直接看到首轮 AI 引导，不是先落在本地卡片问题
```

- [ ] **Step 4: 文档收口**

```text
- 在同步卡里记录：API key / letter prefs / 草稿正文恢复 / startInAi 批次完成
- 在 arch-context 追加：
  - 未保存图片跨重开恢复已明确延期到 APK 阶段
  - RichTextEditor 现已支持命令式外部内容同步
  - startInAi 为正式导航契约
```

---

### Task 5: HomePage 图片首屏可见

**Files:**
- Modify: `src/pages/HomePage.jsx`
- Create: `src/lib/homePageImageLayout.js`
- Create: `src/lib/homePageImageLayout.test.js`
- Test/Verify: 手工交互

- [x] **Step 1: 先写目标规则到实现注释**

```js
// src/pages/HomePage.jsx
// 规则：
// 1. 用户选完图后，至少有一部分图片预览在当前首屏可见
// 2. 不要求整组图片都完整露出，但不能“必须手动滚到第二屏才第一次看见”
// 3. 不把整套图片区重做成全新 UI 系统，本轮只做当前布局下的最小可见性修正
```

- [x] **Step 2: 收口渲染策略，选一种最小实现并固定**

**2026-04-29 follow-up 决定：** 不采用横向 strip 双 UI。改为“单一图片区 + 轻度缩短编辑区 + 选图后轻推滚动到正文末尾接图片”。

```js
// 方案：
// - 仍只保留 HomePage 现有这一套图片区
// - 新增图片后，先吃掉默认空白，再轻推滚动到“正文末尾 + 图片开头”
// - 1行图：目标露出 1 行
// - 2行图：目标露出约 1.5 行
// - 不新增第二套图片 UI，不改图片状态架构
```

- [x] **Step 3: 修改 `HomePage` 图片区布局**

```js
// src/lib/homePageImageLayout.js
// - getHomePageEditorMinHeight(imageCount)
// - getDesiredVisibleImageHeight({ imageCount, gridHeight })
// - getImageRevealScrollTop(...)
//
// src/pages/HomePage.jsx
// - RichTextEditor 最小高度按图片数量轻度缩短
// - scrollContainerRef + imageSectionRef + imageGridRef 精确控制自动滚动
// - 不改现有 DnD / 删除 / 全屏查看交互
```

- [x] **Step 4: 如仍保留正文区宫格，自动把新图滚进可视区域**

```js
// 新图加入时：
// - 不再 scrollIntoView 粗暴跳到底
// - 改为按容器高度 + 图片网格实际高度，算出目标 scrollTop
// - 长文 + 1行图：只露 1 行
// - 长文 + 2行图：只露约 1.5 行
```

- [x] **Step 5: 手工验证**

```text
- 在 HomePage 选 1 张图后，不用手动下滑，首屏能立刻看到图片预览
- 连续选 2~5 张图后，至少第一行/第一条预览始终在首屏
- 底部浮动栏（相机 / 深入觉察 / 保存）不被图片区挡住
- 长按调序/删除/全屏查看能力不回归
- 长文 + 1行图：只露约 1 行图
- 长文 + 2行图：只露约 1.5 行图
```

---

### Task 6: RecordDetail 原文最小分段渲染

**Files:**
- Modify: `src/components/AnnotatedText.jsx`
- Modify: `src/components/RecordDetail.jsx`
- Test/Verify: 手工交互

- [ ] **Step 1: 先写分段规则测试思路**

```js
// 目标规则：
// - 双换行优先视为段落边界
// - 单换行保留为行内换行
// - 标注 start/end 仍基于原始 text，不做 trim 或重排
// - 已标注文字点击菜单能力不能丢
```

- [ ] **Step 2: 给 `AnnotatedText` 增加可选的分段渲染模式**

```js
// src/components/AnnotatedText.jsx
export default function AnnotatedText({
  text,
  annotations,
  style,
  onAnnotatedClick,
  paragraphize = false,
  paragraphGap = 14,
}) {
  // segments 仍基于完整原文和原 offset 构建
}
```

- [ ] **Step 3: 基于原 segments 做“只影响布局、不影响 offset”的段落拆分**

```js
function groupSegmentsIntoParagraphs(segments) {
  const paragraphs = []
  let current = []

  for (const seg of segments) {
    const pieces = seg.text.split('\n\n')
    // 保持 seg.start / seg.end 原 offset，不重新 trim，不重排字符
    // 逻辑目标：遇到双换行时结束当前 paragraph
  }

  return paragraphs
}
```

- [ ] **Step 4: `RecordDetail` 原文区启用最小分段模式**

```js
// src/components/RecordDetail.jsx
<AnnotatedText
  text={entry.content ?? ''}
  annotations={annotations}
  onAnnotatedClick={openMenuForRange}
  paragraphize={true}
  paragraphGap={14}
/>
```

- [ ] **Step 5: 保持问答流其它块暂不统一**

```text
- 本轮只处理原文区（messages.length === 0 与 raw_entry 两个分支）
- `local_answer` / `ai_answer` 继续保持 `whiteSpace: pre-wrap`
- 全局自动段间距系统留到 UI 大改，不在本批次扩散
```

- [ ] **Step 6: 手工验证**

```text
- RecordDetail 打开长正文原文，视觉上不再是一整坨
- 双换行段落之间有稳定间距
- 标注高亮/下划线/加粗仍在正确位置
- 点击已标注文字仍能弹菜单
- 无对话记录和有 raw_entry 对话记录两条路径都正常
```

## Done Definition

- API Key 不因 provider 切换或页面重开被意外清空
- 回顾信设置真正落到正式主存储，不再随机回默认值
- 草稿恢复不只恢复横幅，正文 / 模板 / 时间 / dismissedPeople 都能回来
- `深入觉察` 与实际行为一致，真正直接进 AI
- `HomePage` 选图后首屏即可见预览
- `RecordDetail` 原文完成最小分段渲染
- 自动验证通过，手工矩阵完成，文档同步
