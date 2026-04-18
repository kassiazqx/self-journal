# 同步卡：写作页日期时间选择 · 代码 Session

> **代码 session 冷启动必读。按顺序读完再动手。**

---

## 一、必读文档

| 文档 | 说明 |
|---|---|
| `docs/arch-context.md` §2 | 架构约束基线（改代码前必须对照） |
| `docs/coding-lessons.md` | 8 条编码规则（每次动手前对照） |
| `docs/superpowers/specs/2026-04-18-datetime-picker-design.md` | 完整功能 spec（含 §0 架构审查结论） |
| `docs/superpowers/plans/2026-04-18-datetime-picker.md` | 本次实现 plan（Task 0–4，按顺序执行） |

---

## 二、本次任务概览

**新建 2 个文件，修改 2 个文件，不改数据库、不加 RPC。**

| 操作 | 文件 | 核心内容 |
|---|---|---|
| 新建 | `src/lib/dateUtils.js` | `inferDatetime(text, now)` 纯函数 + `formatPill(date, now)` |
| 新建 | `src/components/DatetimePicker.jsx` | 快捷按钮 + 迷你日历 + 时间输入框，底部 sheet |
| 修改 | `src/pages/HomePage.jsx` | 模板栏右侧加日期 pill，debounce 识别，draft 持久化，保存时用 selectedDatetime |
| 修改 | `src/components/RecordDetail.jsx` | 左上角时间戳改为可点击，弹 picker 后写回 DB |

---

## 三、架构审查结论（已确认，直接执行）

| # | 问题 | 结论 |
|---|---|---|
| Q1 | Supabase 可以 UPDATE `created_at` 吗 | ✅ 可以。`DEFAULT now()` 只约束 INSERT，RLS 通过即可写入，无需 RPC |
| Q2 | `inferDatetime` 放哪里 | ✅ 独立文件 `src/lib/dateUtils.js`，纯函数零副作用 |
| Q3 | `DatetimePicker` 独立组件还是内联 | ✅ 独立组件 `src/components/DatetimePicker.jsx`（两处共用） |
| Q4 | `manualOverride` 是否随草稿存 localStorage | ✅ 需要，`selectedDatetime`（ISO）+ `manualOverride`（boolean）一起存入 `journal_draft` |

---

## 四、关键现有代码位置

**`src/pages/HomePage.jsx`：**
- 第 29–55 行：`saveDraft` / `loadDraft` / `clearDraft`（Task 2 Step 2 需要替换）
- 第 109 行附近：`saving` state（在此之后加三个新 state）
- 第 155–162 行：自动保存草稿 effect（Task 2 Step 5 需要替换）
- 第 170–177 行：`handleResumeDraft`（Task 2 Step 4 需要替换）
- 第 293 行：`created_at: new Date().toISOString()`（handleDone，Task 2 Step 9 替换）
- 第 316 行：`created_at: new Date().toISOString()`（handleDeepAwareness，Task 2 Step 10 替换）
- 第 387–414 行：模板标签栏（Task 2 Step 7 在此加 pill）

**`src/components/RecordDetail.jsx`：**
- 第 12 行：imports 末尾（Task 3 Step 1 加 import）
- 第 540 行：`<span style={{ fontSize: 12, color: '#bbb' }}>{formatDateTime(entry.created_at)}</span>`（Task 3 Step 3 改为 button）

**`src/lib/journalService.js`：**
- 第 29–35 行：`updateEntry({ id, userId, fields })`，直接透传 fields，支持 `created_at` 字段，**无需改动**

---

## 五、数据流速查

### 新建记录（HomePage）

```
mount → selectedDatetime = new Date(), manualOverride = false

用户输入（debounce 800ms）
  → inferDatetime(content) 有结果 且 !manualOverride
  → setSelectedDatetime(result)

用户点 pill → DatetimePicker → 确认
  → setSelectedDatetime(picked)
  → setManualOverride(true)

点 ✓ 保存
  → created_at: selectedDatetime.toISOString()
```

### 已有记录（RecordDetail）

```
用户点左上角时间戳
  → showDatetimePicker = true

用户确认
  → updateEntry({ created_at: picked.toISOString() })
  → setEntry(e => ({ ...e, created_at: picked.toISOString() }))
```

---

## 六、pill 视觉状态

| 状态 | 条件 | 样式 |
|---|---|---|
| 默认 | `manualOverride = false` 且 inferDatetime 无匹配 | `color: #bbb`，无边框无背景 |
| 已修改 | inferDatetime 匹配到关键词，或用户手动确认过 | `color: #c9a96e`，`background: #fdf6ec`，`border: 1px solid #f0e4cc` |

pill 无 emoji，无图标，纯文字。自动识别后**只有 pill 颜色变化**，无 hint banner，无撤销按钮。

---

## 七、成功标准（验收清单，见 spec §6）

1. 写作页模板栏右侧有灰色时间文字，无 emoji
2. 输入「昨晚跟妈妈」→ 800ms 后 pill 变金色显示「昨天 21:00」
3. 「今早」+「昨晚」，当前时刻中午 → pill 显示「今天 09:00」
4. 手动点 pill → picker sheet 弹出，快捷按钮 / 日历 / 时间框联动
5. 手动确认后 pill 变金色，继续输入关键词不再覆盖
6. 保存后记录 created_at 为用户选择的时间
7. RecordDetail 时间戳可点击 → 确认后 DB 更新，显示刷新
8. 编辑模式（editEntry）进 HomePage 时，不显示日期 pill

---

## 八、注意事项

- **编辑模式不显示 pill**：所有 selectedDatetime 逻辑只在 `!isEditMode` 时生效
- **pill 判断「已修改」**：精确到分钟，与 `new Date()` 相差 < 60s 视为默认状态（灰色），否则金色
- **draft 恢复时还原 selectedDatetime**：`handleResumeDraft` 需同步还原 selectedDatetime + manualOverride
- **时间输入框校验**：失焦时格式非法（如 25:99）重置为合法值（原 initialDatetime 的时分）
- **快捷按钮与日历联动**：点快捷按钮时日历同步跳到对应月；点日历某天时快捷按钮自动取消高亮（除非刚好是那四天之一）
