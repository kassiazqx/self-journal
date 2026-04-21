# 回顾信 Prompt 重设计实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将回顾信单一固定 prompt 替换为 AI 自主选择的两种格式（A 一根线 / B 关键时刻），同时加入时间感知问候。

**Architecture:** 两处文件改动。`reviewLetterService.js` 新增 `getTimeGreeting()` 并将其注入 prompt 变量；`prompts.js` 重写 `getReviewLetterPrompt()` 接受 `{ entriesSummary, timeGreeting }` 对象，新 prompt 包含格式选择规则 + 两种格式写作规范，`suggested_threads` 块提取为常量复用。AI 在一次调用中完成「选格式 + 写信 + 输出 JSON」。

**Tech Stack:** 纯 JS 字符串操作，无新依赖

**Spec:** `docs/superpowers/specs/2026-04-21-review-letter-prompt-redesign.md`

---

## 文件改动地图

| 文件 | 改动 |
|---|---|
| `src/lib/reviewLetterService.js` | 新增 `getTimeGreeting()`，在 `generateReviewLetter` 里构造并传入 `timeGreeting` |
| `src/lib/prompts.js` | 重写 `getReviewLetterPrompt(vars)`，新增顶部常量 `THREAD_OUTPUT_INSTRUCTION` |

---

## Task 1：reviewLetterService.js — 新增 getTimeGreeting + 传入 prompt

**Files:**
- Modify: `src/lib/reviewLetterService.js`

### 背景

当前第 96 行：`const prompt = getReviewLetterPrompt(entriesSummary)`
需要改为传 `{ entriesSummary, timeGreeting }`，同时提供 `getTimeGreeting()` 函数。

- [ ] **Step 1：在文件顶部（import 块之后，第 9 行前后）插入 `getTimeGreeting` 函数**

找到文件顶部 import 区结束后的空行，插入：

```js
// ── 时间问候词 ──────────────────────────────────────────────────
function getTimeGreeting() {
  const h = new Date().getHours()
  if (h >= 5  && h < 11) return ['早上好', '早啊', '早'][Math.floor(Math.random() * 3)]
  if (h >= 11 && h < 14) return ['中午好', '午安'][Math.floor(Math.random() * 2)]
  if (h >= 14 && h < 18) return '下午好'
  if (h >= 18 && h < 23) return ['晚上好', '晚啊'][Math.floor(Math.random() * 2)]
  return ['还没睡呢', '深夜了'][Math.floor(Math.random() * 2)]  // 23–05
}
```

- [ ] **Step 2：在 `generateReviewLetter` 里，在 prompt 构建之前加 timeGreeting，并更新调用**

找到第 94–96 行：
```js
  }))\n\n  const prompt = getReviewLetterPrompt(entriesSummary)
```

替换为：
```js
  }))

  const timeGreeting = getTimeGreeting()
  const prompt = getReviewLetterPrompt({ entriesSummary, timeGreeting })
```

- [ ] **Step 3：验证编译**

```bash
npm run build 2>&1 | tail -5
```

期望：无 error

- [ ] **Step 4：Commit**

```bash
git add src/lib/reviewLetterService.js
git commit -m "feat: 回顾信加入时间问候词注入 getTimeGreeting()"
```

---

## Task 2：prompts.js — 重写 getReviewLetterPrompt

**Files:**
- Modify: `src/lib/prompts.js:264-305`

### 背景

当前 `getReviewLetterPrompt(entriesSummary)` 返回单一固定 prompt。需要：
1. 提取 `suggested_threads` 输出块为常量 `THREAD_OUTPUT_INSTRUCTION`
2. 新入参改为 `vars = { entriesSummary, timeGreeting }`
3. 新条目格式：每条一行（非多行块）
4. Prompt 包含格式选择规则 + 格式 A 规范 + 格式 B 规范

- [ ] **Step 1：用以下内容替换 `prompts.js` 第 264–305 行（getReviewLetterPrompt 整个函数）**

```js
// ─── 回顾信生成 prompt ───────────────────────────────────────────
// vars: { entriesSummary: [{ date, entry_summary, theme_hints, core_needs }], timeGreeting: string }
// AI 在一次调用中完成「选格式 + 写信 + 输出 suggested_threads JSON」

const THREAD_OUTPUT_INSTRUCTION = `\
写完信之后，在信的最后附上以下JSON（不要解释，直接输出）：
\`\`\`json
{
  "suggested_threads": [
    {
      "action": "create",
      "thread_id": null,
      "thread_name": "建议新建的脉络名称",
      "discovery_reason": "2-3句话说明为什么注意到这条模式，引用用户原文中的词或场景，不泛泛而谈",
      "related_entry_indices": [0, 2]
    }
  ]
}
\`\`\`
字段说明：
- discovery_reason：2-3句，引用用户原文中出现的词汇和场景，不泛泛而谈
- related_entry_indices：上方日记摘要数组的序号（0-based，第0条 = 第1篇日记），可填多个
如果没有可建议新建的脉络，返回 "suggested_threads": []`

export function getReviewLetterPrompt({ entriesSummary, timeGreeting }) {
  // 每条条目拼为一行，theme_hints / core_needs 为空时省略对应片段
  const entriesText = entriesSummary.map((e, i) => {
    const parts = [`[${e.date.replace(/-/g, '/')}] 摘要：${e.entry_summary ?? '（无摘要）'}`]
    if (e.theme_hints?.length)  parts.push(`主题：${e.theme_hints.join('、')}`)
    if (e.core_needs?.length)   parts.push(`核心需求：${e.core_needs.join('、')}`)
    return parts.join(' | ')
  }).join('\n')

  const entryCount = entriesSummary.length
  const dates = entriesSummary.map(e => e.date).sort()
  const dateRange = `${dates[0].replace(/-/g, '/')}—${dates[dates.length - 1].replace(/-/g, '/')}`

  return `你会收到用户最近 ${entryCount} 条日记摘要（${dateRange}）。请先选择写信格式，再按该格式写信。

---

## 第一步：选择格式

读完所有条目后，按以下规则选格式：

**格式A（一根线）——满足任一条件即选格式A：**
- theme_hints、core_needs 或摘要文字中，同一个词出现在超过一半的条目中（严格 >50%，即出现次数 > ${entryCount} × 0.5）
- 同一个词出现在 5 条或更多条目中

**否则选格式B（关键时刻）。**

---

## 格式A：一根线

**第一行（必须是这个格式）：** ${timeGreeting}，[一句话观察，不超过20字，点出那条贯穿词/感受，像一个朋友说话，不是总结]

**正文：** 找出那个贯穿词或感受，从 2–6 条不同日期的条目各摘一句，每条前标日期，直接引用，不加解释。

格式（日期和内容之间无空行）：
${timeGreeting}，这阵子好像一直在等什么。

4月3日，你说……
4月7日，你写……
4月12日，你提到……

**禁止：** 分析、解释、「这说明你……」、结尾总结段、建议。

---

## 格式B：关键时刻

**第一行（必须是这个格式）：** ${timeGreeting}，[一句话观察，不超过20字，给出这段时间的整体感]

**正文：** 从条目里找 2–6 个最有力量、最真实的时刻，每条前标日期，紧接一两行引用，日期和引用之间无空行，不加评论。

格式：
${timeGreeting}，这段时间有些时刻特别清晰。

4月5日
你说……
4月11日
你写……

**禁止：** 分析、连接词「因为」「所以」、结尾总结、建议。

---

${THREAD_OUTPUT_INSTRUCTION}

以下是用户的日记摘要（${entryCount} 条，${dateRange}）：

${entriesText}`
}
```

- [ ] **Step 2：验证编译**

```bash
npm run build 2>&1 | tail -5
```

期望：无 error

- [ ] **Step 3：Commit**

```bash
git add src/lib/prompts.js
git commit -m "feat: 回顾信 prompt 重设计——AI 选格式A/B + 时间问候 + 新入参结构"
```

---

## Task 3：本地验收

```bash
npm run dev
```

**验收清单：**

1. 进入设置页，手动生成一封回顾信，信的开头包含时间问候词（早/中/晚对应时段）
2. 观察信的格式：若近期条目有明显贯穿词，应为格式A（逐条摘引）；否则为格式B（关键时刻列举）
3. 格式A的信里没有分析段或建议段，只有引用
4. 格式B的信里没有「因为/所以」连接词或总结段
5. 信的末尾依然有 `suggested_threads` JSON，详情页正常展示脉络卡片
6. 深夜（23:00后）手动触发，开头词为「还没睡呢」或「深夜了」
