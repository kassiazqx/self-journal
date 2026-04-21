# 同步卡：回顾信 Prompt 重设计（时间问候 + AI 自选格式 A/B）

> **状态：✅ 已实现（commit 988c2e6，2026-04-21）**
> Spec：`docs/superpowers/specs/2026-04-21-review-letter-prompt-redesign.md`
> Plan：`docs/superpowers/plans/2026-04-21-review-letter-prompt-redesign.md`

---

## 一、改动清单

| # | 内容 | 文件 | 性质 |
|---|---|---|---|
| 1 | 新增 `getTimeGreeting()`，按小时返回时段问候词（早/中/下午/晚/深夜随机选） | `src/lib/reviewLetterService.js` | 新增函数 |
| 2 | `generateReviewLetter` 注入 `timeGreeting`，调用改为 `getReviewLetterPrompt({ entriesSummary, timeGreeting })` | `src/lib/reviewLetterService.js` | 调用改造 |
| 3 | 重写 `getReviewLetterPrompt`：新入参结构、格式 A/B 选择规则、`THREAD_OUTPUT_INSTRUCTION` 提为常量 | `src/lib/prompts.js` | Prompt 重写 |

---

## 二、架构要点

### §A 格式选择由 AI 完成

AI 在同一次调用里完成「读条目 → 选格式 → 写信 → 输出 suggested_threads」，调用次数不变，无额外成本。

**格式 A（一根线）：** 同一个词在 >50% 条目中出现，或出现 ≥5 次 → 逐条引用那个词，无分析段。

**格式 B（关键时刻）：** 否则 → 选 2–6 个最有力的时刻逐条引用，无连接词和结论。

### §B 时间问候词

由 `getTimeGreeting()` 在生成信时调用，注入 prompt 作为第一行开头。AI 负责后半句观察。词库：
- 05–11: 早上好 / 早啊 / 早（随机）
- 11–14: 中午好 / 午安（随机）
- 14–18: 下午好
- 18–23: 晚上好 / 晚啊（随机）
- 23–05: 还没睡呢 / 深夜了（随机）

### §C THREAD_OUTPUT_INSTRUCTION 常量化

原来 suggested_threads JSON 格式说明内嵌在 prompt 字符串里。现提为模块级常量，方便未来其他 prompt 复用，也方便单独修改格式说明而不动主 prompt。

### §D 入参不含原始 content

只传 `entry_summary + theme_hints + core_needs`，不传完整原文。格式 A 靠结构化字段判断贯穿词，格式 B 靠摘要选时刻——够用，且省 token。

---

## 三、不涉及范围

- suggested_threads 解析逻辑不变（reviewLetterService.js 下游代码不动）
- 格式 C（行为模式）暂缓：需要原始 content，当前只传摘要，条件不成熟
- DB schema 无变更
