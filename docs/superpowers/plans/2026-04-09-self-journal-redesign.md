# Self-Journal 重设计 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完全重设计 self-journal 的写作流、数据架构和 UI——单屏觉察流（AwarenessFlow）、AI 按需接手、回顾信系统（review_letters）和洞察页。

**Architecture:** 现有栈 React+Vite+Tailwind+Supabase 不变。新增 db.js 适配层预留 SQLite 接缝；emotionMap.js 提供 57 词情绪基础层；AwarenessFlow.jsx 实现单屏觉察流（本地问题+AI接手+debounce 自动保存）；reviewLetterService.js 管理回顾信触发与生成。所有数据访问通过 db.js，不直接调 supabase。

**Tech Stack:** React 18, Vite, Tailwind CSS v3, Supabase (PostgreSQL + Auth), Google Gemini / Deepseek (via aiClient.js)

**Spec:** `docs/superpowers/specs/2026-04-09-self-journal-redesign-design.md`

> ⚠️ **注意：** 本项目无自动化测试框架。每个 Task 的"验证"步骤均为手动浏览器验证，按步骤操作确认预期行为即可。

---

## 文件变更清单

### 新建
| 文件 | 说明 |
|---|---|
| `src/lib/db.js` | 数据访问适配层（覆盖现有空文件，预留 SQLite 接缝）|
| `src/lib/emotionMap.js` | 57词情绪基础层 + mapDisplayToBase（覆盖现有）|
| `src/lib/templates.js` | 模板系统重设计（覆盖现有）|
| `src/components/AwarenessFlow.jsx` | 单屏觉察流（本地+AI+自动保存）|
| `src/lib/reviewLetterService.js` | 回顾信触发判断+生成逻辑 |
| `src/components/ReviewLetterDetail.jsx` | 回顾信详情页 |
| `src/pages/InsightsPage.jsx` | 洞察页 |

### 修改
| 文件 | 改动 |
|---|---|
| `src/lib/contentAnalysis.js` | 新增 getAwarenessStartTier() |
| `src/lib/conversationService.js` | 更新保存逻辑，新增 emotion_display 提取 |
| `src/lib/prompts.js` | 新增回顾信 prompt，AwarenessFlow 系统 prompt |
| `src/pages/HomePage.jsx` | 完全重写 |
| `src/pages/RecordsPage.jsx` | 更新卡片+回顾信穿插+触发检查 |
| `src/components/RecordDetail.jsx` | 新布局+AI分析按钮 |
| `src/components/MainLayout.jsx` | 4个Tab导航，整合 AwarenessFlow |
| `src/pages/SettingsPage.jsx` | 新增回顾信设置区块 |

### 删除（TaskEnd时清理）
| 文件 | 原因 |
|---|---|
| `src/pages/TaggingPage.jsx` | 已被新流程替代 |
| `src/pages/ReflectionPage.jsx` | 已被 AwarenessFlow 替代 |
| `src/lib/localDB.js` | 孤儿文件（spec §CLAUDE.md 待删）|

---

## Task 1：数据库变更 + db.js 适配层

**Files:**
- Modify: Supabase（SQL Editor 执行三段 SQL）
- Create: `src/lib/db.js`（覆盖现有）

- [ ] **Step 1：执行 review_letters 建表 SQL**

打开 Supabase Dashboard → SQL Editor，执行：

```sql
CREATE TABLE IF NOT EXISTS review_letters (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES auth.users NOT NULL,
  entry_ids    uuid[] NOT NULL DEFAULT '{}',
  content      text NOT NULL,
  insights     jsonb DEFAULT '{}',
  trigger_type text CHECK (trigger_type IN ('count','days','manual')),  -- 注意：spec §4.2 原为 '7days'/'10entries'，此处统一改为语义更清晰的 'count'/'days'
  period_start timestamptz,
  period_end   timestamptz,
  is_read      boolean DEFAULT false,
  user_response text,
  created_at   timestamptz DEFAULT now()
);

ALTER TABLE review_letters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_review_letters_policy"
  ON review_letters FOR ALL
  USING (auth.uid() = user_id);
```

预期：执行成功，无报错。

- [ ] **Step 2：执行 conversations 建表 SQL**

```sql
CREATE TABLE IF NOT EXISTS conversations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES auth.users NOT NULL,
  entry_id    uuid REFERENCES journal_entries(id) ON DELETE CASCADE,
  letter_id   uuid REFERENCES review_letters(id) ON DELETE SET NULL,
  context_type text NOT NULL CHECK (context_type IN ('entry', 'letter')),
  messages    jsonb NOT NULL DEFAULT '[]',
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  CONSTRAINT conversations_entry_unique UNIQUE (entry_id, context_type)
);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_conversations_policy"
  ON conversations FOR ALL
  USING (auth.uid() = user_id);
```

预期：执行成功，无报错。

- [ ] **Step 3：给 journal_entries 增列**

```sql
ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS emotion_display text[] DEFAULT '{}';

ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS emotion_confidence float DEFAULT null;

ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS attachments jsonb DEFAULT '[]';
```

预期：执行成功，无报错。

- [ ] **Step 4：Supabase 验证**

在 Table Editor 里确认：
- `review_letters` 表存在，能看到所有列
- `conversations` 表存在，含 `messages`、`context_type` 列
- `journal_entries` 里能看到 `emotion_display`、`emotion_confidence`、`attachments` 列
- 两张新表的 Authentication → Policies 里各有一条 policy

- [ ] **Step 5：写 db.js**

覆盖 `src/lib/db.js`（现有文件内容全部替换）：

```js
// src/lib/db.js
// 唯一知道"底下用什么存储"的文件。将来切换本地 SQLite 只改这里。
// 规范：所有 lib 文件必须 import { db } from './db'，不得直接 import supabase。
import { supabase } from './supabase'

export const db = {
  from: (table) => supabase.from(table),   // 目前透传，未来可换实现
  auth: supabase.auth,
  rpc: (fn, args) => supabase.rpc(fn, args),
}
```

- [ ] **Step 6：build 检查**

```bash
cd /Users/kassia1/Desktop/个人/noteapp/self-journal
npm run build
```

预期：无编译错误。

- [ ] **Step 7：commit**

```bash
git add src/lib/db.js
git commit -m "feat: 数据库建表(conversations, review_letters)，增列，db.js 适配层"
```

- [ ] **Step 7：db.js 架构规范迁移说明**

> ⚠️ 架构规范要求所有 lib 文件通过 `db.js` 访问数据库。本次改动中，**新建的 lib 文件**（reviewLetterService.js、AwarenessFlow 里的 upsert）均已用 `db.from`。**已有的** `journalService.js` 仍直接用 `supabase`——这是存量问题，本次不全量迁移（避免改动范围扩大）。
>
> 迁移规则：**本次新增的调用都走 db.js；旧有调用等下次专项重构再统一。**

---

**Files:**
- Create/Overwrite: `src/lib/emotionMap.js`

- [ ] **Step 1：写 emotionMap.js**

覆盖 `src/lib/emotionMap.js`（现有文件全部替换）：

```js
// src/lib/emotionMap.js
// 基础层词库（56词）+ 近义词映射 + mapDisplayToBase()
// 词库取舍原则：以情感状态独特性为标准，不以出现频率为依据

export const EMOTION_BASE = [
  // 负面（26词）
  '难过','愤怒','委屈','焦虑','羞愧','无力','害怕','孤独','绝望','沮丧',
  '厌烦','烦躁','压抑','紧张','失落','嫉妒','内疚','抗拒','疲惫','麻木',
  '不甘','崩溃','厌恶','悲痛','羞耻','轻视',
  // 正面（18词）
  '轻松','满足','感激','开心','平静','期待','温暖','喜悦','自豪','踏实',
  '安心','充实','兴奋','爱','敬畏','信任','被信任','悲悯',
  // 混合（12词）
  '迷茫','矛盾','好奇','纠结','释然','依恋','敏感','复杂','惊讶','无聊',
  '尴尬','怀念','同情',
]

// 负面情绪子集（供 contentAnalysis.js 使用）
export const EMOTION_NEGATIVE = EMOTION_BASE.slice(0, 26)

const SYNONYM_MAP = {
  // ── 负面 ──
  '难受':'难过','伤心':'难过','悲伤':'难过','心疼':'难过',
  '生气':'愤怒','气愤':'愤怒','愤恨':'愤怒','恼火':'愤怒',
  '心酸':'委屈','不公':'委屈',
  '担心':'焦虑','不安':'焦虑','忧虑':'焦虑','惶恐':'焦虑',
  '害羞':'羞愧','难堪':'羞愧','自责':'羞愧','惭愧':'羞愧',
  '无奈':'无力','力不从心':'无力','无法改变':'无力',
  '恐惧':'害怕','慌':'害怕','惊慌':'害怕',
  '寂寞':'孤独','孤立':'孤独','被忽视':'孤独',
  '消沉':'沮丧','意志消沉':'沮丧',
  '烦':'烦躁','心烦':'烦躁','焦躁':'烦躁',
  '郁闷':'压抑','憋屈':'压抑','憋':'压抑',
  '紧绷':'紧张','绷':'紧张',
  '失意':'失落',
  '羡慕':'嫉妒',
  '愧疚':'内疚','后悔':'内疚',
  '排斥':'抗拒','不想':'抗拒',
  '累':'疲惫','精疲力竭':'疲惫','筋疲力尽':'疲惫',
  '木木的':'麻木','没感觉':'麻木',
  '不服气':'不甘','心有不甘':'不甘',
  '崩了':'崩溃','撑不住':'崩溃',
  '恶心':'厌恶','反感':'厌恶','厌恶感':'厌恶',
  '哀痛':'悲痛','极度悲伤':'悲痛','痛失':'悲痛',
  '羞耻感':'羞耻','丢脸':'羞耻','无地自容':'羞耻',
  '看不起':'轻视','鄙视':'轻视','蔑视':'轻视','不屑':'轻视',
  // ── 正面 ──
  '快乐':'开心','高兴':'开心',
  '放松':'轻松',
  '知足':'满足',
  '感恩':'感激','谢谢':'感激',
  '安静':'平静','内心平静':'平静','淡然':'平静',
  '期盼':'期待',
  '被关心':'温暖','暖':'温暖','被爱':'温暖',
  '欣喜':'喜悦',
  '骄傲':'自豪',
  '稳':'踏实','安稳':'踏实',
  '有意义':'充实',
  '亢奋':'兴奋','激动':'兴奋','振奋':'兴奋','好嗨':'兴奋',
  '爱意':'爱','心动':'爱','珍惜':'爱',
  '感动':'敬畏','震撼':'敬畏','被震到':'敬畏','崇敬':'敬畏',
  '信赖':'信任','放心':'信任','安心托付':'信任',
  '被信赖':'被信任','被认可':'被信任','被托付':'被信任',
  '慈悲':'悲悯','悲悯感':'悲悯','慈心':'悲悯',
  // ── 混合 ──
  '迷失':'迷茫','找不到方向':'迷茫',
  '左右为难':'纠结',
  '想通了':'释然','放下了':'释然',
  '感兴趣':'好奇',
  '吃惊':'惊讶','没想到':'惊讶','意外':'惊讶','惊喜':'惊讶',
  '无聊透了':'无聊','百无聊赖':'无聊','提不起劲':'无聊',
  '窘迫':'尴尬','尬':'尴尬','场面尴尬':'尴尬',
  '想念':'怀念','思念':'怀念','乡愁':'怀念','留恋':'怀念',
  '可怜':'同情','心疼他':'同情','替他难过':'同情','哀怜':'同情',
}

/**
 * 把单个描述层词映射到基础层
 * @param {string} displayWord
 * @returns {{ baseWord: string|null, confidence: number }}
 *   1.0=精确匹配, 0.85=近义词, 0.75=包含关系, 0=未找到
 */
export function mapToBase(displayWord) {
  if (!displayWord) return { baseWord: null, confidence: 0 }
  if (EMOTION_BASE.includes(displayWord)) return { baseWord: displayWord, confidence: 1.0 }
  const mapped = SYNONYM_MAP[displayWord]
  if (mapped) return { baseWord: mapped, confidence: 0.85 }
  for (const base of EMOTION_BASE) {
    if (displayWord.includes(base)) return { baseWord: base, confidence: 0.75 }
  }
  return { baseWord: null, confidence: 0 }
}

/**
 * 把描述层数组整体映射到基础层
 * @param {string[]} displayWords
 * @returns {{ baseWords: string[], minConfidence: number }}
 */
export function mapDisplayToBase(displayWords = []) {
  if (!displayWords.length) return { baseWords: [], minConfidence: 1.0 }
  const results = displayWords.map(w => mapToBase(w))
  const baseWords = [...new Set(results.map(r => r.baseWord).filter(Boolean))]
  const minConfidence = Math.min(...results.map(r => r.confidence))
  return { baseWords, minConfidence }
}
```

- [ ] **Step 2：build 检查**

```bash
npm run build
```

预期：无编译错误。

- [ ] **Step 3：浏览器控制台验证**

运行 `npm run dev`，打开浏览器 Console，粘贴：

```js
// 需要先确保 emotionMap.js 可以被 import
// 可在 App.jsx 顶部临时加一行：import { mapDisplayToBase } from './lib/emotionMap'; window._test = mapDisplayToBase;
// 刷新后在 console 运行：
window._test(['克制后的难受', '轻松'])
// 预期：{ baseWords: ['难过', '轻松'], minConfidence: 0.75 }
window._test([])
// 预期：{ baseWords: [], minConfidence: 1.0 }
window._test(['同情'])
// 预期：{ baseWords: ['同情'], minConfidence: 1.0 }（同情是基础词，不映射到悲悯）
```

验证完后删除 App.jsx 里的临时 import。

- [ ] **Step 4：commit**

```bash
git add src/lib/emotionMap.js
git commit -m "feat: emotionMap.js 56词基础情绪层 + mapDisplayToBase"
```

---

## Task 3：templates.js 重设计

**Files:**
- Overwrite: `src/lib/templates.js`

- [ ] **Step 1：写 templates.js**

覆盖 `src/lib/templates.js`（全部替换）：

```js
// src/lib/templates.js
// 写作模板配置。颜色用于标签高亮、引导竖线、引导文字。
// awarenessStart: null 表示不进入觉察流（随记）；其他值为预留字段，当前由 getAwarenessStartTier() 动态决定起点

export const TEMPLATES = [
  {
    id: 'awareness',
    label: '觉察',
    color: '#c9a96e',
    guide: '发生了什么 → 感受到什么 → 身体感觉',
    awarenessStart: 'emotion',  // 预留字段，当前实现忽略
  },
  {
    id: 'gratitude',
    label: '感恩',
    color: '#7cb9a8',
    guide: '今天 3 件值得感恩的事 → 为什么 → 谁让我感到温暖',
    awarenessStart: 'gratitude',
  },
  {
    id: 'learning',
    label: '学习',
    color: '#8aabcc',
    guide: '学到了什么 → 为什么重要 → 想如何实践',
    awarenessStart: 'learning',
  },
  {
    id: 'freewrite',
    label: '随记',
    color: '#aaa',
    guide: '随手记下来',
    awarenessStart: null,  // null = 不进入觉察流，点✓直接保存
  },
  {
    id: 'action',
    label: '行动',
    color: '#b8a88a',
    guide: '做了什么 → 感受如何 → 下次想怎么做',
    awarenessStart: 'action',
  },
]

// 按 id 索引，方便 O(1) 查找
export const TEMPLATE_BY_ID = Object.fromEntries(TEMPLATES.map(t => [t.id, t]))

// 默认模板
export const DEFAULT_TEMPLATE = TEMPLATE_BY_ID['awareness']

// 旧 ID 兼容映射（现有数据库里的旧 template_type 值 → 新 id）
const LEGACY_MAP = {
  'emotion':    'awareness',
  'free':       'freewrite',
  'gratitude':  'gratitude',
  'learning':   'learning',
  'action':     'action',
}

/**
 * 根据 id（含旧 id）查找模板，找不到返回 DEFAULT_TEMPLATE
 * @param {string} id
 * @returns {object} template
 */
export function resolveTemplate(id) {
  if (!id) return DEFAULT_TEMPLATE
  return TEMPLATE_BY_ID[id] ?? TEMPLATE_BY_ID[LEGACY_MAP[id]] ?? DEFAULT_TEMPLATE
}
```

- [ ] **Step 2：build 检查**

```bash
npm run build
```

预期：可能有 import 报错（旧代码 import 了已不存在的字段），先记录报错，下一步修复。

- [ ] **Step 3：修复 templates.js 引用报错**

如果 build 报错说某个 import 的字段不存在（如旧 TEMPLATES 里的 `icon`、`color` 属性名称变了），在对应文件里把 `import { TEMPLATES } from '../lib/templates'` 改为使用新的 `resolveTemplate` 或 `TEMPLATE_BY_ID`。如果暂时没有其他文件用到新 templates.js，直接 build 通过即可。

- [ ] **Step 4：commit**

```bash
git add src/lib/templates.js
git commit -m "feat: templates.js 重设计，支持旧ID兼容 resolveTemplate()"
```

---

## Task 4：contentAnalysis.js 新增 getAwarenessStartTier()

**Files:**
- Modify: `src/lib/contentAnalysis.js`

- [ ] **Step 1：读取现有 contentAnalysis.js**

```bash
cat src/lib/contentAnalysis.js
```

找到文件末尾，记住现有的 `analyzeContent` 函数名称（后面会用到）。

- [ ] **Step 2：在文件末尾追加函数**

在 `src/lib/contentAnalysis.js` 末尾追加（不替换任何现有内容）：

```js
// ─── AwarenessFlow 起点计算 ──────────────────────────────────────
import { EMOTION_NEGATIVE } from './emotionMap'

/**
 * 根据文本复杂度，返回觉察流应该从哪一层开始
 * @param {string} text - 用户原始写作内容
 * @returns {number} tier 1-5
 */
export function getAwarenessStartTier(text) {
  if (!text || text.trim().length < 30) return 1

  const { score } = analyzeContent(text)

  const hasEmotionWords = EMOTION_NEGATIVE.some(w => text.includes(w))
  const hasBodyWords = ['身体','胸口','肚子','喉咙','头疼','心跳','紧','沉'].some(w => text.includes(w))
  const hasNeedWords = ['需要','想要','希望','重要','被理解','安全'].some(w => text.includes(w))

  if (hasBodyWords || hasNeedWords) return 3
  if (hasEmotionWords || score >= 2) return 2
  return 1
}
```

> 注意：如果 `analyzeContent` 在文件里不是 export 的，先把它的 export 加上（`export function analyzeContent`），否则 `getAwarenessStartTier` 引用不到。

- [ ] **Step 3：build 检查**

```bash
npm run build
```

预期：无错误（如果有 circular import 报错，把 `import { EMOTION_NEGATIVE }` 移到文件顶部）。

- [ ] **Step 4：commit**

```bash
git add src/lib/contentAnalysis.js
git commit -m "feat: contentAnalysis 新增 getAwarenessStartTier()"
```

---

## Task 5：HomePage.jsx 完全重写

**Files:**
- Overwrite: `src/pages/HomePage.jsx`

- [ ] **Step 1：读取现有 HomePage.jsx 前50行**

```bash
head -50 src/pages/HomePage.jsx
```

目的：确认现有 import 里有哪些要保留（`insertEntry`、`useAuth`、`useSpeechRecognition`）。

- [ ] **Step 2：写新 HomePage.jsx**

覆盖 `src/pages/HomePage.jsx`（全部替换）：

```jsx
// src/pages/HomePage.jsx
// 写作页——模板横排标签 + 引导词细竖线 + 全屏输入框 + 底部浮动栏
// 随记(freewrite)：点✓直接保存到列表。其他模板：点✓保存后进入觉察流(AwarenessFlow)。
import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useSpeechRecognition } from '../hooks/useSpeechRecognition'
import { TEMPLATES, resolveTemplate } from '../lib/templates'
import { insertEntry } from '../lib/journalService'
import { detectCategories, detectPeople } from '../lib/keywordDetection'

const DRAFT_KEY = 'journal_draft'

export default function HomePage({ onSaved }) {
  // onSaved(entry, isFreewrite) — 由 MainLayout 传入：
  //   isFreewrite=true  → 直接回列表
  //   isFreewrite=false → 进入 AwarenessFlow

  const { user } = useAuth()
  const [template, setTemplate] = useState(TEMPLATES[0])   // 默认觉察
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [draftPrompt, setDraftPrompt] = useState(false)    // 是否显示草稿恢复提示
  const textareaRef = useRef(null)

  const { isListening, toggleListening } = useSpeechRecognition({
    onResult: (text) => setContent(prev => prev + text),
  })

  // ── 草稿恢复 ──────────────────────────────────────────────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY)
      if (!raw) return
      const draft = JSON.parse(raw)
      const age = Date.now() - new Date(draft.savedAt).getTime()
      if (age < 24 * 60 * 60 * 1000 && draft.content?.trim()) {
        setDraftPrompt(true)
      }
    } catch { /* ignore */ }
  }, [])

  // ── 自动草稿保存（3秒） ───────────────────────────────────────
  useEffect(() => {
    if (!content.trim()) return
    const t = setTimeout(() => {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        content,
        template: template.id,
        savedAt: new Date().toISOString(),
      }))
    }, 3000)
    return () => clearTimeout(t)
  }, [content, template.id])

  function restoreDraft() {
    try {
      const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '{}')
      setContent(draft.content ?? '')
      setTemplate(resolveTemplate(draft.template))
    } catch { /* ignore */ }
    setDraftPrompt(false)
  }

  function discardDraft() {
    localStorage.removeItem(DRAFT_KEY)
    setDraftPrompt(false)
  }

  // ── 保存 ──────────────────────────────────────────────────────
  async function handleDone() {
    if (!content.trim() || saving) return
    setSaving(true)
    setError('')

    const category_tags = detectCategories(content)
    const people_involved = detectPeople(content)

    const { data, error: err } = await insertEntry({
      user_id: user.id,
      content: content.trim(),
      template_type: template.id,
      category_tags,
      people_involved,
      created_at: new Date().toISOString(),
    })

    setSaving(false)

    if (err || !data?.[0]) {
      setError('保存失败，请检查网络后重试')
      return
    }

    localStorage.removeItem(DRAFT_KEY)
    const entry = data[0]
    const isFreewrite = template.id === 'freewrite'
    onSaved(entry, isFreewrite)
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: '100%', background: '#faf8f4', position: 'relative',
    }}>

      {/* 草稿恢复提示 */}
      {draftPrompt && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
          background: '#fff8ec', borderBottom: '1px solid #f0e8d4',
          padding: '10px 18px', display: 'flex', alignItems: 'center',
          gap: 8, fontSize: 13, color: '#8a7a5a',
        }}>
          <span style={{ flex: 1 }}>你有一条未完成的记录，要继续写吗？</span>
          <button onClick={restoreDraft}
            style={{ color: '#c9a96e', fontWeight: 500, fontSize: 13 }}>继续</button>
          <button onClick={discardDraft}
            style={{ color: '#bbb', fontSize: 13, marginLeft: 8 }}>新建</button>
        </div>
      )}

      {/* 模板标签栏 */}
      <div style={{
        display: 'flex', gap: 2, alignItems: 'center',
        padding: '10px 18px 0', marginTop: draftPrompt ? 44 : 0,
      }}>
        {TEMPLATES.map(t => (
          <button
            key={t.id}
            onClick={() => setTemplate(t)}
            style={{
              fontSize: 11,
              fontWeight: template.id === t.id ? 500 : 400,
              color: template.id === t.id ? t.color : '#ccc',
              padding: '3px 7px', borderRadius: 5,
              background: 'none', border: 'none', cursor: 'pointer',
              letterSpacing: '0.1px', whiteSpace: 'nowrap',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 引导词行（细竖线 + 文字） */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 18px 0' }}>
        <div style={{
          width: 1.5, borderRadius: 1, flexShrink: 0,
          alignSelf: 'stretch', minHeight: 16, marginTop: 2,
          background: template.color, opacity: 0.5,
        }} />
        <div style={{
          fontSize: 12, lineHeight: 1.65, fontWeight: 400,
          letterSpacing: '0.1px', color: template.color,
        }}>
          {template.guide}
        </div>
      </div>

      {/* 输入区 */}
      <div style={{ flex: 1, padding: '14px 18px 80px' }}>
        <textarea
          ref={textareaRef}
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder=""
          autoFocus
          style={{
            width: '100%', height: '100%',
            border: 'none', outline: 'none',
            background: 'transparent', resize: 'none',
            fontSize: 15, lineHeight: 1.85,
            color: '#2d2d2d', fontFamily: 'inherit',
            caretColor: '#aaa',
          }}
        />
      </div>

      {/* 错误提示 */}
      {error && (
        <div style={{
          position: 'absolute', bottom: 80, left: 18, right: 18,
          background: '#fff0f0', border: '1px solid #f5c5c5',
          borderRadius: 8, padding: '8px 12px',
          fontSize: 13, color: '#c0392b', textAlign: 'center',
        }}>
          {error}
        </div>
      )}

      {/* 底部浮动栏 */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        padding: '8px 18px 22px',
        background: 'linear-gradient(transparent, #faf8f4 38%)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        {/* 左侧：语音 + 深入觉察标签 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={toggleListening}
            style={{
              width: 30, height: 30, borderRadius: '50%',
              background: isListening ? '#c9a96e' : '#f0ece4',
              border: '1px solid #ddd8cf',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14, cursor: 'pointer',
            }}
          >
            {isListening ? '🎤' : '🎙'}
          </button>
          <span style={{ fontSize: 10, color: '#ccc' }}>深入觉察</span>
        </div>

        {/* 右侧：完成按钮 */}
        <button
          onClick={handleDone}
          disabled={!content.trim() || saving}
          style={{
            width: 36, height: 36, borderRadius: '50%',
            background: content.trim() ? '#2d2928' : '#ccc',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, color: 'white',
            boxShadow: '0 2px 10px rgba(0,0,0,0.18)',
            border: 'none', cursor: content.trim() ? 'pointer' : 'default',
            transition: 'background 0.2s',
          }}
        >
          {saving ? '…' : '✓'}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3：build 检查**

```bash
cd /Users/kassia1/Desktop/个人/noteapp/self-journal
npm run build
```

预期：可能报 `onSaved is not defined`（MainLayout 还没传），这是预期内的——先记录报错，Task 8 里修 MainLayout 时一起解决。如果报的是 import 路径错误，逐一修复。

- [ ] **Step 4：commit**

```bash
git add src/pages/HomePage.jsx
git commit -m "feat: HomePage 重写，模板横排标签+引导词细竖线+草稿恢复"
```

---

## Task 6：AwarenessFlow.jsx（本地觉察流）

**Files:**
- Create: `src/components/AwarenessFlow.jsx`

> 本 Task 只实现本地问题流（mode='local'）。AI 接手（mode='ai'）在 Task 7 里加。

- [ ] **Step 1：写 AwarenessFlow.jsx**

新建 `src/components/AwarenessFlow.jsx`：

```jsx
// src/components/AwarenessFlow.jsx
// 单屏专注觉察流。
// Props:
//   entry: { id, content, template_type, user_id }
//   onComplete: () => void    全部问题答完后回调（返回记录列表）
//   onBackToWrite: () => void 用户点「返回写作」时回调
import { useState, useEffect, useRef } from 'react'
import { db } from '../lib/db'
import { getAwarenessStartTier } from '../lib/contentAnalysis'
import { EMOTION_NEGATIVE } from '../lib/emotionMap'
import { callAI } from '../lib/aiClient'

// ── 本地觉察问题库 ─────────────────────────────────────────────
const AWARENESS_QUESTIONS = [
  {
    id: 'context', tier: 1,
    text: '能多说一点当时的情况吗？',
    alts: ['当时发生了什么？', '事情是在什么情况下发生的？'],
    showWhen: 'always',
  },
  {
    id: 'primary_emotion', tier: 2,
    text: '当时你是什么感觉？',
    alts: ['你注意到自己有什么情绪？', '你心里是什么滋味？'],
    showWhen: 'always',
  },
  {
    id: 'body', tier: 3,
    text: '这个感觉在身体哪里？',
    alts: ['是什么质地——紧、沉、热还是别的？', '现在坐着，身体哪里是紧的？'],
    showWhen: 'negative',
  },
  {
    id: 'thought', tier: 3,
    text: '当时你脑子里第一个念头是什么？',
    alts: ['那个时刻最先冒出来的词是什么？', '你当时对自己说了什么？'],
    showWhen: 'always',
  },
  {
    id: 'need', tier: 4,
    text: '在这件事上，你真正需要的是什么？',
    alts: ['这件事触动了你的什么——被理解、安全感，还是别的？'],
    showWhen: 'always',
  },
  {
    id: 'insight', tier: 5,
    text: '写完这些，有什么是刚才才意识到的吗？',
    alts: ['如果给今天的自己说一句话，会是什么？'],
    showWhen: 'always',
  },
]

// ── 保存到 conversations 表 ──────────────────────────────────
async function upsertConversation(userId, entryId, messages) {
  const { error } = await db.from('conversations').upsert(
    {
      user_id: userId,
      entry_id: entryId,
      context_type: 'entry',
      messages,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'entry_id,context_type' }
  )
  if (error) console.error('[AwarenessFlow] upsert失败:', error.message)
}

export default function AwarenessFlow({ entry, onComplete, onBackToWrite }) {
  const [questions, setQuestions] = useState([])
  const [currentIdx, setCurrentIdx] = useState(0)
  const [answer, setAnswer] = useState('')
  const [mode, setMode] = useState('local')        // 'local' | 'ai'
  const [aiQuestion, setAiQuestion] = useState('') // AI 生成的问题文字
  const [aiLoading, setAiLoading] = useState(false)
  const [messages, setMessages] = useState([])     // 完整消息数组（持久化到 conversations）
  const messagesRef = useRef([])
  const [transitioning, setTransitioning] = useState(false)
  const [opacity, setOpacity] = useState(1)
  const saveRef = useRef(null)

  // 保持 messagesRef 与 state 同步
  useEffect(() => { messagesRef.current = messages }, [messages])

  // ── 初始化：读取历史 + 过滤问题 ────────────────────────────
  useEffect(() => {
    async function init() {
      // 读取已有对话历史
      const { data } = await db.from('conversations')
        .select('messages')
        .eq('entry_id', entry.id)
        .eq('context_type', 'entry')
        .single()
      if (data?.messages?.length) {
        setMessages(data.messages)
        messagesRef.current = data.messages
      } else {
        // 把原始写作内容作为第一条消息
        const raw = [{ role: 'user', content: entry.content,
          timestamp: new Date().toISOString(), source: 'raw' }]
        setMessages(raw)
        messagesRef.current = raw
      }

      // 过滤问题：tier >= startTier，negative 只在有负面情绪词时显示
      const startTier = getAwarenessStartTier(entry.content)
      const hasNeg = EMOTION_NEGATIVE.some(w => entry.content.includes(w))
      const filtered = AWARENESS_QUESTIONS.filter(q => {
        if (q.tier < startTier) return false
        if (q.showWhen === 'negative' && !hasNeg) return false
        return true
      })
      setQuestions(filtered)
    }
    init()
  }, [entry.id, entry.content])

  // ── useEffect cleanup：组件卸载时立即保存 ──────────────────
  useEffect(() => {
    return () => {
      if (saveRef.current) clearTimeout(saveRef.current)
      upsertConversation(entry.user_id, entry.id, messagesRef.current)
    }
  }, [entry.id, entry.user_id])

  // ── debounce 自动保存（800ms）──────────────────────────────
  function scheduleAutoSave(msgs) {
    if (saveRef.current) clearTimeout(saveRef.current)
    saveRef.current = setTimeout(() => {
      upsertConversation(entry.user_id, entry.id, msgs)
    }, 800)
  }

  // ── 当前问题文字 ──────────────────────────────────────────
  const currentQ = mode === 'ai' ? aiQuestion : (questions[currentIdx]?.text ?? '')

  // ── 点「继续」─────────────────────────────────────────────
  async function handleNext() {
    if (!answer.trim()) return

    const now = new Date().toISOString()
    const qMsg = {
      role: mode === 'ai' ? 'assistant' : 'local',
      content: currentQ,
      timestamp: now,
      source: mode === 'ai' ? 'ai_question' : 'local_question',
    }
    const aMsg = {
      role: 'user', content: answer.trim(),
      timestamp: now,
      source: mode === 'ai' ? 'ai_answer' : 'local_answer',
    }
    const newMsgs = [...messages, qMsg, aMsg]
    setMessages(newMsgs)
    scheduleAutoSave(newMsgs)

    // 渐变过渡
    setTransitioning(true)
    setOpacity(0)
    await new Promise(r => setTimeout(r, 300))

    setAnswer('')
    setMode('local')

    const nextIdx = currentIdx + 1
    if (nextIdx >= questions.length) {
      // 全部问完，立即保存后返回
      if (saveRef.current) clearTimeout(saveRef.current)
      await upsertConversation(entry.user_id, entry.id, newMsgs)
      onComplete()
      return
    }
    setCurrentIdx(nextIdx)
    setTransitioning(false)
    setOpacity(1)
  }

  // ── 保存并退出 ──────────────────────────────────────────
  async function handleSaveExit() {
    if (saveRef.current) clearTimeout(saveRef.current)
    await upsertConversation(entry.user_id, entry.id, messagesRef.current)
    onComplete()
  }

  // ── 返回写作 ────────────────────────────────────────────
  function handleBackToWrite() {
    // cleanup useEffect 会触发立即保存
    onBackToWrite()
  }

  if (questions.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center',
        justifyContent: 'center', color: '#ccc', fontSize: 14 }}>
        加载中…
      </div>
    )
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: '100%', background: '#faf8f4', position: 'relative',
    }}>

      {/* 顶部导航 */}
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        padding: '12px 18px 0', fontSize: 12, color: '#bbb',
      }}>
        <button onClick={handleBackToWrite}
          style={{ background: 'none', border: 'none', color: '#bbb',
            cursor: 'pointer', fontSize: 12 }}>
          ← 返回写作
        </button>
        <button onClick={handleSaveExit}
          style={{ background: 'none', border: 'none', color: '#bbb',
            cursor: 'pointer', fontSize: 12 }}>
          保存并退出
        </button>
      </div>

      {/* 问题 + 答案区（渐变切换） */}
      <div style={{
        flex: 1, padding: '28px 24px 80px',
        display: 'flex', flexDirection: 'column', gap: 20,
        opacity, transition: 'opacity 0.3s ease',
      }}>
        {/* 问题文字 */}
        <div style={{ fontSize: 15, fontWeight: 500, color: '#333', lineHeight: 1.65 }}>
          {mode === 'ai' && (
            <span style={{ fontSize: 10, color: '#ccc', marginRight: 4 }}>✦</span>
          )}
          {aiLoading ? (
            <span className="loading-dots">
              <span /><span /><span />
            </span>
          ) : currentQ}
        </div>

        {/* 回答输入区 */}
        <textarea
          value={answer}
          onChange={e => setAnswer(e.target.value)}
          placeholder="写下你的回答…"
          autoFocus
          style={{
            flex: 1, border: 'none', outline: 'none',
            background: 'transparent', resize: 'none',
            fontSize: 15, lineHeight: 1.85, color: '#2d2d2d',
            fontFamily: 'inherit', caretColor: '#aaa',
            padding: 0,
          }}
        />
      </div>

      {/* 底部浮动栏 */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        padding: '8px 18px 22px',
        background: 'linear-gradient(transparent, #faf8f4 38%)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        {/* 左：AI 切换按钮（本 Task 暂不实现 AI 调用，占位） */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{
            width: 30, height: 30, borderRadius: '50%',
            background: '#f0ece4', border: '1px solid #ddd8cf',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, color: '#b8a88a',
          }}>✦</div>
          <span style={{ fontSize: 10, color: '#ccc' }}>深入觉察</span>
        </div>

        {/* 右：继续按钮 */}
        <button
          onClick={handleNext}
          disabled={!answer.trim() || transitioning}
          style={{
            padding: '10px 20px', borderRadius: 20,
            background: answer.trim() ? '#2d2928' : '#e0dbd4',
            color: answer.trim() ? 'white' : '#aaa',
            fontSize: 13, border: 'none', cursor: 'pointer',
            transition: 'background 0.2s',
          }}
        >
          继续 →
        </button>
      </div>

      {/* loading dots 动画 */}
      <style>{`
        .loading-dots span {
          display: inline-block; width: 5px; height: 5px;
          border-radius: 50%; background: #ccc; margin: 0 2px;
          animation: af-blink 1.2s step-end infinite;
        }
        .loading-dots span:nth-child(2) { animation-delay: 0.2s; }
        .loading-dots span:nth-child(3) { animation-delay: 0.4s; }
        @keyframes af-blink { 0%,100%{opacity:1} 50%{opacity:0.2} }
      `}</style>
    </div>
  )
}
```

- [ ] **Step 2：build 检查**

```bash
npm run build
```

预期：无编译错误（AwarenessFlow 还没被任何页面 import，所以不会有 prop 类型报错）。

- [ ] **Step 3：commit**

```bash
git add src/components/AwarenessFlow.jsx
git commit -m "feat: AwarenessFlow 本地觉察流（问题过滤+渐变切换+debounce保存）"
```

---

## Task 7：AwarenessFlow AI 接手 + prompts.js 新增

**Files:**
- Modify: `src/components/AwarenessFlow.jsx`
- Modify: `src/lib/prompts.js`

> ⚠️ 执行本 Task 前，先与用户确认 user_memory 策略（spec 附录 A），再动手。

- [ ] **Step 1：在 prompts.js 末尾追加 AwarenessFlow 相关 prompt**

先读文件末尾：
```bash
tail -20 src/lib/prompts.js
```

然后在末尾追加：

```js
// ─── AwarenessFlow 单屏模式系统 prompt ─────────────────────────
export const AWARENESS_SYSTEM_PROMPT =
  `你是一位温和的倾听者，陪伴用户探索自己的情绪和想法。

【单屏模式特别说明】
当前是单屏专注模式，每次只问一个问题。只返回问题本身，不要加"我注意到你…"等共情前缀，不要解释为什么问这个问题。直接给出问题。

【对话原则】
- 从已有的问答上下文出发，问还没问过的
- 不重复用户已经写清楚的内容
- 只问开放式问题，不问封闭式（是/否）
- 如果用户已经说得很充分，可以问一个轻柔的收尾问题（如"写完这些，有什么新的发现吗？"）`

// ─── 构建传给 AI 的上下文 ──────────────────────────────────────
export function buildAwarenessContext(rawContent, answeredMessages) {
  const qaText = answeredMessages
    .filter(m => m.source !== 'raw')
    .map(m => {
      if (m.role === 'local' || m.role === 'assistant') return `问：${m.content}`
      if (m.role === 'user') return `答：${m.content}`
      return ''
    })
    .filter(Boolean)
    .join('\n')

  return `用户刚才写道：\n${rawContent}\n\n` +
    (qaText ? `已经聊到的部分：\n${qaText}\n\n` : '') +
    `请根据对话上下文，提出下一个最合适的问题。只返回问题本身，不要加任何前缀或解释。`
}
```

- [ ] **Step 2：在 AwarenessFlow.jsx 里实现 AI 接手**

在 `src/components/AwarenessFlow.jsx` 里做以下修改：

**2a：在文件顶部的 import 里加 prompts 导入**（找到现有 import callAI 那行，在它后面加）：

```js
import { AWARENESS_SYSTEM_PROMPT, buildAwarenessContext } from '../lib/prompts'
```

**2b：把底部「✦ 深入觉察」按钮的 `<div>` 改成可点击的 `<button>`**，找到这段：

```jsx
        {/* 左：AI 切换按钮（本 Task 暂不实现 AI 调用，占位） */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{
            width: 30, height: 30, borderRadius: '50%',
            background: '#f0ece4', border: '1px solid #ddd8cf',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, color: '#b8a88a',
          }}>✦</div>
          <span style={{ fontSize: 10, color: '#ccc' }}>深入觉察</span>
        </div>
```

替换为：

```jsx
        {/* 左：AI 切换按钮 */}
        <button
          onClick={handleToggleAI}
          disabled={aiLoading}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            background: 'none', border: 'none', cursor: 'pointer', padding: 0,
          }}
        >
          <div style={{
            width: 30, height: 30, borderRadius: '50%',
            background: mode === 'ai' ? '#f0ece4' : '#f0ece4',
            border: `1px solid ${mode === 'ai' ? '#c9a96e' : '#ddd8cf'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, color: '#b8a88a',
          }}>✦</div>
          <span style={{ fontSize: 10, color: '#ccc' }}>
            {mode === 'ai' ? '× 暂停引导' : '深入觉察'}
          </span>
        </button>
```

**2c：在组件内部（`handleBackToWrite` 函数之后）加 `handleToggleAI` 函数**：

```js
  // ── 切换 AI 模式 ────────────────────────────────────────────
  async function handleToggleAI() {
    if (mode === 'ai') {
      // 切回本地模式
      setMode('local')
      setAiQuestion('')
      return
    }

    // 切入 AI 模式：调用 AI 生成下一个问题
    setMode('ai')
    setAiLoading(true)
    try {
      const ctx = buildAwarenessContext(entry.content, messagesRef.current)
      const raw = await callAI(
        [{ role: 'user', content: ctx }],
        AWARENESS_SYSTEM_PROMPT,
        { maxTokens: 150 }
      )
      // 取第一个非空行
      const lines = raw.split('\n').map(l => l.trim()).filter(Boolean)
      const q = lines[0] ?? ''
      if (q) {
        setAiQuestion(q)
      } else {
        // AI 返回为空：降级到随机 tier=3 问题
        const fallback = AWARENESS_QUESTIONS.find(q => q.tier === 3) ?? AWARENESS_QUESTIONS[0]
        setAiQuestion(fallback.text)
        setMode('local')
      }
    } catch (e) {
      console.error('[AwarenessFlow] AI 调用失败:', e)
      // 失败：降级到随机 tier=3 问题，保持 local 模式
      const fallback = AWARENESS_QUESTIONS.find(q => q.tier === 3) ?? AWARENESS_QUESTIONS[0]
      setAiQuestion(fallback.text)
      setMode('local')
    } finally {
      setAiLoading(false)
    }
  }
```

- [ ] **Step 3：build 检查**

```bash
npm run build
```

预期：无编译错误。

- [ ] **Step 4：commit**

```bash
git add src/components/AwarenessFlow.jsx src/lib/prompts.js
git commit -m "feat: AwarenessFlow AI 接手（✦按钮切换模式，降级处理）"
```

---

## Task 8：MainLayout.jsx 更新（4 Tab 导航 + AwarenessFlow 整合）

**Files:**
- Modify: `src/components/MainLayout.jsx`
- Delete: `src/pages/TaggingPage.jsx`、`src/pages/ReflectionPage.jsx`

- [ ] **Step 1：读取现有 MainLayout.jsx**

```bash
cat src/components/MainLayout.jsx
```

确认：import 列表、NAV_ITEMS、screens 栈、当前哪些 screen type 在用。

- [ ] **Step 2：搜索旧 localStorage 导航 key**

```bash
grep -r "nav_screens\|screens\|saveActiveTab\|getActiveTab" src/lib/storage.js src/components/MainLayout.jsx
```

记下实际 key 名称（可能是 `'nav_screens'` 或其他），下面清理要用。

- [ ] **Step 3：完全重写 MainLayout.jsx**

覆盖 `src/components/MainLayout.jsx`：

```jsx
// src/components/MainLayout.jsx
// 4 Tab 导航：写 / 记录 / 洞察 / 设置
// 导航栈（screens 数组）管理全屏覆盖页面（AwarenessFlow、RecordDetail 等）
import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { getActiveTab, saveActiveTab } from '../lib/storage'
import HomePage from '../pages/HomePage'
import RecordsPage from '../pages/RecordsPage'
import SettingsPage from '../pages/SettingsPage'
import InsightsPage from '../pages/InsightsPage'
import AwarenessFlow from './AwarenessFlow'
import RecordDetail from './RecordDetail'
import ReviewLetterDetail from './ReviewLetterDetail'

const NAV_ITEMS = [
  { id: 'write',    label: '写',  icon: '✏️' },
  { id: 'records',  label: '记录', icon: '📋' },
  { id: 'insights', label: '洞察', icon: '📊' },
  { id: 'settings', label: '设置', icon: '⚙️' },
]

export default function MainLayout() {
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState(() => {
    const saved = getActiveTab()
    return NAV_ITEMS.some(n => n.id === saved) ? saved : 'write'
  })
  const [screens, setScreens]   = useState([])   // 导航栈
  const [refreshKey, setRefreshKey] = useState(0) // 触发 RecordsPage 刷新

  // 清理旧版导航栈 localStorage（一次性）
  useEffect(() => {
    localStorage.removeItem('nav_screens')
    localStorage.removeItem('active_tab')  // 旧 key，新版用 getActiveTab/saveActiveTab
  }, [])

  const currentScreen = screens[screens.length - 1] ?? null

  function push(screen) { setScreens(prev => [...prev, screen]) }
  function pop()        { setScreens(prev => prev.slice(0, -1)) }
  function reset()      { setScreens([]) }

  function goTab(id) {
    reset()
    setActiveTab(id)
    saveActiveTab(id)
  }

  // ── HomePage 完成写作后 ─────────────────────────────────────
  function handleHomeSaved(entry, isFreewrite) {
    setRefreshKey(k => k + 1)
    if (isFreewrite) {
      goTab('records')
    } else {
      push({ type: 'awareness', entry })
    }
  }

  // ── AwarenessFlow 完成后 ────────────────────────────────────
  function handleAwarenessComplete() {
    setRefreshKey(k => k + 1)
    goTab('records')
  }

  // ── AwarenessFlow 返回写作 ──────────────────────────────────
  function handleAwarenessBackToWrite() {
    pop()   // 退出 AwarenessFlow，回到写作页
  }

  // ── RecordsPage 打开详情 ────────────────────────────────────
  function handleOpenDetail(entry) {
    push({ type: 'detail', entry })
  }

  // ── RecordsPage 打开回顾信 ──────────────────────────────────
  function handleOpenLetter(letter) {
    push({ type: 'letter', letter })
  }

  // ── RecordDetail 打开 AwarenessFlow ────────────────────────
  function handleOpenAwarenessFromDetail(entry) {
    push({ type: 'awareness', entry })
  }

  // ── 渲染当前全屏覆盖页（screens 栈顶） ───────────────────────
  function renderScreen(screen) {
    if (!screen) return null
    if (screen.type === 'awareness') {
      return (
        <AwarenessFlow
          entry={screen.entry}
          onComplete={handleAwarenessComplete}
          onBackToWrite={handleAwarenessBackToWrite}
        />
      )
    }
    if (screen.type === 'detail') {
      return (
        <RecordDetail
          entry={screen.entry}
          onBack={pop}
          onOpenAwareness={handleOpenAwarenessFromDetail}
        />
      )
    }
    if (screen.type === 'letter') {
      return (
        <ReviewLetterDetail
          letter={screen.letter}
          onBack={pop}
          onOpenEntry={entryId => push({ type: 'detail', entry: { id: entryId } })}
        />
      )
    }
    return null
  }

  // ── Tab 内容 ────────────────────────────────────────────────
  function renderTab() {
    switch (activeTab) {
      case 'write':
        return <HomePage onSaved={handleHomeSaved} />
      case 'records':
        return (
          <RecordsPage
            key={refreshKey}
            onOpenDetail={handleOpenDetail}
            onOpenLetter={handleOpenLetter}
          />
        )
      case 'insights':
        return <InsightsPage />
      case 'settings':
        return <SettingsPage />
      default:
        return null
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh',
      maxWidth: 480, margin: '0 auto', background: '#faf8f4', position: 'relative' }}>

      {/* 主内容区（Tab 或全屏覆盖） */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {/* Tab 内容（全屏覆盖时仍在 DOM，避免状态丢失） */}
        <div style={{ height: '100%', display: currentScreen ? 'none' : 'flex',
          flexDirection: 'column' }}>
          {renderTab()}
        </div>

        {/* 全屏覆盖页 */}
        {currentScreen && (
          <div style={{ position: 'absolute', inset: 0, background: '#faf8f4',
            display: 'flex', flexDirection: 'column' }}>
            {renderScreen(currentScreen)}
          </div>
        )}
      </div>

      {/* 底部导航（全屏覆盖时隐藏） */}
      {!currentScreen && (
        <nav style={{
          display: 'flex', borderTop: '1px solid #ede9e2',
          background: '#faf8f4', paddingBottom: 'env(safe-area-inset-bottom)',
        }}>
          {NAV_ITEMS.map(item => (
            <button
              key={item.id}
              onClick={() => goTab(item.id)}
              style={{
                flex: 1, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                padding: '10px 0', background: 'none', border: 'none',
                cursor: 'pointer', gap: 3,
              }}
            >
              <span style={{ fontSize: 18 }}>{item.icon}</span>
              <span style={{
                fontSize: 10, letterSpacing: '0.5px',
                color: activeTab === item.id ? '#2d2928' : '#ccc',
                fontWeight: activeTab === item.id ? 600 : 400,
              }}>
                {item.label}
              </span>
            </button>
          ))}
        </nav>
      )}
    </div>
  )
}
```

- [ ] **Step 4：删除旧页面文件（先确认 build 正常）**

先 build，确认无引用错误：
```bash
npm run build
```

如果无报错，再删除：
```bash
rm src/pages/TaggingPage.jsx src/pages/ReflectionPage.jsx
```

再次 build 确认：
```bash
npm run build
```

预期：两次 build 均无报错（第二次 build 时如果有 `InsightsPage`/`ReviewLetterDetail` import 找不到文件的报错，先创建空占位文件：

```bash
echo "export default function InsightsPage() { return <div>洞察页占位</div> }" > src/pages/InsightsPage.jsx
echo "export default function ReviewLetterDetail() { return <div>回顾信占位</div> }" > src/components/ReviewLetterDetail.jsx
```

然后再 build。）

- [ ] **Step 5：手动验证（npm run dev）**

```bash
npm run dev
```

在浏览器里确认：
- 底部导航有 4 个 Tab（写/记录/洞察/设置）
- 写作页正常显示模板标签栏和输入框
- 写入内容点 ✓，非随记模板进入 AwarenessFlow 界面
- 「返回写作」能回到写作页

- [ ] **Step 6：commit**

```bash
git add src/components/MainLayout.jsx
git add -u src/pages/TaggingPage.jsx src/pages/ReflectionPage.jsx   # 记录删除
git commit -m "feat: MainLayout 4-Tab 导航，整合 AwarenessFlow，移除旧页面"
```

---

## Task 9：conversationService.js 更新（AI 分析提取 + 情绪映射）

**Files:**
- Modify: `src/lib/conversationService.js`
- Modify: `src/lib/prompts.js`

> ⚠️ 执行本 Task 前须先与用户确认 user_memory 策略（spec 附录 A）。

- [ ] **Step 1：在 prompts.js 末尾追加提取 prompt 的 emotion_display 部分**

先确认现有的 `getExtractionPrompt()` 函数内容：
```bash
grep -A 30 "getExtractionPrompt" src/lib/prompts.js
```

在 `getExtractionPrompt` 的 JSON 字段列表里新增 `emotion_display`。找到现有的 extraction prompt 中 `emotions` 字段说明那行，在其后加一行：

```
emotion_display: string[]  // 用自然语言描述用户的情绪，可以比单个词更丰富，如"克制后的难受"、"想守住边界"。最多3个，每个不超过8字。
```

具体编辑方式：读取 `getExtractionPrompt` 函数全文，找到 `"emotions"` 字段那行，在它后面追加 `emotion_display` 字段描述。如果函数是字符串拼接，直接在合适位置插入。

- [ ] **Step 2：新增 `extractFields` 导出函数**

在 `src/lib/conversationService.js` 末尾追加：

```js
// ─── 手动 AI 分析（RecordDetail 页面点「AI 分析」按钮触发）──────
// fullText：原始写作 + 对话内容拼接
// 返回 extraction 对象（包含 emotion_display 等字段）
export async function extractFields(fullText) {
  const extractPrompt = `以下是我们的对话记录：\n\n${fullText}\n\n${getExtractionPrompt()}`
  const raw = await callAI(
    [{ role: 'user', content: extractPrompt }],
    '你是数据提取助手，只返回纯 JSON，不加任何说明或 markdown。',
    { maxTokens: 1200 }
  )
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) return {}
  return JSON.parse(match[0])
}
```

- [ ] **Step 3：在 `_backgroundProcess` 里新增情绪基础层映射**

找到现有 `_backgroundProcess` 里「写回提取结果」的代码块（`updateEntry({ id: entry.id, ...})`），在写回字段列表里追加 `emotion_display` 和情绪基础层映射逻辑：

在 `src/lib/conversationService.js` 顶部 import 区加：
```js
import { mapDisplayToBase } from './emotionMap'
```

然后在 `_backgroundProcess` 里，`if (Object.keys(extraction).length > 0)` 的 `updateEntry` 调用里，在 `fields` 对象中追加：

```js
        emotion_display: extraction.emotion_display ?? [],
        // 本地映射情绪基础层（零 token）
        ...(extraction.emotion_display?.length ? (() => {
          const { baseWords, minConfidence } = mapDisplayToBase(extraction.emotion_display)
          return { emotions: baseWords, emotion_confidence: minConfidence }
        })() : {}),
```

完整替换后的 `updateEntry` 调用（只修改 fields 对象，其他不变）：

```js
    updateEntry({
      id: entry.id,
      userId: entry.user_id,
      fields: {
        emotions:                  extraction.emotions                ?? [],
        emotion_display:           extraction.emotion_display         ?? [],
        emotion_confidence:        extraction.emotion_display?.length
          ? mapDisplayToBase(extraction.emotion_display).minConfidence
          : null,
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
```

- [ ] **Step 4：build 检查**

```bash
npm run build
```

预期：无编译错误。

- [ ] **Step 5：commit**

```bash
git add src/lib/conversationService.js src/lib/prompts.js
git commit -m "feat: conversationService 新增 emotion_display 提取和基础层映射"
```

---

## Task 10：RecordsPage.jsx 更新（新卡片 + 回顾信穿插）

**Files:**
- Modify: `src/pages/RecordsPage.jsx`

- [ ] **Step 1：读取现有 RecordsPage.jsx 全文**

```bash
cat src/pages/RecordsPage.jsx
```

记下现有的 `fetchEntries` 调用方式和 `groupByDate` 逻辑，下面要扩展它。

- [ ] **Step 2：替换 RecordsPage.jsx**

覆盖 `src/pages/RecordsPage.jsx`（全部替换）：

```jsx
// src/pages/RecordsPage.jsx
// 记录列表：journal_entries + review_letters 混合时间流，按日期分组
import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { db } from '../lib/db'
import { deleteEntry } from '../lib/journalService'
import { resolveTemplate } from '../lib/templates'
import { checkAndGenerateLetter } from '../lib/reviewLetterService'

// 把 ISO 字符串格式化成"4月9日 周三"
function formatGroupDate(isoStr) {
  const d = new Date(isoStr)
  return d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })
}

// 把 ISO 字符串格式化成"09:41"
function formatTime(isoStr) {
  const d = new Date(isoStr)
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

// 单条记录卡片
function EntryCard({ entry, onOpen, onDelete }) {
  const tpl = resolveTemplate(entry.template_type)
  const emotions = entry.emotion_display?.length
    ? entry.emotion_display
    : (entry.emotions ?? [])
  const preview = (entry.content ?? '').slice(0, 60)

  return (
    <div
      onClick={() => onOpen(entry)}
      style={{
        background: 'white', borderRadius: 12, padding: '12px 14px',
        marginBottom: 8, cursor: 'pointer',
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 10, color: tpl.color, fontWeight: 500 }}>
          {tpl.label}
        </span>
        <span style={{ fontSize: 10, color: '#ccc' }}>{formatTime(entry.created_at)}</span>
      </div>
      <div style={{ fontSize: 13, color: '#555', lineHeight: 1.6,
        marginBottom: emotions.length ? 8 : 0, display: '-webkit-box',
        WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
        {preview}
      </div>
      {emotions.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {emotions.slice(0, 3).map(w => (
            <span key={w} style={{
              fontSize: 10, background: '#f0ece4', color: '#8a7a6a',
              padding: '2px 7px', borderRadius: 10,
            }}>{w}</span>
          ))}
          {emotions.length > 3 && (
            <span style={{ fontSize: 10, color: '#bbb' }}>…</span>
          )}
        </div>
      )}
    </div>
  )
}

// 回顾信卡片
function LetterCard({ letter, onOpen }) {
  const start = new Date(letter.period_start).toLocaleDateString('zh-CN',
    { month: 'long', day: 'numeric' })
  const end = new Date(letter.period_end).toLocaleDateString('zh-CN',
    { month: 'long', day: 'numeric' })
  const preview = (letter.content ?? '').slice(0, 50)

  return (
    <div
      onClick={() => onOpen(letter)}
      style={{
        background: '#fffdf8', border: '1px solid #f0e8d4',
        borderRadius: 12, padding: '12px 14px', marginBottom: 8,
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
        <span style={{ fontSize: 12 }}>✉</span>
        <span style={{ fontSize: 11, color: '#c9a96e', fontWeight: 500 }}>回顾信</span>
        {!letter.is_read && (
          <span style={{ width: 6, height: 6, borderRadius: '50%',
            background: '#c9a96e', display: 'inline-block' }} />
        )}
      </div>
      <div style={{ fontSize: 13, color: '#555', lineHeight: 1.6, marginBottom: 4,
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
        overflow: 'hidden' }}>
        {preview}
      </div>
      <div style={{ fontSize: 10, color: '#bbb' }}>
        {start} - {end} · {letter.entry_ids?.length ?? 0} 条记录
      </div>
    </div>
  )
}

export default function RecordsPage({ onOpenDetail, onOpenLetter }) {
  const { user } = useAuth()
  const [items, setItems] = useState([])     // 合并后的时间流
  const [loading, setLoading] = useState(true)
  const [latestUnreadLetter, setLatestUnreadLetter] = useState(null)

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)

    // 触发回顾信检查（异步，不阻塞列表加载）
    checkAndGenerateLetter(user.id).catch(() => {})

    const [entriesRes, lettersRes] = await Promise.all([
      db.from('journal_entries')
        .select('id, content, template_type, created_at, emotion_display, emotions, emotion_confidence')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50),
      db.from('review_letters')
        .select('id, content, period_start, period_end, is_read, created_at, entry_ids')
        .eq('user_id', user.id)
        .order('period_end', { ascending: false })
        .limit(20),
    ])

    const entries = entriesRes.data ?? []
    const letters = lettersRes.data ?? []

    // 找最新未读回顾信
    const unread = letters.find(l => !l.is_read)
    setLatestUnreadLetter(unread ?? null)

    // 合并，按时间降序
    const combined = [
      ...entries.map(e => ({ ...e, _type: 'entry',  _sortKey: e.created_at })),
      ...letters.map(l => ({ ...l, _type: 'letter', _sortKey: l.period_end })),
    ].sort((a, b) => new Date(b._sortKey) - new Date(a._sortKey))

    setItems(combined)
    setLoading(false)
  }, [user])

  useEffect(() => { load() }, [load])

  // 按日期分组
  const groups = []
  let currentDate = ''
  items.forEach(item => {
    const dateKey = formatGroupDate(item._sortKey)
    if (dateKey !== currentDate) {
      currentDate = dateKey
      groups.push({ date: dateKey, items: [] })
    }
    groups[groups.length - 1].items.push(item)
  })

  async function handleDelete(entry) {
    await deleteEntry({ id: entry.id, userId: user.id })
    load()
  }

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center',
        justifyContent: 'center', color: '#ccc', fontSize: 14 }}>
        加载中…
      </div>
    )
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', background: '#f5f3ef' }}>

      {/* 未读回顾信横幅 */}
      {latestUnreadLetter && (
        <div
          onClick={() => onOpenLetter(latestUnreadLetter)}
          style={{
            background: '#fffdf8', borderBottom: '1px solid #f0e8d4',
            padding: '12px 18px', display: 'flex', alignItems: 'center',
            gap: 8, cursor: 'pointer',
          }}
        >
          <span style={{ fontSize: 14 }}>✉</span>
          <span style={{ flex: 1, fontSize: 13, color: '#8a7a5a' }}>
            你有一封新的回顾信
          </span>
          <span style={{ fontSize: 12, color: '#c9a96e' }}>查看 →</span>
        </div>
      )}

      {/* 按日期分组的时间流 */}
      <div style={{ padding: '12px 16px' }}>
        {groups.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#ccc',
            fontSize: 14, padding: '60px 0' }}>
            还没有记录，去写第一条吧
          </div>
        ) : (
          groups.map(group => (
            <div key={group.date} style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, color: '#bbb', marginBottom: 8,
                letterSpacing: '0.5px' }}>
                {group.date}
              </div>
              {group.items.map(item => (
                item._type === 'entry' ? (
                  <EntryCard
                    key={item.id}
                    entry={item}
                    onOpen={onOpenDetail}
                    onDelete={handleDelete}
                  />
                ) : (
                  <LetterCard
                    key={item.id}
                    letter={item}
                    onOpen={onOpenLetter}
                  />
                )
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3：build 检查**

```bash
npm run build
```

预期：如果 `reviewLetterService.js` 还没创建会报 import 错误 → 先建空占位：

```bash
echo "export async function checkAndGenerateLetter() {}" > src/lib/reviewLetterService.js
```

再 build，直到无报错。

- [ ] **Step 4：commit**

```bash
git add src/pages/RecordsPage.jsx src/lib/reviewLetterService.js
git commit -m "feat: RecordsPage 新卡片布局，穿插回顾信，未读横幅"
```

---

## Task 11：RecordDetail.jsx 更新（紧凑布局 + AI 分析按钮）

**Files:**
- Modify: `src/components/RecordDetail.jsx`

- [ ] **Step 1：读取现有 RecordDetail.jsx 前80行，了解当前结构**

```bash
head -80 src/components/RecordDetail.jsx
```

- [ ] **Step 2：覆盖 RecordDetail.jsx**

覆盖 `src/components/RecordDetail.jsx`（全部替换）：

```jsx
// src/components/RecordDetail.jsx
// 记录详情页：紧凑布局，情绪标签可编辑，核心字段单行，浮动觉察按钮
import { useState, useEffect } from 'react'
import { db } from '../lib/db'
import { updateEntry } from '../lib/journalService'
import { resolveTemplate } from '../lib/templates'
import { mapDisplayToBase } from '../lib/emotionMap'
import { extractFields } from '../lib/conversationService'

function formatDateTime(isoStr) {
  const d = new Date(isoStr)
  return d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

// 情绪胶囊标签
function EmotionTag({ word }) {
  return (
    <span style={{
      fontSize: 12, background: '#f0ece4', color: '#8a7a6a',
      padding: '3px 10px', borderRadius: 20, display: 'inline-block',
    }}>
      {word}
    </span>
  )
}

// 核心字段单行（空时不渲染）
function FieldRow({ label, value }) {
  if (!value || (Array.isArray(value) && value.length === 0)) return null
  const display = Array.isArray(value) ? value.join('、') : value
  return (
    <div style={{ display: 'flex', gap: 12, paddingBottom: 6, alignItems: 'flex-start' }}>
      <span style={{ fontSize: 10, color: '#aaa', flexShrink: 0, minWidth: 44,
        paddingTop: 2 }}>{label}</span>
      <span style={{ fontSize: 13, color: '#333', lineHeight: 1.6 }}>{display}</span>
    </div>
  )
}

export default function RecordDetail({ entry: initialEntry, onBack, onOpenAwareness }) {
  const [entry, setEntry] = useState(initialEntry)
  const [messages, setMessages] = useState([])
  const [analyzing, setAnalyzing] = useState(false)
  const [toast, setToast] = useState('')         // 底部 toast 提示

  const tpl = resolveTemplate(entry.template_type)

  // 读取完整 entry 数据（initialEntry 可能是列表页的简化对象）
  useEffect(() => {
    async function loadFull() {
      const { data } = await db.from('journal_entries')
        .select('*').eq('id', initialEntry.id).single()
      if (data) setEntry(data)
    }
    loadFull()

    // 读取对话记录
    async function loadMessages() {
      const { data } = await db.from('conversations')
        .select('messages').eq('entry_id', initialEntry.id)
        .eq('context_type', 'entry').single()
      setMessages(data?.messages ?? [])
    }
    loadMessages()
  }, [initialEntry.id])

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 2000)
  }

  // ── inline 字段编辑（onBlur 保存）─────────────────────────
  async function handleFieldSave(field, value) {
    const { error } = await updateEntry({
      id: entry.id, userId: entry.user_id,
      fields: { [field]: value },
    })
    if (error) {
      showToast('保存失败，请检查网络')
      // 恢复原值（直接重新读取）
      const { data } = await db.from('journal_entries')
        .select('*').eq('id', entry.id).single()
      if (data) setEntry(data)
    }
  }

  // ── AI 分析 ──────────────────────────────────────────────
  async function handleAIAnalyze() {
    setAnalyzing(true)
    try {
      // 拼接完整文本
      const msgText = messages
        .filter(m => m.source !== 'raw')
        .map(m => `${m.role === 'user' ? '答' : '问'}：${m.content}`)
        .join('\n')
      const fullText = `原始写作：\n${entry.content}\n\n${msgText}`

      const extraction = await extractFields(fullText)
      if (!extraction || Object.keys(extraction).length === 0) {
        showToast('分析失败，请稍后重试')
        return
      }

      const { baseWords, minConfidence } = mapDisplayToBase(extraction.emotion_display ?? [])

      await updateEntry({
        id: entry.id, userId: entry.user_id,
        fields: {
          ...extraction,
          emotions: baseWords,
          emotion_confidence: minConfidence,
        },
      })

      // 刷新
      const { data } = await db.from('journal_entries')
        .select('*').eq('id', entry.id).single()
      if (data) setEntry(data)
    } catch (e) {
      console.error('[RecordDetail] AI分析失败:', e)
      showToast('分析失败，请稍后重试')
    } finally {
      setAnalyzing(false)
    }
  }

  const hasAIFields = entry.emotion_display?.length > 0 || entry.reflection_insight
  const emotions = entry.emotion_display?.length
    ? entry.emotion_display : (entry.emotions ?? [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%',
      background: '#faf8f4', overflowY: 'auto', paddingBottom: 80 }}>

      {/* 顶部导航 */}
      <div style={{ padding: '12px 18px 0', display: 'flex', alignItems: 'center' }}>
        <button onClick={onBack}
          style={{ background: 'none', border: 'none', color: '#bbb',
            cursor: 'pointer', fontSize: 14 }}>
          ← 返回
        </button>
      </div>

      <div style={{ padding: '16px 18px 0' }}>
        {/* 模板 + 时间 */}
        <div style={{ fontSize: 12, color: '#aaa', marginBottom: 14 }}>
          <span style={{ color: tpl.color, marginRight: 6 }}>{tpl.label}</span>
          · {formatDateTime(entry.created_at)}
        </div>

        {/* 情绪标签区 */}
        {emotions.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
            {emotions.map(w => <EmotionTag key={w} word={w} />)}
          </div>
        )}
        {entry.emotion_confidence != null && entry.emotion_confidence < 0.75 && (
          <div style={{ fontSize: 10, color: '#bbb', marginBottom: 12 }}>
            基础标签待确认
          </div>
        )}

        {/* 核心字段区 */}
        <div style={{ marginTop: 14, marginBottom: 14,
          borderTop: '1px solid #ede9e2', paddingTop: 12 }}>
          {hasAIFields ? (
            <>
              <FieldRow label="核心需求" value={entry.core_needs} />
              <FieldRow label="认知"     value={entry.cognitive_analysis} />
              <FieldRow label="身体感受" value={entry.body_sensations} />
              <FieldRow label="洞见"     value={entry.reflection_insight} />
            </>
          ) : (
            <div>
              <div style={{ fontSize: 12, color: '#bbb', marginBottom: 10 }}>
                暂无分析，点击按钮让 AI 帮你整理这条记录的核心内容
              </div>
              <button
                onClick={handleAIAnalyze}
                disabled={analyzing}
                style={{
                  fontSize: 12, color: '#888', border: '1px solid #e0dbd4',
                  borderRadius: 8, padding: '6px 12px',
                  background: 'none', cursor: 'pointer',
                }}
              >
                {analyzing ? '分析中…' : '✦ AI 分析'}
              </button>
            </div>
          )}
        </div>

        {/* 原始记录流 */}
        <div style={{ borderTop: '1px solid #ede9e2', paddingTop: 14 }}>
          <div style={{ fontSize: 11, color: '#ccc', marginBottom: 10,
            textAlign: 'center', letterSpacing: '0.5px' }}>
            ── 原始记录流 ──
          </div>
          {messages.length === 0 ? (
            <div style={{ fontSize: 14, color: '#2d2d2d', lineHeight: 1.85 }}>
              {entry.content}
            </div>
          ) : (
            messages.map((msg, i) => {
              if (msg.source === 'raw') {
                return (
                  <div key={i} style={{ fontSize: 14, color: '#2d2d2d',
                    lineHeight: 1.85, marginBottom: 16 }}>
                    {msg.content}
                  </div>
                )
              }
              if (msg.role === 'local' || msg.role === 'assistant') {
                return (
                  <div key={i} style={{ fontSize: 12, color: '#aaa',
                    lineHeight: 1.65, marginBottom: 4 }}>
                    {msg.role === 'assistant' && (
                      <span style={{ fontSize: 10, marginRight: 3 }}>✦</span>
                    )}
                    {msg.content}
                  </div>
                )
              }
              if (msg.role === 'user' && msg.source !== 'raw') {
                return (
                  <div key={i} style={{
                    fontSize: 14, color: '#2d2d2d', lineHeight: 1.85,
                    marginBottom: 16, borderTop: '1px solid #f0ece4', paddingTop: 8,
                  }}>
                    {msg.content}
                  </div>
                )
              }
              return null
            })
          )}
        </div>
      </div>

      {/* Toast 提示 */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 90, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.7)', color: 'white',
          padding: '8px 16px', borderRadius: 20, fontSize: 13, zIndex: 100,
        }}>
          {toast}
        </div>
      )}

      {/* 浮动「✦ 深度觉察」按钮 */}
      <button
        onClick={() => onOpenAwareness(entry)}
        style={{
          position: 'fixed', bottom: 32, left: '50%',
          transform: 'translateX(-50%)',
          background: '#2d2928', color: 'white',
          borderRadius: 20, padding: '10px 20px',
          fontSize: 13, border: 'none', cursor: 'pointer',
          boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
          whiteSpace: 'nowrap',
        }}
      >
        ✦ 深度觉察
      </button>
    </div>
  )
}
```

- [ ] **Step 3：补充情绪标签编辑功能（在 RecordDetail.jsx 里修改）**

情绪标签区需要支持点击编辑（不调 AI，只本地映射）。在已写好的 RecordDetail.jsx 里做以下补充：

**3a：追加 state 和编辑 handler**（在 `const [toast, setToast] = useState('')` 后面加）：

```js
  const [editingEmotions, setEditingEmotions] = useState(false)
  const [emotionDraft, setEmotionDraft] = useState('')  // 逗号分隔的编辑文本
```

**3b：在「情绪标签区」的 JSX 上加点击切换编辑**。找到 `{/* 情绪标签区 */}` 那块，把它替换为：

```jsx
        {/* 情绪标签区（点击可编辑） */}
        {emotions.length > 0 && !editingEmotions && (
          <div
            onClick={() => {
              setEmotionDraft(emotions.join('、'))
              setEditingEmotions(true)
            }}
            style={{ display: 'flex', gap: 6, flexWrap: 'wrap',
              marginBottom: 4, cursor: 'pointer' }}
          >
            {emotions.map(w => <EmotionTag key={w} word={w} />)}
          </div>
        )}
        {editingEmotions && (
          <div style={{ marginBottom: 4 }}>
            <input
              value={emotionDraft}
              onChange={e => setEmotionDraft(e.target.value)}
              autoFocus
              onBlur={async () => {
                const words = emotionDraft.split(/[、,，\s]+/).map(w => w.trim()).filter(Boolean)
                const { baseWords, minConfidence } = mapDisplayToBase(words)
                await updateEntry({
                  id: entry.id, userId: entry.user_id,
                  fields: { emotion_display: words, emotions: baseWords,
                    emotion_confidence: minConfidence },
                })
                setEntry(e => ({ ...e, emotion_display: words,
                  emotions: baseWords, emotion_confidence: minConfidence }))
                setEditingEmotions(false)
              }}
              style={{
                width: '100%', border: '1px solid #e0dbd4', borderRadius: 8,
                padding: '6px 10px', fontSize: 13, outline: 'none',
                background: 'white', fontFamily: 'inherit',
              }}
              placeholder="用逗号分隔，如：难受、委屈"
            />
            <div style={{ fontSize: 11, color: '#bbb', marginTop: 4 }}>
              完成后点其他地方自动保存
            </div>
          </div>
        )}
```

- [ ] **Step 4：补充关联区（关联回顾信 + 分类标签）**

在情绪标签编辑区和「原始记录流」分隔线之间，追加关联区 JSX：

```jsx
        {/* 关联区 */}
        {(entry.category_tags?.length > 0) && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {entry.category_tags.map(tag => (
              <span key={tag} style={{
                fontSize: 10, color: '#888',
                border: '1px solid #e0dbd4', borderRadius: 4,
                padding: '2px 6px',
              }}>
                #{tag}
              </span>
            ))}
          </div>
        )}
```

> 注：回顾信关联（`letter_ids`）字段目前 journal_entries 表没有该字段，属于 Phase 2 数据。本次关联区只显示 `category_tags`。

- [ ] **Step 5：build 检查**

```bash
npm run build
```

- [ ] **Step 6：commit**

```bash
git add src/components/RecordDetail.jsx
git commit -m "feat: RecordDetail 情绪标签可点击编辑（本地映射），关联标签区"
```

---

## Task 12：reviewLetterService.js 完整实现 + ReviewLetterDetail.jsx

**Files:**
- Overwrite: `src/lib/reviewLetterService.js`（覆盖 Task 10 里的占位文件）
- Create: `src/components/ReviewLetterDetail.jsx`
- Modify: `src/lib/prompts.js`（追加回顾信 prompt）

- [ ] **Step 1：在 prompts.js 末尾追加回顾信 prompt**

在 `src/lib/prompts.js` 末尾追加：

```js
// ─── 回顾信生成 prompt ──────────────────────────────────────────
export function getReviewLetterPrompt(entriesText) {
  return `你会收到用户这段时间写的日记条目。请写一封温暖的回顾信，语气像一位长期陪伴的朋友。

要求：
- 不评判，不说教，不鼓励"你下次应该..."
- 帮助用户看见反复出现的情绪和模式
- 用具体细节（用户自己写的词和场景），而不是泛泛而谈
- 结尾留一个轻柔的问题或邀请，用户可以选择回应也可以不回应
- 长度：300-500字

写完信之后，在信的最后附上以下JSON（不要解释，直接输出）：
\`\`\`json
{
  "recurring_emotions": [],
  "recurring_people": [],
  "core_needs": [],
  "patterns": [],
  "growth_notes": []
}
\`\`\`

以下是用户的日记条目：

${entriesText}`
}
```

- [ ] **Step 2：覆盖 reviewLetterService.js**

覆盖 `src/lib/reviewLetterService.js`：

```js
// src/lib/reviewLetterService.js
// 回顾信触发检查 + 生成逻辑
import { db } from './db'
import { callAI } from './aiClient'
import { getReviewLetterPrompt } from './prompts'
import { getMemory } from './memory'

// ── 读取用户触发偏好 ───────────────────────────────────────────
async function getUserLetterPrefs(userId) {
  // 主存储：user_memory（多端同步）
  try {
    const memory = await getMemory(userId)
    const prefs = memory?.user_profile?.letter_prefs
    if (prefs) return prefs
  } catch { /* ignore */ }

  // 降级：localStorage
  try {
    const stored = localStorage.getItem(`letter_prefs_${userId}`)
    if (stored) return JSON.parse(stored)
  } catch { /* ignore */ }

  // 默认：每写 10 条自动触发
  return { type: 'count', count_threshold: 10, day_interval: 7, require_new_entries: true }
}

// ── 保存用户触发偏好 ──────────────────────────────────────────
export async function saveUserLetterPrefs(userId, prefs, updateMemoryFn) {
  // 主存储：user_memory
  try {
    await updateMemoryFn({ user_profile: { letter_prefs: prefs } })
  } catch (e) {
    console.error('[reviewLetter] 保存偏好到 user_memory 失败:', e)
  }
  // 降级缓存：localStorage
  try {
    localStorage.setItem(`letter_prefs_${userId}`, JSON.stringify(prefs))
  } catch { /* ignore */ }
}

// ── 生成回顾信 ────────────────────────────────────────────────
async function generateReviewLetter(userId, periodStart, prefs) {
  const periodEnd = new Date().toISOString()

  const { data: entries } = await db.from('journal_entries')
    .select('id, content, emotions, emotion_display, core_needs, created_at')
    .eq('user_id', userId)
    .gt('created_at', periodStart ?? '1970-01-01')
    .lte('created_at', periodEnd)
    .order('created_at', { ascending: true })
    .limit(20)

  if (!entries?.length) return

  const entriesText = entries.map((e, i) =>
    `[第${i + 1}条，${e.created_at.slice(0, 10)}]\n${e.content}`
  ).join('\n\n---\n\n')

  const prompt = getReviewLetterPrompt(entriesText)
  const rawLetter = await callAI(
    [{ role: 'user', content: prompt }],
    '你是用户的内心陪伴者，写一封温和的回顾信，不评判，不说教，帮助用户看见自己。',
    { maxTokens: 1000 }
  )

  // 提取末尾 JSON insights
  const insightsMatch = rawLetter.match(/```json([\s\S]*?)```/)
  let insights = {}
  if (insightsMatch) {
    try { insights = JSON.parse(insightsMatch[1]) }
    catch (e) { console.warn('[reviewLetter] insights 解析失败:', e) }
  }
  const letterContent = rawLetter.replace(/```json[\s\S]*?```/, '').trim()

  const { error } = await db.from('review_letters').insert({
    user_id: userId,
    entry_ids: entries.map(e => e.id),
    content: letterContent,
    insights,
    trigger_type: prefs.type,
    period_start: periodStart ?? entries[0]?.created_at,
    period_end: periodEnd,
    is_read: false,
  })

  if (error) console.error('[reviewLetter] 插入失败:', error.message)
}

// ── 主入口：检查是否需要生成（应用启动 / 记录页加载时调用）──
export async function checkAndGenerateLetter(userId) {
  const prefs = await getUserLetterPrefs(userId)
  if (prefs.type === 'manual') return  // 手动触发，不自动生成

  const { data: lastLetter } = await db.from('review_letters')
    .select('created_at, period_end')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  const lastDate = lastLetter?.created_at ? new Date(lastLetter.created_at) : null
  const daysSinceLast = lastDate
    ? (Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24)
    : Infinity

  const { count: newEntryCount } = await db.from('journal_entries')
    .select('id', { count: 'exact' })
    .eq('user_id', userId)
    .gt('created_at', lastLetter?.period_end ?? '1970-01-01')
    .in('template_type', ['awareness', 'emotion', 'gratitude'])

  if (prefs.require_new_entries && newEntryCount === 0) return

  const shouldGenerate =
    (prefs.type === 'days'  && daysSinceLast >= prefs.day_interval) ||
    (prefs.type === 'count' && newEntryCount >= prefs.count_threshold)

  if (shouldGenerate) {
    await generateReviewLetter(userId, lastLetter?.period_end, prefs)
  }
}

// ── 手动立即生成（设置页按钮调用）──────────────────────────────
export async function generateLetterNow(userId) {
  const { data: lastLetter } = await db.from('review_letters')
    .select('period_end')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  const prefs = await getUserLetterPrefs(userId)
  await generateReviewLetter(userId, lastLetter?.period_end ?? null, prefs)
}
```

- [ ] **Step 3：写 ReviewLetterDetail.jsx**

新建 `src/components/ReviewLetterDetail.jsx`：

```jsx
// src/components/ReviewLetterDetail.jsx
// 回顾信详情页：显示信的正文、关联记录跳转、用户回应输入
import { useState, useEffect } from 'react'
import { db } from '../lib/db'

function formatPeriod(start, end) {
  const s = new Date(start).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
  const e = new Date(end).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
  return `${s} - ${e}`
}

export default function ReviewLetterDetail({ letter: initialLetter, onBack, onOpenEntry }) {
  const [letter, setLetter] = useState(initialLetter)
  const [response, setResponse] = useState(initialLetter.user_response ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // 进入后标记已读
  useEffect(() => {
    if (letter && !letter.is_read) {
      db.from('review_letters')
        .update({ is_read: true })
        .eq('id', letter.id)
        .then(() => setLetter(l => ({ ...l, is_read: true })))
    }
  }, [letter?.id])

  async function handleSaveResponse() {
    setSaving(true)
    const { error } = await db.from('review_letters')
      .update({ user_response: response })
      .eq('id', letter.id)
    setSaving(false)
    if (!error) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%',
      background: '#faf8f4', overflowY: 'auto', paddingBottom: 40 }}>

      {/* 顶部 */}
      <div style={{ padding: '12px 18px 0' }}>
        <button onClick={onBack}
          style={{ background: 'none', border: 'none', color: '#bbb',
            cursor: 'pointer', fontSize: 14 }}>
          ← 返回
        </button>
      </div>

      <div style={{ padding: '16px 18px 0' }}>
        {/* 标题区 */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#333', marginBottom: 4 }}>
            ✉ 回顾信
          </div>
          <div style={{ fontSize: 12, color: '#aaa' }}>
            {formatPeriod(letter.period_start, letter.period_end)}
            {' · '}{letter.entry_ids?.length ?? 0} 条记录
          </div>
        </div>

        {/* 信的正文 */}
        <div style={{ fontSize: 15, color: '#2d2d2d', lineHeight: 1.85,
          marginBottom: 24 }}>
          {letter.content}
        </div>

        {/* 关联记录跳转 */}
        {letter.entry_ids?.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 11, color: '#aaa', marginBottom: 8 }}>关联记录</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {letter.entry_ids.map((entryId, idx) => (
                <button
                  key={entryId}
                  onClick={() => onOpenEntry(entryId)}
                  style={{
                    fontSize: 11, color: '#888',
                    border: '1px solid #e0dbd4', borderRadius: 4,
                    padding: '2px 8px', background: 'none', cursor: 'pointer',
                  }}
                >
                  #{idx + 1} ↗
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 分隔线 */}
        <div style={{ borderTop: '1px solid #ede9e2', marginBottom: 16 }} />

        {/* 用户回应 */}
        <div style={{ fontSize: 11, color: '#aaa', marginBottom: 8 }}>你的回应</div>
        <textarea
          value={response}
          onChange={e => setResponse(e.target.value)}
          placeholder="看完这封信，你有什么想说的……"
          style={{
            width: '100%', minHeight: 100,
            border: '1px solid #ede9e2', borderRadius: 10,
            padding: 12, fontSize: 14, lineHeight: 1.7,
            color: '#2d2d2d', fontFamily: 'inherit',
            background: 'white', resize: 'none', outline: 'none',
            boxSizing: 'border-box', caretColor: '#aaa',
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
          <button
            onClick={handleSaveResponse}
            disabled={saving}
            style={{
              fontSize: 13, background: '#2d2928', color: 'white',
              border: 'none', borderRadius: 10, padding: '8px 16px',
              cursor: 'pointer',
            }}
          >
            {saved ? '已保存 ✓' : (saving ? '保存中…' : '保存回应')}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4：build 检查**

```bash
npm run build
```

预期：无报错。

- [ ] **Step 5：commit**

```bash
git add src/lib/reviewLetterService.js src/components/ReviewLetterDetail.jsx src/lib/prompts.js
git commit -m "feat: reviewLetterService 完整实现，ReviewLetterDetail 详情页"
```

---

## Task 13：InsightsPage.jsx（洞察页）

**Files:**
- Create: `src/pages/InsightsPage.jsx`（覆盖 Task 8 里的占位文件）

- [ ] **Step 1：写 InsightsPage.jsx**

覆盖 `src/pages/InsightsPage.jsx`：

```jsx
// src/pages/InsightsPage.jsx
// 洞察页：心情曲线 + 情绪频率 + 核心需求（手写 SVG，不引入图表库）
import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { db } from '../lib/db'

// 过去 30 天的 ISO 起始时间
function thirtyDaysAgo() {
  const d = new Date()
  d.setDate(d.getDate() - 30)
  return d.toISOString()
}

// 简单条形图（手写 SVG）
function BarChart({ data }) {
  // data: [{ label, count }]，按 count 降序，最多显示8条
  const top = [...data].sort((a, b) => b.count - a.count).slice(0, 8)
  const max = top[0]?.count || 1
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {top.map(({ label, count }) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: '#555', width: 52, textAlign: 'right',
            flexShrink: 0 }}>{label}</span>
          <div style={{ flex: 1, height: 10, background: '#f0ece4', borderRadius: 5 }}>
            <div style={{
              width: `${(count / max) * 100}%`, height: '100%',
              background: '#c9a96e', borderRadius: 5, transition: 'width 0.4s',
            }} />
          </div>
          <span style={{ fontSize: 11, color: '#bbb', width: 28 }}>{count}次</span>
        </div>
      ))}
    </div>
  )
}

// 心情折线图（手写 SVG）
function MoodLine({ moodData }) {
  if (!moodData.length) {
    return (
      <div style={{ textAlign: 'center', color: '#ccc', fontSize: 13, padding: '20px 0' }}>
        暂无数据
      </div>
    )
  }
  const W = 300, H = 80
  const scores = moodData.map(d => d.overall_state_score)
  const minS = Math.min(...scores), maxS = Math.max(...scores)
  const range = maxS - minS || 1
  const pts = moodData.map((d, i) => {
    const x = (i / (moodData.length - 1 || 1)) * W
    const y = H - ((d.overall_state_score - minS) / range) * H * 0.8 - H * 0.1
    return `${x},${y}`
  }).join(' ')

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke="#c9a96e" strokeWidth="2"
        strokeLinejoin="round" strokeLinecap="round" />
      {moodData.map((d, i) => {
        const x = (i / (moodData.length - 1 || 1)) * W
        const y = H - ((d.overall_state_score - minS) / range) * H * 0.8 - H * 0.1
        return <circle key={i} cx={x} cy={y} r="3" fill="#c9a96e" />
      })}
    </svg>
  )
}

export default function InsightsPage() {
  const { user } = useAuth()
  const [moodData, setMoodData] = useState([])
  const [emotionCounts, setEmotionCounts] = useState([])
  const [needsCounts, setNeedsCounts] = useState([])
  const [latestLetter, setLatestLetter] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    async function load() {
      const since = thirtyDaysAgo()

      const [moodRes, emotionRes, needsRes, letterRes] = await Promise.all([
        db.from('journal_entries')
          .select('created_at, overall_state_score')
          .eq('user_id', user.id)
          .not('overall_state_score', 'is', null)
          .gte('created_at', since)
          .order('created_at', { ascending: true }),
        db.from('journal_entries')
          .select('emotions')
          .eq('user_id', user.id)
          .gte('created_at', since),
        db.from('journal_entries')
          .select('core_needs')
          .eq('user_id', user.id)
          .gte('created_at', since),
        db.from('review_letters')
          .select('id, content, period_start, period_end, is_read')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .single(),
      ])

      setMoodData(moodRes.data ?? [])
      setLatestLetter(letterRes.data ?? null)

      // 情绪频率：展开数组统计
      const eCounts = {}
      ;(emotionRes.data ?? []).forEach(row => {
        ;(row.emotions ?? []).forEach(w => {
          eCounts[w] = (eCounts[w] ?? 0) + 1
        })
      })
      setEmotionCounts(Object.entries(eCounts).map(([label, count]) => ({ label, count })))

      // 核心需求频率
      const nCounts = {}
      ;(needsRes.data ?? []).forEach(row => {
        ;(row.core_needs ?? []).forEach(w => {
          nCounts[w] = (nCounts[w] ?? 0) + 1
        })
      })
      setNeedsCounts(Object.entries(nCounts).map(([label, count]) => ({ label, count })))

      setLoading(false)
    }
    load()
  }, [user])

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center',
        justifyContent: 'center', color: '#ccc', fontSize: 14 }}>
        加载中…
      </div>
    )
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px',
      background: '#f5f3ef' }}>

      {/* 页面标题 */}
      <div style={{ fontSize: 16, fontWeight: 600, color: '#333', marginBottom: 20 }}>
        洞察
      </div>

      {/* 最新回顾信预览 */}
      {latestLetter && (
        <div style={{ background: '#fffdf8', border: '1px solid #f0e8d4',
          borderRadius: 12, padding: '12px 14px', marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: '#c9a96e', marginBottom: 6 }}>
            ✉ 最新回顾信
            {!latestLetter.is_read && (
              <span style={{ marginLeft: 6, width: 6, height: 6, borderRadius: '50%',
                background: '#c9a96e', display: 'inline-block', verticalAlign: 'middle' }} />
            )}
          </div>
          <div style={{ fontSize: 13, color: '#555', lineHeight: 1.65,
            display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
            overflow: 'hidden' }}>
            {latestLetter.content}
          </div>
        </div>
      )}

      <div style={{ fontSize: 11, color: '#aaa', marginBottom: 16,
        letterSpacing: '0.5px' }}>
        ── 最近 30 天 ──
      </div>

      {/* 心情曲线 */}
      <div style={{ background: 'white', borderRadius: 12, padding: '14px',
        marginBottom: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
        <div style={{ fontSize: 12, color: '#555', fontWeight: 500, marginBottom: 12 }}>
          心情曲线
        </div>
        <MoodLine moodData={moodData} />
      </div>

      {/* 情绪频率 */}
      <div style={{ background: 'white', borderRadius: 12, padding: '14px',
        marginBottom: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
        <div style={{ fontSize: 12, color: '#555', fontWeight: 500, marginBottom: 12 }}>
          情绪频率
        </div>
        {emotionCounts.length ? (
          <BarChart data={emotionCounts} />
        ) : (
          <div style={{ fontSize: 13, color: '#ccc', textAlign: 'center', padding: '10px 0' }}>
            暂无数据（完成 AI 分析后可见）
          </div>
        )}
      </div>

      {/* 核心需求 */}
      {needsCounts.length > 0 && (
        <div style={{ background: 'white', borderRadius: 12, padding: '14px',
          marginBottom: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: 12, color: '#555', fontWeight: 500, marginBottom: 12 }}>
            核心需求分布
          </div>
          <BarChart data={needsCounts} />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2：追加标签统计数据查询和展示**

在 `InsightsPage.jsx` 已有代码的基础上：

**2a**：在 `useState` 声明区追加（在 `const [loading, setLoading] = useState(true)` 后）：

```js
  const [tagCounts, setTagCounts] = useState([])
```

**2b**：在 `load()` 函数的 `Promise.all` 里追加第五个查询（在 `letterRes` 后面加逗号和新查询）：

```js
        db.from('journal_entries')
          .select('category_tags')
          .eq('user_id', user.id)
          .gte('created_at', since),
```

把返回值命名为 `tagsRes`，在数组解构里对应加上。

**2c**：在 `setNeedsCounts` 调用之后，追加标签统计：

```js
      // 标签频率
      const tCounts = {}
      ;(tagsRes.data ?? []).forEach(row => {
        ;(row.category_tags ?? []).forEach(t => {
          tCounts[t] = (tCounts[t] ?? 0) + 1
        })
      })
      setTagCounts(Object.entries(tCounts).map(([label, count]) => ({ label, count })))
```

**2d**：在 JSX 核心需求区块之后追加标签统计区块：

```jsx
      {/* 标签统计 */}
      {tagCounts.length > 0 && (
        <div style={{ background: 'white', borderRadius: 12, padding: '14px',
          marginBottom: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: 12, color: '#555', fontWeight: 500, marginBottom: 12 }}>
            标签统计
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[...tagCounts].sort((a, b) => b.count - a.count).slice(0, 10).map(({ label, count }) => (
              <span key={label} style={{
                fontSize: 11, background: '#f0ece4', color: '#8a7a6a',
                padding: '3px 10px', borderRadius: 10,
              }}>
                #{label} {count}次
              </span>
            ))}
          </div>
        </div>
      )}
```

- [ ] **Step 3：build 检查**

```bash
npm run build
```

- [ ] **Step 4：commit**

```bash
git add src/pages/InsightsPage.jsx
git commit -m "feat: InsightsPage 洞察页（心情曲线+情绪频率+核心需求+标签统计）"
```

---

## Task 14：SettingsPage.jsx 新增回顾信设置区块

**Files:**
- Modify: `src/pages/SettingsPage.jsx`

- [ ] **Step 1：读取现有 SettingsPage.jsx 末尾**

```bash
tail -60 src/pages/SettingsPage.jsx
```

找到最后一个设置区块结束的位置，在那里追加回顾信设置。

- [ ] **Step 2：在 SettingsPage.jsx 的 import 区追加依赖**

在文件顶部 import 区追加（找到 import 最后一行，在它后面加）：

```js
import { generateLetterNow, saveUserLetterPrefs } from '../lib/reviewLetterService'
import { updateMemory } from '../lib/memory'
```

- [ ] **Step 3：在 SettingsPage 组件内追加回顾信偏好 state**

在组件内现有 `useState` 声明之后追加：

```js
  const [letterPrefs, setLetterPrefs] = useState({
    type: 'count', count_threshold: 10, day_interval: 7, require_new_entries: true,
  })
  const [generatingLetter, setGeneratingLetter] = useState(false)
  const [letterMsg, setLetterMsg] = useState('')
```

- [ ] **Step 4：在 SettingsPage 的 JSX 最后一个设置区块后追加回顾信区块**

找到 `return` 语句里最后一个 `</section>` 或设置分组的结束，在它后面追加：

```jsx
        {/* ─── 回顾信设置 ─── */}
        <div style={{ marginTop: 28, paddingTop: 20,
          borderTop: '1px solid #ede9e2' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#333',
            marginBottom: 14 }}>
            回顾信设置
          </div>

          {/* 触发方式 */}
          {[
            { value: 'days',   label: `每隔 ${letterPrefs.day_interval} 天自动生成` },
            { value: 'count',  label: `累积 ${letterPrefs.count_threshold} 条情感记录后生成` },
            { value: 'manual', label: '手动生成' },
          ].map(opt => (
            <label key={opt.value} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              fontSize: 14, color: '#333', marginBottom: 12, cursor: 'pointer',
            }}>
              <input
                type="radio"
                name="letterTrigger"
                value={opt.value}
                checked={letterPrefs.type === opt.value}
                onChange={() => {
                  const updated = { ...letterPrefs, type: opt.value }
                  setLetterPrefs(updated)
                  saveUserLetterPrefs(user.id, updated, updateMemory)
                }}
              />
              {opt.label}
            </label>
          ))}

          {/* 立即生成按钮 */}
          <button
            onClick={async () => {
              setGeneratingLetter(true)
              setLetterMsg('')
              try {
                await generateLetterNow(user.id)
                setLetterMsg('✓ 已生成，去记录页查看')
              } catch (e) {
                setLetterMsg('生成失败，请稍后重试')
              } finally {
                setGeneratingLetter(false)
              }
            }}
            disabled={generatingLetter}
            style={{
              marginTop: 4, fontSize: 13, color: '#888',
              border: '1px solid #e0dbd4', borderRadius: 8,
              padding: '8px 16px', background: 'none', cursor: 'pointer',
            }}
          >
            {generatingLetter ? '生成中…' : '立即生成一封回顾信'}
          </button>
          {letterMsg && (
            <div style={{ fontSize: 12, color: '#aaa', marginTop: 8 }}>
              {letterMsg}
            </div>
          )}
        </div>
```

- [ ] **Step 5：build 检查**

```bash
npm run build
```

预期：无报错。

- [ ] **Step 6：commit**

```bash
git add src/pages/SettingsPage.jsx
git commit -m "feat: SettingsPage 新增回顾信设置区块（触发方式+立即生成）"
```

---

## TaskEnd：清理删除文件（若 Task 8 未完成）

- [ ] **确认 TaggingPage.jsx 和 ReflectionPage.jsx 已删除**

```bash
ls src/pages/TaggingPage.jsx src/pages/ReflectionPage.jsx 2>&1
```

如果文件还在（Task 8 里没删），现在删除：

```bash
rm -f src/pages/TaggingPage.jsx src/pages/ReflectionPage.jsx src/lib/localDB.js
npm run build   # 确认无报错
git add -u
git commit -m "chore: 删除废弃文件 TaggingPage、ReflectionPage、localDB.js"
```

> **Phase 2 预留（本次不实现）：**
> - 回顾信详情页的「✦ 深入觉察」按钮（进入 AwarenessFlow，`context_type='letter'`）——DB 结构已预留 `conversations.letter_id` 外键，等 Phase 2 再接。
> - `journalService.js` 全量迁移到 `db.js`——本次新增代码已遵守规范，存量代码等专项重构。
