# 同步卡：脉络详情页 AI 分析（碎片 + 此刻这里）

> **状态：✅ 已实现（commit 3879c6a，2026-04-21，待用户验收）**
> Spec：`docs/superpowers/specs/2026-04-21-thread-detail-analysis-design.md`
> Plan：`docs/superpowers/plans/2026-04-21-thread-detail-analysis.md`

---

## 一、改动清单

| # | 内容 | 文件 | 性质 |
|---|---|---|---|
| 0 | `threads` 表加 `fragments jsonb` + `current_state text` + `analysis_generated_at timestamptz` | Supabase SQL | DB 迁移（已执行） |
| 1 | 新增 `buildThreadAnalysisPrompt(threadName, entries)` | `src/lib/prompts.js` | 新增函数 |
| 2 | 新增 `generateThreadAnalysis(threadId, userId)` + import `buildThreadAnalysisPrompt` | `src/lib/threadService.js` | 新增函数 |
| 3 | 替换 arc_summary 区块；加底部「开始分析」/「再次分析」按钮；顺序改为 此刻这里→碎片→走过的路 | `src/pages/ThreadDetailPage.jsx` | UI 重构 |
| 4 | `fetchThreadWithEntries` 新增 `content` + `removed_by_user` 字段；条目列表用 `content.slice(0,80)` 兜底 | `src/lib/threadService.js` | 查询扩展 |
| 5 | `buildThreadAnalysisPrompt` 语言风格规则（平实/分组格式）；`current_state` 显示区加 `whiteSpace: pre-wrap` | `src/lib/prompts.js` + `ThreadDetailPage.jsx` | Prompt 调优 |

---

## 二、架构要点

### §A 两个「分析」操作区分

| 按钮 | 位置 | 调用 | 作用 |
|---|---|---|---|
| 开始分析 / 再次分析 | 底部固定按钮 | `generateThreadAnalysis` | 读已关联条目全文，生成碎片+此刻 |
| 🔄 重新分析 | ··· 菜单 | `reAnalyzeThread` | 扫全部日记，找未关联的新条目推入候选 |

两者名称不同、入口不同、功能不同，不可混淆。

### §B 全文 content 的使用

`generateThreadAnalysis` 自己查 DB，选 `journal_entries.content`（完整原文），过滤 `removed_by_user=true`。`fetchThreadWithEntries`（页面展示用）现在也加了 `content` 字段，用于条目列表 `entry_summary` 为空时显示原文前 80 字。

### §C arc_summary 去留

`arc_summary` 字段保留在 DB 和 `refreshArcSummary` 函数中，只从 `ThreadDetailPage` 的 import 和 JSX 中移除引用。不影响历史数据。

### §D 格式显示

`current_state` 是带 `\n\n` 分组的纯文本，显示层必须加 `whiteSpace: 'pre-wrap'` 才能保留换行。

---

## 三、不涉及范围

- `arc_summary` 字段及 `refreshArcSummary` 函数保留，不删除
- 已归档脉络：分析按钮不显示，已有分析内容正常展示（只读）
- 条目摘要自动补全：当前不触发，`entry_summary` 为空时用原文前 80 字兜底
