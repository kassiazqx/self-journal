# 觉察卡片扩展 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将觉察卡片从 6 组扩展为 9 组，问题数从 3 个增至 4-7 个，新增行为/接纳/认知组，重命名 context → focus。

**Architecture:** 只改两个文件：`awarenessFlowState.js` 替换 `AWARENESS_QUESTIONS` 数组；`awarenessFlowState.test.js` 把两处 `'context'` 改为 `'focus'`。运行时逻辑（`getFilteredLocalNodes`、tier 过滤、`showWhen` 守门）无需修改，已兼容新结构。

**Tech Stack:** 纯数据改动，无新依赖

---

## 文件改动地图

| 文件 | 动作 | 说明 |
|---|---|---|
| `src/lib/awarenessFlowState.js` | **修改** | 替换 L4-65 的 `AWARENESS_QUESTIONS` 数组 |
| `src/lib/awarenessFlowState.test.js` | **修改** | L99、L128 的 `'context'` 改为 `'focus'` |

---

## Task 1：替换 AWARENESS_QUESTIONS 数组

**Files:**
- Modify: `src/lib/awarenessFlowState.js`

- [ ] **Step 1：替换 L4-65 的数组**

找到：

```js
export const AWARENESS_QUESTIONS = [
  {
    id: 'context',
    tier: 1,
    texts: [
      '能多说一点当时的情况吗？',
      '当时是在哪里、和谁在一起？',
      '这件事是怎么开始的？',
    ],
    showWhen: 'always',
  },
```

（以 `export const AWARENESS_QUESTIONS = [` 开头，到第 65 行 `]` 结尾的整段）

替换为：

```js
export const AWARENESS_QUESTIONS = [
  {
    id: 'focus',
    tier: 1,
    texts: [
      '这件事里，哪个时刻让你印象最深？',
      '整件事里，最触动你的一刻是什么？',
      '有没有哪个细节，现在想起来还很清晰？',
      '当时最让你在意的是哪一部分？',
      '是什么让你想把这件事写下来？',
      '你觉得这件事最重要的部分是什么？',
    ],
    showWhen: 'always',
  },
  {
    id: 'emotion',
    tier: 2,
    texts: [
      '心里什么滋味？这种感受你能准确描述吗？',
      '你注意到自己有哪些情绪？清晰还是混沌的？',
      '这种感受，你熟悉吗？',
      '除了这个，还藏有别的什么感受吗？',
      '有没有哪部分感受，连你自己也有点意外？',
    ],
    showWhen: 'always',
  },
  {
    id: 'body',
    tier: 3,
    texts: [
      '深呼吸，身体有什么明显感受？紧绷、沉重、发热、发凉，还是别的？',
      '胸口、肚子、喉咙，哪里有什么感觉？',
      '现在坐着，身体哪里是紧的？',
      '你注意到自己身体有什么变化吗？',
      '这种感觉有没有让你想做什么，或者不做什么？',
    ],
    showWhen: 'negative',
  },
  {
    id: 'acceptance',
    tier: 3,
    texts: [
      '你能允许这种感受就这样存在吗？有没有在试图让它快点消失？',
      '试着让这个感觉就在这里，不用做什么，只是让它在——可以吗？',
      '你有没有在评判自己"不应该有这种感受"？',
      '如果这个感受会说话，它想告诉你什么？',
      '你可以暂时不解决它，只是陪着它吗？',
      '如果不对抗这种感受，你觉得它会停多久？',
    ],
    showWhen: 'negative',
  },
  {
    id: 'thought',
    tier: 3,
    texts: [
      '当时脑子里第一个念头是什么？',
      '有没有什么话，脑子里说了但没说出口？',
      '那个念头，是全新的，还是之前也想过很多次了？',
      '当时最在意的是什么？',
      '这个想法，你相信它吗？',
    ],
    showWhen: 'always',
  },
  {
    id: 'behavior',
    tier: 4,
    texts: [
      '你的第一反应是什么？想做什么？',
      '你说了什么，或者选择了沉默？',
      '你当时怎么处理的？和你过往的模式有什么不一样吗？',
      '当时做了什么行动？是你满意的吗？',
    ],
    showWhen: 'always',
  },
  {
    id: 'need',
    tier: 4,
    texts: [
      '在这件事上，你最想要的是什么？',
      '这种感觉里，最重要的是什么？',
      '如果这件事能有一个最好的结果，那是什么样子？',
      '什么被触动了——是被理解、被接纳，还是安全感，或者别的？',
      '我的哪个价值观在这里被挑战了？',
      '这个反应，是你期待自己有的那种状态吗？',
    ],
    showWhen: 'always',
  },
  {
    id: 'cognitive',
    tier: 5,
    texts: [
      '你的感受是基于事实，还是你的解读？',
      '你认为这个感受的本质是什么？这个结论是怎么来的？',
      '为什么这个事实会让你有这种感受？',
      '这个想法，你完全相信它，还是有一部分在怀疑？',
      '这个想法有没有哪里是在对你特别严苛的？',
      '如果是你最在意的朋友经历了这一切，你会对ta说什么？',
      '10年后的你，回头看今天这件事，会怎么看它？',
    ],
    showWhen: 'always',
  },
  {
    id: 'insight',
    tier: 5,
    texts: [
      '聊到现在，有什么是刚才才意识到的吗？',
      '现在的感觉，和刚开始写的时候有什么不一样？',
      '这件事和你以前经历过的什么有点像？',
      '如果给今天的自己说一句话，会是什么？',
      '有没有什么，你觉得自己处理得还不错的？',
      '下次遇到类似的情况，你认为自己会有什么不同吗？',
      '如果这件事是来告诉你什么的，它想说什么？',
    ],
    showWhen: 'always',
  },
]
```

- [ ] **Step 2：验证编译**

```bash
npm run build 2>&1 | tail -5
```

期望：无 error。

- [ ] **Step 3：Commit**

```bash
git add src/lib/awarenessFlowState.js
git commit -m "feat: 觉察卡片扩展为 9 组，context 重命名为 focus，新增 acceptance/behavior/cognitive"
```

---

## Task 2：修复测试文件中的硬编码 id

**Files:**
- Modify: `src/lib/awarenessFlowState.test.js`

> ⚠️ 这一步是报告遗漏的必修项。测试文件 L99、L128 硬编码了 `'context'`，`context` 改为 `focus` 后测试会报错，必须同步更新。

- [ ] **Step 1：修改 L99**

找到：

```js
  assert.notEqual(paused.currentNode.promptId, 'context')
```

改为：

```js
  assert.notEqual(paused.currentNode.promptId, 'focus')
```

- [ ] **Step 2：修改 L128**

找到：

```js
  assert.equal(paused.currentNode.promptId, 'context')
```

改为：

```js
  assert.equal(paused.currentNode.promptId, 'focus')
```

- [ ] **Step 3：跑测试**

```bash
node --test src/lib/awarenessFlowState.test.js 2>&1
```

期望：所有测试 pass，无 fail。

- [ ] **Step 4：Commit**

```bash
git add src/lib/awarenessFlowState.test.js
git commit -m "fix: 测试文件 promptId 断言 context → focus"
```

---

## 自检结果

**覆盖检查：**

| 要求 | Task |
|---|---|
| 6 组 → 9 组（新增 acceptance/behavior/cognitive） | Task 1 ✅ |
| context 重命名为 focus | Task 1 ✅ |
| acceptance 前置（body 后、thought 前） | Task 1（数组顺序）✅ |
| body/acceptance 仅负面情绪显示（showWhen: 'negative'）| Task 1 ✅ |
| tier 4/5 新组不被 startTier 过滤（filter 逻辑已兼容）| 无需改代码 ✅ |
| 测试文件硬编码 'context' 同步更新 | Task 2 ✅ |
| templates.js 的 awarenessStart: 'emotion' 不受影响 | 引用的是 tier 名非 question id ✅ |

**占位符扫描：** 无。

**类型一致性：** `showWhen` 值与 `getFilteredLocalNodes` 里的 `=== 'negative'` 判断一致；`tier` 数值与现有 filter 逻辑 `question.tier < startTier` 兼容。
