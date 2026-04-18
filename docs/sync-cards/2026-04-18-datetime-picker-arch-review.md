# 同步卡：写作页日期时间选择 · 架构审查请求

> **架构 session：请审查以下设计决策是否符合 §2 架构约束，并在 arch-context.md 相应位置追加结论。**
>
> - 完整 spec：`docs/superpowers/specs/2026-04-18-datetime-picker-design.md`
> - 设计看板：`docs/superpowers/design-boards/2026-04-18-datetime-picker.html`

---

## 一、本次新增内容概览

| 新增 | 类型 | 说明 |
|---|---|---|
| `inferDatetime(text, now)` | 新建纯函数 | 从文本关键词推算绝对时间，取最近不超过当前时刻 |
| `DatetimePicker.jsx` | 新建共享组件 | 快捷按钮 + 迷你日历 + 时间输入框，底部 sheet |
| `HomePage.jsx` | 修改 | 模板栏右侧加日期 pill，mount 时 selectedDatetime 初始化，debounce 调 inferDatetime |
| `RecordDetail.jsx` | 修改 | 左上角时间戳改为可点击，打开 DatetimePicker，确认后调 updateEntry |

**不新增数据库表、不新增 RPC 函数。**

---

## 二、请架构 session 重点检查的问题

### Q1：Supabase 是否允许客户端 UPDATE `created_at`？

**场景：** `updateEntry({ id, userId, fields: { created_at: '2026-04-17T21:00:00Z' } })` 由 `journalService.js` 调用，`updateEntry` 是 `.update(fields)` 直接透传，不过滤字段。

**已知：** `journal_entries.created_at` 列的 DDL 为 `timestamptz NOT NULL DEFAULT now()`，RLS 已启用（`user_id = auth.uid()`）。

**待架构确认：** Supabase 是否有内置限制阻止客户端 UPDATE `timestamptz DEFAULT now()` 列？还是只要 RLS 通过就能正常写入？

**预期答案：** 可以 UPDATE（无额外限制），但需确认。

### Q2：`inferDatetime` 放在哪里？

**候选位置：**

A. 新建 `src/lib/dateUtils.js`（单独的纯函数工具文件）  
B. 内联写在 `HomePage.jsx` 里（只在写作页用）

**当前 spec 未规定。** `inferDatetime` 是无副作用的纯函数（输入 text + now，输出 Date | null），如果未来 RecordDetail 或其他地方也需要识别文本时间，放 `dateUtils.js` 更合适。

**待架构判断：** 独立文件还是内联？

### Q3：`DatetimePicker` 是独立组件还是内联？

两处使用（HomePage pill 点击 / RecordDetail 时间戳点击）共用同一套 picker sheet UI。

**方案 A（推荐）：** 新建 `src/components/DatetimePicker.jsx`，接收 `initialDatetime`、`onConfirm`、`onClose` props，内部管理选择状态。

**方案 B：** 两处各自内联实现（代码重复但简单）。

**待架构判断：** A 还是 B？

### Q4：`manualOverride` flag 是否需要持久化？

**当前设计：** `manualOverride` 只存 React state，页面刷新或切换 tab 后重置。若用户手动改了时间后意外刷新页面，再次输入关键词时自动识别会重新触发。

**评估：** 草稿已持久化到 localStorage（`journal_draft`），可以考虑把 `manualOverride` 和 `selectedDatetime` 一起存入草稿。

**待架构判断：** `manualOverride` + `selectedDatetime` 是否应该随草稿持久化到 localStorage？

---

## 三、建议追加到 arch-context.md 的内容（草稿）

**§2 已确认决策新增：**

```
### 2.10 写作页日期时间选择
HomePage 新建模式：模板栏右侧 pill 显示 selectedDatetime（React state），
inferDatetime(text, now) 纯函数从关键词推算时间（debounce 800ms），
取最近不超过当前时刻的结果，手动修改后 manualOverride = true 不再自动覆盖。
RecordDetail：左上角时间戳可点击，确认后调 updateEntry 写回 created_at。
两处共用 DatetimePicker.jsx 组件。
```

**§4 架构风险新增（待架构 session 确认是否成立）：**

```
### 4.31 客户端 UPDATE created_at 兼容性
journal_entries.created_at 设有 DEFAULT now()，updateEntry 直接透传 fields。
需确认 Supabase 不阻止 UPDATE 该列（预期：RLS 通过即可写入）。
若遇到 Supabase 拒绝 UPDATE created_at，需改用 RPC 函数绕过限制。
```
