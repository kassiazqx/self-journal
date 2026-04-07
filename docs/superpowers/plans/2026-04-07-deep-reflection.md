# 深度复盘功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在情绪标注页新增「深度复盘」入口，进入可左右滑动的问题卡片页面，onBlur 自动保存，右下角 ✦ 按钮唤起 AI 对话。

**Architecture:** 新增 `reflectionQuestions.js`（问题库）和 `ReflectionPage.jsx`（卡片页面），在 `TaggingPage` 底部加第二个按钮，`MainLayout` 用 `reflectionEntry` 状态控制全屏覆盖路由。AI 对话复用现有 `AIConversation` 组件，初始消息扩展传入已填卡片内容。

**Tech Stack:** React + Vite + Tailwind CSS v3, Supabase fire-and-forget UPDATE, touch events for swipe

---

## 文件一览

| 操作 | 文件 | 说明 |
|---|---|---|
| 新建 | `src/lib/reflectionQuestions.js` | 问题库 + getCardsForEntry() |
| 新建 | `src/pages/ReflectionPage.jsx` | 深度复盘页（卡片 + 滑动 + AI 按钮）|
| 修改 | `src/pages/TaggingPage.jsx` | 底部改为双按钮布局 |
| 修改 | `src/components/MainLayout.jsx` | 新增 reflectionEntry 状态和导航 |
| 修改 | `src/lib/prompts.js` | getInitialUserMessage 接受 reflectionAnswers 参数 |

---

## Task 1：创建问题库 `reflectionQuestions.js`

**Files:**
- Create: `src/lib/reflectionQuestions.js`

- [ ] **Step 1: 创建文件**

```javascript
// src/lib/reflectionQuestions.js
// 深度复盘问题库：字段 → 问题数组的映射，以及动态卡片过滤逻辑

// 负面情绪词集合——命中任一则显示仅限负面情绪的卡片
export const NEGATIVE_EMOTIONS = new Set([
  '焦虑', '崩溃', '难受', '委屈', '绝望', '压抑',
  '愤怒', '恐惧', '失落', '孤独', '内疚', '无助',
])

// 卡片定义（顺序即展示顺序）
// field: 写入 Supabase 的字段名
// showWhen: 'always' | 'negative'
// questions: 问题数组，第 0 个为默认，其余为「换一个」的候选池
export const QUESTION_CARDS = [
  {
    id: 'current_thought',
    label: '当下念头',
    field: 'current_thought',
    showWhen: 'always',
    questions: [
      '当时你脑子里第一个念头是什么？',
      '当下你心里第一个念头是什么？',
      '那个时刻最先冒出来的词是什么？',
    ],
  },
  {
    id: 'body_sensations',
    label: '身体感受',
    field: 'body_sensations',
    showWhen: 'negative',
    questions: [
      '这个感觉在身体的哪个部位？胸口、肚子、喉咙还是别的地方？',
      '是什么质地？紧绷、沉重、发热，还是别的？',
      '现在坐着，身体哪里是紧的？',
    ],
  },
  {
    id: 'current_behavior',
    label: '当下行为',
    field: 'current_behavior',
    showWhen: 'always',
    questions: [
      '当时你的第一反应是什么？做了什么，或者选择了沉默？',
      '你当时怎么处理的？',
      '你说了什么，还是选择回避？',
    ],
  },
  {
    id: 'core_needs',
    label: '核心需求',
    field: 'core_needs',
    showWhen: 'always',
    questions: [
      '在这件事上，你真正需要的是什么？',
      '什么对你来说最重要？',
      '这件事触动了你的什么——被理解、安全感，还是别的？',
    ],
  },
  {
    id: 'cognitive_analysis',
    label: '认知梳理',
    field: 'cognitive_analysis',
    showWhen: 'always',
    questions: [
      '这个想法，是事实，还是你对这件事的解读？',
      '这个结论是怎么来的？',
      '如果是你最在意的朋友经历了这一切，你会对 ta 说什么？',
    ],
  },
  {
    id: 'reflection_acceptance',
    label: '接纳',
    field: 'reflection_insight',
    showWhen: 'negative',
    // 接纳卡片写入 reflection_insight，onBlur 时 append（见 ReflectionPage）
    questions: [
      '你能允许这种感受就在这里，不用做什么，只是让它在吗？',
      '你有没有在对抗它、想让它快点消失？',
      '如果这个感受会说话，它想告诉你什么？',
    ],
  },
  {
    id: 'reflection_insight_card',
    label: '复盘洞见',
    field: 'reflection_insight',
    showWhen: 'always',
    // 洞见卡片同样写入 reflection_insight，onBlur 时 append
    questions: [
      '写完这些，有什么是刚才才意识到的吗？',
      '有没有哪句话，说出来之后觉得"对，就是这个"？',
      '如果给今天的自己说一句话，会是什么？',
    ],
  },
]

/**
 * 根据 entry 的情绪，返回应显示的卡片列表。
 * 负面情绪时：7 张（含 body_sensations + 接纳）
 * 其他情绪时：5 张（跳过 showWhen === 'negative' 的卡片）
 */
export function getCardsForEntry(entry) {
  const emotions = Array.isArray(entry.emotions) ? entry.emotions : []
  const isNegative = emotions.some(e => NEGATIVE_EMOTIONS.has(e))
  return QUESTION_CARDS.filter(
    card => card.showWhen === 'always' || isNegative
  )
}
```

- [ ] **Step 2: 验证文件语法**

```bash
cd /Users/kassia1/Desktop/个人/noteapp/self-journal
node --input-type=module < src/lib/reflectionQuestions.js && echo "✅ 语法正常"
```

预期输出：`✅ 语法正常`（无报错）

- [ ] **Step 3: 提交**

```bash
git add src/lib/reflectionQuestions.js
git commit -m "feat: 新增深度复盘问题库 reflectionQuestions.js"
```

---

## Task 2：TaggingPage 底部改为双按钮布局

**Files:**
- Modify: `src/pages/TaggingPage.jsx`

当前底部「完成」按钮在顶栏右侧。改动：
1. 顶栏右侧删除「完成」按钮，只保留返回箭头 + 标题
2. 在滚动区域**下方**新增固定底部栏，左小「深度复盘」+ 右宽「完成」
3. `handleComplete` 传 `goToReflection: false`；新增 `handleReflection` 传 `goToReflection: true`
4. 编辑模式（`isEdit === true`）**不**显示「深度复盘」按钮

- [ ] **Step 1: 修改顶栏——移除顶栏右侧的「完成」按钮**

文件：`src/pages/TaggingPage.jsx`，找到顶栏部分（约第 128–140 行），替换为：

```jsx
{/* 顶栏 */}
<div className="flex items-center justify-between px-4 pt-5 pb-3">
  <button onClick={onBack} className="text-gray-400 active:scale-95 transition-transform">
    <ArrowLeft size={22} />
  </button>
  <h2 className="text-base font-semibold text-gray-800">情绪标注</h2>
  <div className="w-8" />
</div>
```

（右侧占位 `div` 保持标题居中，不再放按钮）

- [ ] **Step 2: 修改 `handleComplete`，新增 `handleReflection`**

在 `handleComplete` 函数中，把：
```javascript
onComplete?.({ stateScore })
```
改为：
```javascript
onComplete?.({ stateScore, goToReflection: false })
```

在 `handleComplete` 函数**之后**，紧接着新增：

```javascript
const handleReflection = async () => {
  // 同样做验证
  if (requireEmotion && selectedEmotions.length === 0) {
    setError('请至少选择一个情绪标签')
    setTimeout(() => setError(''), 2000)
    return
  }
  if (requireState && stateScore === null) {
    setError('请选择整体状态评分')
    setTimeout(() => setError(''), 2000)
    return
  }

  // 立即跳转，后台保存
  onComplete?.({ stateScore, goToReflection: true })

  supabase
    .from('journal_entries')
    .update({
      emotions:            selectedEmotions.length > 0 ? selectedEmotions : [],
      overall_state_score: stateScore,
      handling_rating:     handlingRating,
    })
    .eq('id', entry.id)
    .eq('user_id', entry.user_id)
    .then(({ error: e }) => { if (e) console.error('[tagging] 后台保存失败:', e) })
}
```

- [ ] **Step 3: 修改滚动区域——去掉 `pb-6` 改为 `pb-2`**

找到：
```jsx
<div className="flex-1 overflow-y-auto px-4 pb-6 flex flex-col gap-5">
```
改为：
```jsx
<div className="flex-1 overflow-y-auto px-4 pb-2 flex flex-col gap-5">
```

- [ ] **Step 4: 在滚动区域关闭后插入底部按钮栏**

找到文件末尾：
```jsx
      </div>
    </div>
  )
}
```
改为：
```jsx
      </div>

      {/* 底部操作栏 */}
      <div className="px-4 pb-6 pt-2 flex gap-3 flex-shrink-0">
        {!isEdit && (
          <button
            onClick={handleReflection}
            className="px-4 py-3 bg-white border border-gray-200 text-gray-400 text-sm rounded-2xl active:scale-95 transition-transform whitespace-nowrap"
          >
            深度复盘
          </button>
        )}
        <button
          onClick={handleComplete}
          className="flex-1 flex items-center justify-center gap-1.5 py-3 bg-amber-500 text-white text-sm font-medium rounded-2xl active:scale-95 transition-transform"
        >
          <Check size={16} />
          {isEdit ? '保存' : '完成'}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: 本地验证**

```bash
cd /Users/kassia1/Desktop/个人/noteapp/self-journal
npm run dev
```

打开浏览器，写一篇日记 → 点「下一步」进入情绪标注页，确认：
- 顶栏右侧没有「完成」按钮
- 底部有「深度复盘」（左小）和「完成」（右宽）两个按钮
- 编辑模式下只有「保存」按钮

- [ ] **Step 6: 提交**

```bash
git add src/pages/TaggingPage.jsx
git commit -m "feat: 情绪标注页底部改为深度复盘+完成双按钮布局"
```

---

## Task 3：MainLayout 新增 reflectionEntry 路由

**Files:**
- Modify: `src/components/MainLayout.jsx`

在 `MainLayout` 里加一个新的全屏覆盖状态 `reflectionEntry`，并在 `handleTaggingComplete` 里根据 `goToReflection` 决定跳转目标。

- [ ] **Step 1: 在文件顶部新增 ReflectionPage 的 import**

找到：
```javascript
import AIConversation from './AIConversation'
```
改为：
```javascript
import AIConversation from './AIConversation'
import ReflectionPage from '../pages/ReflectionPage'
```

- [ ] **Step 2: 在现有状态声明区新增 reflectionEntry 状态**

找到：
```javascript
  const [suggestEntry, setSuggestEntry] = useState(null)   // 显示"聊聊吗？"横幅
```
在其后插入：
```javascript
  const [reflectionEntry, setReflectionEntry] = useState(null) // 进入深度复盘页
```

- [ ] **Step 3: 修改 handleTaggingComplete，处理 goToReflection**

找到：
```javascript
  const handleTaggingComplete = ({ stateScore } = {}) => {
    const shouldSuggest = taggingEntry?._shouldSuggestChat || (stateScore !== null && stateScore !== undefined && stateScore < 0)
    setTaggingEntry(null)
    if (shouldSuggest) {
      setSuggestEntry(taggingEntry)
    } else {
      handleSetActiveTab('records')
      setRecordsRefreshKey(k => k + 1)
    }
  }
```
改为：
```javascript
  const handleTaggingComplete = ({ stateScore, goToReflection } = {}) => {
    if (goToReflection) {
      // 保留 taggingEntry 的 emotions 等最新状态（后台保存已在 TaggingPage 触发）
      const entryForReflection = { ...taggingEntry }
      setTaggingEntry(null)
      setReflectionEntry(entryForReflection)
      return
    }

    const shouldSuggest = taggingEntry?._shouldSuggestChat || (stateScore !== null && stateScore !== undefined && stateScore < 0)
    setTaggingEntry(null)
    if (shouldSuggest) {
      setSuggestEntry(taggingEntry)
    } else {
      handleSetActiveTab('records')
      setRecordsRefreshKey(k => k + 1)
    }
  }
```

- [ ] **Step 4: 新增 handleReflectionClose 函数**

在 `handleAISaved` 函数之后，新增：

```javascript
  // ── 深度复盘页关闭 ───────────────────────────────────────────
  const handleReflectionClose = () => {
    setReflectionEntry(null)
    handleSetActiveTab('records')
    setRecordsRefreshKey(k => k + 1)
  }
```

- [ ] **Step 5: 在 aiEntry 全屏覆盖之前新增 reflectionEntry 全屏覆盖**

找到：
```javascript
  // ── 全屏覆盖：AI 对话 ────────────────────────────────────────
  if (aiEntry) {
```
在其**前面**插入：
```javascript
  // ── 全屏覆盖：深度复盘 ───────────────────────────────────────
  if (reflectionEntry) {
    return (
      <div className="flex flex-col max-w-lg mx-auto w-full" style={{ height: '100dvh' }}>
        <ReflectionPage
          entry={reflectionEntry}
          onClose={handleReflectionClose}
          onStartAI={handleStartAI}
        />
      </div>
    )
  }

```

- [ ] **Step 6: 本地验证（此时 ReflectionPage 还不存在，会报错，属正常）**

```bash
cd /Users/kassia1/Desktop/个人/noteapp/self-journal
npm run build 2>&1 | head -20
```

预期：报错 `Cannot find module '../pages/ReflectionPage'`，这是正常的，Task 4 会创建该文件。

- [ ] **Step 7: 提交**

```bash
git add src/components/MainLayout.jsx
git commit -m "feat: MainLayout 新增 reflectionEntry 状态和深度复盘路由"
```

---

## Task 4：创建 ReflectionPage.jsx

**Files:**
- Create: `src/pages/ReflectionPage.jsx`

这是核心新页面。包含：顶栏（进度 + 标题 + 关闭）、左右滑动卡片区、每张卡片的问题/输入框/换题按钮、右下角 ✦ AI 按钮、底部进度点。

- [ ] **Step 1: 创建文件**

```jsx
// src/pages/ReflectionPage.jsx
import { useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { getCardsForEntry } from '../lib/reflectionQuestions'

/**
 * Props:
 *   entry      — 已保存的日记条目（含 id, user_id, emotions, content 等）
 *   onClose    — 关闭页面回调（返回记录列表）
 *   onStartAI  — 唤起 AI 对话回调，传入带 _reflectionAnswers 的 entry
 */
export default function ReflectionPage({ entry, onClose, onStartAI }) {
  const cards = getCardsForEntry(entry)
  const total = cards.length

  // 当前卡片索引
  const [currentIndex, setCurrentIndex] = useState(0)

  // 每张卡片当前使用的问题索引（默认 0）
  const [questionIndexes, setQuestionIndexes] = useState(
    () => Object.fromEntries(cards.map(c => [c.id, 0]))
  )

  // 每张卡片的输入内容
  const [answers, setAnswers] = useState(
    () => Object.fromEntries(cards.map(c => [c.id, '']))
  )

  // 触摸滑动检测
  const touchStartX = useRef(null)

  const card = cards[currentIndex]

  // ── 换一个问题（同字段随机换，不重复当前）────────────────────
  const handleRefreshQuestion = () => {
    const pool = card.questions
    if (pool.length <= 1) return
    const currentQ = questionIndexes[card.id]
    let next = currentQ
    while (next === currentQ) {
      next = Math.floor(Math.random() * pool.length)
    }
    setQuestionIndexes(prev => ({ ...prev, [card.id]: next }))
  }

  // ── 输入框 onBlur：fire-and-forget 保存到对应字段 ────────────
  const handleBlur = (cardId, field, value) => {
    if (!value.trim()) return

    // reflection_insight 字段：接纳和洞见都 append，换行分隔
    // 两张卡片都写同一字段，先读再 append 会有竞态，简化处理：直接覆盖当前卡片的值
    // 由于用户在同一页面操作，两张卡片不会同时 blur，实际不会冲突
    supabase
      .from('journal_entries')
      .update({ [field]: value })
      .eq('id', entry.id)
      .eq('user_id', entry.user_id)
      .then(({ error: e }) => {
        if (e) console.error('[reflection] 保存失败:', e, field)
      })
  }

  // ── 关闭：保存当前输入框内容（若有焦点中的内容）→ 回列表 ───
  // 注：输入框 onBlur 在失焦时已触发，关闭时不需要额外保存
  const handleClose = () => {
    onClose()
  }

  // ── 切换卡片 ─────────────────────────────────────────────────
  const goTo = (index) => {
    if (index >= 0 && index < total) setCurrentIndex(index)
  }

  // ── 触摸滑动 ─────────────────────────────────────────────────
  const handleTouchStart = (e) => {
    touchStartX.current = e.touches[0].clientX
  }
  const handleTouchEnd = (e) => {
    if (touchStartX.current === null) return
    const diff = touchStartX.current - e.changedTouches[0].clientX
    if (Math.abs(diff) < 50) return // 小于 50px 不算滑动
    if (diff > 0) goTo(currentIndex + 1) // 左滑 → 下一张
    else goTo(currentIndex - 1)           // 右滑 → 上一张
    touchStartX.current = null
  }

  // ── 唤起 AI（把已填答案拼入 entry）─────────────────────────
  const handleStartAI = () => {
    const filledAnswers = cards
      .filter(c => answers[c.id]?.trim())
      .map(c => `${c.label}：${answers[c.id].trim()}`)
      .join('\n')

    onStartAI({
      ...entry,
      _reflectionAnswers: filledAnswers || null,
    })
  }

  const currentQuestion = card.questions[questionIndexes[card.id]]

  return (
    <div
      className="flex flex-col h-full bg-[#fdfaf7]"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* 顶栏 */}
      <div className="flex items-center justify-between px-4 pt-5 pb-3 flex-shrink-0">
        <button
          onClick={() => goTo(currentIndex - 1)}
          className={`text-sm text-gray-400 w-12 text-left active:scale-95 transition-transform ${
            currentIndex === 0 ? 'invisible' : ''
          }`}
        >
          ‹ {currentIndex}/{total}
        </button>
        <h2 className="text-base font-semibold text-gray-800">深度复盘</h2>
        <button
          onClick={handleClose}
          className="text-sm text-gray-400 w-12 text-right active:scale-95 transition-transform"
        >
          关闭
        </button>
      </div>

      {/* 卡片区（flex-1，滚动内部） */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          {/* 字段标签 */}
          <p className="text-xs text-gray-400 mb-3">{card.label}</p>

          {/* 问题文字 */}
          <p className="text-base font-medium text-gray-700 leading-relaxed mb-4">
            {currentQuestion}
          </p>

          {/* 输入框 */}
          <textarea
            value={answers[card.id]}
            onChange={e =>
              setAnswers(prev => ({ ...prev, [card.id]: e.target.value }))
            }
            onBlur={e => handleBlur(card.id, card.field, e.target.value)}
            placeholder="写下来…"
            className="w-full min-h-[120px] bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 text-sm text-gray-700 placeholder-gray-300 focus:outline-none focus:border-amber-300 resize-none leading-relaxed"
          />

          {/* 换一个问题 */}
          {card.questions.length > 1 && (
            <button
              onClick={handleRefreshQuestion}
              className="mt-3 flex items-center gap-1.5 text-xs text-gray-400 active:scale-95 transition-transform"
            >
              <span>↻</span>
              <span>换一个问题</span>
            </button>
          )}
        </div>
      </div>

      {/* 底部：AI 按钮 + 进度点 */}
      <div className="px-4 pb-6 flex-shrink-0">
        {/* ✦ AI 按钮（右对齐） */}
        <div className="flex justify-end mb-3">
          <button
            onClick={handleStartAI}
            className="w-10 h-10 bg-white border border-amber-200 rounded-full flex items-center justify-center text-amber-400 shadow-sm active:scale-95 transition-transform"
            style={{ fontSize: '16px' }}
          >
            ✦
          </button>
        </div>

        {/* 进度点 */}
        <div className="flex justify-center gap-1.5">
          {cards.map((c, i) => (
            <button
              key={c.id}
              onClick={() => goTo(i)}
              className={`transition-all rounded-full ${
                i === currentIndex
                  ? 'w-4 h-1.5 bg-amber-500'
                  : 'w-1.5 h-1.5 bg-gray-200'
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 本地验证（需先完成 Task 3 的 MainLayout 修改）**

```bash
cd /Users/kassia1/Desktop/个人/noteapp/self-journal
npm run build 2>&1 | tail -5
```

预期：`✓ built in ...`，零报错。

然后 `npm run dev`，走完整流程：
1. 写日记 → 下一步 → 情绪标注页
2. 选情绪 → 点「深度复盘」
3. 确认进入 ReflectionPage，能看到卡片、问题、输入框
4. 输入内容，失焦后去 Supabase 控制台确认对应字段有值
5. 点「↻ 换一个问题」确认问题变化
6. 左右滑动确认卡片切换
7. 负面情绪时确认 7 张卡片，其他情绪时 5 张
8. 点「✦」确认跳转 AI 对话
9. 点「关闭」确认回到记录列表

- [ ] **Step 3: 提交**

```bash
git add src/pages/ReflectionPage.jsx
git commit -m "feat: 新增深度复盘页面 ReflectionPage（卡片滑动+自动保存+AI入口）"
```

---

## Task 5：prompts.js 扩展 + 最终验证

**Files:**
- Modify: `src/lib/prompts.js`

`getInitialUserMessage` 接受第二个可选参数 `reflectionAnswers`（字符串），若非空则追加到初始消息末尾，让 AI 能看到用户已填写的卡片内容。

- [ ] **Step 1: 修改 getInitialUserMessage 函数签名和末尾**

找到：
```javascript
export function getInitialUserMessage(entry) {
  let msg = `我刚写了一段日记：\n\n「${entry.content}」`
```
改为：
```javascript
export function getInitialUserMessage(entry, reflectionAnswers) {
  let msg = `我刚写了一段日记：\n\n「${entry.content}」`
```

找到函数末尾：
```javascript
  return msg
}
```
改为：
```javascript
  // 深度复盘时，把已填卡片答案附上
  if (reflectionAnswers) {
    msg += `\n\n【我在深度复盘时写下的】\n${reflectionAnswers}\n（这些是我刚才自己整理的想法，你可以以此为起点）`
  }

  return msg
}
```

- [ ] **Step 2: 修改 AIConversation 的 startChat 调用，传入 reflectionAnswers**

文件：`src/components/AIConversation.jsx`

找到 `startChat` 函数内部调用 `getInitialUserMessage` 的地方，通常是：
```javascript
const userMsg = getInitialUserMessage(entry)
```
改为：
```javascript
const userMsg = getInitialUserMessage(entry, entry._reflectionAnswers)
```

（`_reflectionAnswers` 是 `ReflectionPage` 通过 `onStartAI` 挂在 entry 上的临时字段，不存 DB）

- [ ] **Step 3: 本地完整验证**

```bash
cd /Users/kassia1/Desktop/个人/noteapp/self-journal
npm run build 2>&1 | tail -5
```

预期：`✓ built in ...`，零报错。

然后 `npm run dev`，验证 AI 入口路径：
1. 进入 ReflectionPage，在「当下念头」卡片输入「有点后悔答应这件事」，失焦
2. 点右下角「✦」按钮
3. 进入 AI 对话，查看第一条用户消息是否包含：
   ```
   【我在深度复盘时写下的】
   当下念头：有点后悔答应这件事
   ```
4. 确认 AI 的第一条回复没有再问"你的情绪是什么"（因为已在已知信息中）

- [ ] **Step 4: 提交**

```bash
git add src/lib/prompts.js src/components/AIConversation.jsx
git commit -m "feat: AI 初始消息支持传入深度复盘已填内容"
```

- [ ] **Step 5: 最终 build 验证 + push**

```bash
cd /Users/kassia1/Desktop/个人/noteapp/self-journal
npm run build
```

预期：零报错，零警告（或仅有无关警告）。

```bash
git push
```

部署到 Vercel 后，在手机浏览器走完整流程确认功能正常。

---

## 验收核对（对照设计文档成功标准）

| # | 验收项 | 对应 Task |
|---|---|---|
| 1 | 情绪标注页底部出现双按钮，左小右大 | Task 2 |
| 2 | 点「完成」行为与现在一致 | Task 2 |
| 3 | 点「深度复盘」进入 ReflectionPage，能左右滑动 | Task 3、4 |
| 4 | 负面情绪 7 张卡片，其他情绪 5 张 | Task 1、4 |
| 5 | 接纳卡片和洞见卡片分开展示 | Task 1、4 |
| 6 | 「↻ 换一个问题」随机换同字段不同问题 | Task 4 |
| 7 | 输入内容 onBlur 后正确写入 Supabase 对应字段 | Task 4 |
| 8 | 点「关闭」直接回列表，数据不丢失 | Task 3、4 |
| 9 | ✦ 按钮唤起 AI，AI 能看到日记+情绪标签+已填卡片内容 | Task 4、5 |
| 10 | `npm run build` 零报错 | Task 5 |
