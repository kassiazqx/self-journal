# 写作页日期时间选择 功能设计

> 版本：2026-04-18
> 设计看板：`docs/superpowers/design-boards/2026-04-18-datetime-picker.html`
> 架构审查：2026-04-18（Q1–Q4 已回答，结论见下）

---

## §0 架构审查结论（2026-04-18）

| # | 问题 | 结论 |
|---|---|---|
| Q1 | Supabase 允许 UPDATE `created_at` 吗 | ✅ 可以。`DEFAULT now()` 仅约束 INSERT，不保护 UPDATE。RLS 通过即可写入，无需 RPC 绕过。 |
| Q2 | `inferDatetime` 放哪里 | ✅ 独立文件 `src/lib/dateUtils.js`。纯函数，零副作用，属 lib/ 层，内联 HomePage 违反 §2 分层。 |
| Q3 | `DatetimePicker` 独立组件还是内联 | ✅ 独立组件 `src/components/DatetimePicker.jsx`（props: `initialDatetime / onConfirm / onClose`）。两处共用，内联必然重复。 |
| Q4 | `manualOverride` 是否随草稿存 localStorage | ✅ 需要。`selectedDatetime`（ISO 字符串）+ `manualOverride`（boolean）一起存入 `journal_draft`。读取时 `new Date(str)` 转回 Date 对象。 |

---

## §1 背景与目标

### 当前问题

新建记录时 `created_at` 固定为保存时刻（`new Date().toISOString()`），用户无法调整。常见场景：

- **补记**：昨天或更早发生的事今天才写，希望把时间设为当时
- **时间修正**：写了一半切出去，保存时时间戳偏晚

已有记录的时间（RecordDetail 左上角）同样不可编辑。

### 目标

1. **HomePage 新建模式**：模板栏右侧显示日期时间 pill，支持关键词自动识别 + 手动点击修改，保存时写入 `created_at`
2. **RecordDetail**：左上角时间戳改为可点击，弹 picker sheet 修改后写回 DB
3. **Picker sheet**：两处共用同一套 UI（快捷按钮 + 迷你日历 + 时间输入框）

---

## §2 HomePage 新建模式

### 2.1 日期时间 pill

位置：模板标签栏右侧（`margin-left: auto`）

```
[感恩] [情绪✓] [学习] [行动] [随手记]          今天 14:32
```

**两种视觉状态：**

| 状态 | 条件 | 样式 |
|---|---|---|
| 默认 | `manualOverride = false` 且 inferDatetime 未匹配到任何关键词 | 灰色文字 `#bbb`，无边框 |
| 已修改 | inferDatetime 匹配到关键词，或用户手动通过 picker 确认过 | 金色文字 `#c9a96e`，`background: #fdf6ec, border: 1px solid #f0e4cc` |

无图标，无 emoji，纯文字。点击弹出 picker sheet。

**显示格式：**
- 今天：`今天 HH:MM`
- 其他日期：`M月D日 HH:MM`（如「4月16日 21:00」）

### 2.2 自动识别（inferDatetime）

**触发时机：** 用户输入停顿 800ms 后 debounce 检测全文。

**识别规则：**

| 关键词 | 日期偏移 | 时间 |
|---|---|---|
| 现在 / 刚刚 | ±0 | `new Date()`（当前时刻） |
| 今早 / 今晨 / 早上 / 上午 | ±0 | 09:00 |
| 中午 | ±0 | 12:00 |
| 下午 | ±0 | 16:00 |
| 傍晚 | ±0 | 18:00 |
| 晚上 / 夜里 / 今晚 | ±0 | 21:00 |
| 凌晨 | ±0 | 01:00 |
| 昨天 | -1 | 不变 |
| 昨晚 / 昨夜 | -1 | 21:00 |
| 前天 | -2 | 不变 |
| 大前天 | -3 | 不变 |

口语缩写预处理：
- `昨晚 / 昨夜` → `昨天晚上`（再匹配日期 + 时段）
- `今晚` → `今天晚上`
- `今早 / 今晨` → `今天早上`

**多关键词冲突处理：**

1. 把每个识别到的关键词换算成绝对 `Date` 对象
2. 过滤掉 > `now` 的（未来时间点无效）
3. 取最近的（最大时间戳）

示例（当前时刻 = 今天 12:00）：
- 输入含「今早」(09:00) + 「昨晚」(昨天 21:00) → 两个都 ≤ now，今早 09:00 > 昨晚，**取今早**
- 输入含「今天下午」(16:00) + 「现在」(12:00) + 「昨晚」→ 今天下午是未来，过滤；现在(12:00) > 昨晚，**取现在**

**自动识别不覆盖手动修改：**
用一个 `manualOverride` flag，用户通过 picker sheet 确认后置 `true`，之后 inferDatetime 不再更新 `selectedDatetime`。

**视觉反馈：**
仅 pill 颜色变化（灰 → 金），无 hint banner，无撤销按钮。

### 2.3 编辑模式（editEntry）

进入 HomePage 编辑模式时，**不显示日期时间 pill**。已有记录的时间通过 RecordDetail 左上角修改（§3）。

---

## §3 RecordDetail 时间戳编辑

### 3.1 入口

RecordDetail 左上角时间戳（当前由 `formatDateTime(entry.created_at)` 渲染）改为可点击：

```
4月18日 周五  14:32    ← 点击整行触发 picker
```

视觉变化：加 `cursor: pointer`，hover 时轻微变色（`color: #999`），其余不变，不加下划线。

### 3.2 行为

点击 → 弹出 Picker Sheet（§4），初始值 = `entry.created_at`。

用户确认后：
1. 调 `updateEntry({ id, userId, fields: { created_at: newDatetime.toISOString() } })`
2. 本地 `setEntry(e => ({ ...e, created_at: newDatetime.toISOString() }))` 立即刷新显示

---

## §4 Picker Sheet（共用）

两处（HomePage pill 点击 / RecordDetail 时间戳点击）共用同一套 sheet UI。

### 4.1 结构

```
────────────────────────────
  ▬ （drag handle）

  记录时间

  [今天]  [昨天]  [前天]  [大前天]

  ‹  2026年 4月  ›
  一  二  三  四  五  六  日
  …  …  …  …  17  18▣ …

  时间   [14 : 32]

  [     确认     ]
────────────────────────────
```

### 4.2 快捷按钮

- 四个固定选项：今天 / 昨天 / 前天 / 大前天
- 点击立即选中对应日期，**时间保持不变**（不重置）
- 与日历联动：快捷按钮选中时日历高亮对应日期；手动点日历某天时快捷按钮取消高亮（除非刚好是那四天之一）

### 4.3 迷你日历

- 展示当月，可左右翻月（‹ / ›）
- 今天：金色字体
- 选中日期：金色实心圆背景
- 未来日期：正常可点（允许设置未来时间，如提前规划）
- 初始展示月份 = 当前选中日期所在月

### 4.4 时间输入框

- 单个文本输入框，格式 `HH:MM`，可直接编辑
- 失焦时做格式校验：非法格式（如「25:99」）重置为合法值（原值）
- 不做 scroll-wheel picker，直接文字输入最简单

### 4.5 确认与关闭

- **确认按钮**：写回 selectedDatetime（HomePage）或写 DB（RecordDetail），关闭 sheet
- **点背景**：关闭 sheet，不保存（放弃修改）
- Sheet 使用 `position: fixed, inset: 0, zIndex: 100`，白色圆角底部面板

---

## §5 数据流

### 新建记录（HomePage）

```
mount
  └─ selectedDatetime = new Date()
  └─ manualOverride = false

用户输入（debounce 800ms）
  └─ inferDatetime(content, now) → 有结果 且 !manualOverride
       └─ setSelectedDatetime(result)

用户点 pill → picker sheet → 确认
  └─ setSelectedDatetime(picked)
  └─ setManualOverride(true)

点 ✓ 保存
  └─ insertEntry({ ..., created_at: selectedDatetime.toISOString() })
```

### 已有记录（RecordDetail）

```
用户点左上角时间戳
  └─ 打开 picker sheet（初始值 = entry.created_at）

用户确认
  └─ updateEntry({ created_at: picked.toISOString() })
  └─ setEntry(e => ({ ...e, created_at: picked.toISOString() }))
```

---

## §6 成功标准

1. 写作页模板栏右侧有灰色时间文字，无 emoji
2. 输入「昨晚跟妈妈」→ 800ms 后 pill 变金色显示「昨天 21:00」
3. 多关键词冲突：「今早」+「昨晚」，当前时刻中午 → pill 显示「今天 09:00」
4. 手动点 pill → picker sheet 弹出，快捷按钮 / 日历 / 时间框联动
5. 手动确认后 pill 变金色，之后继续输入不再自动覆盖
6. 保存后记录的 created_at 为用户选择的时间
7. RecordDetail 左上角时间戳可点击 → picker sheet 弹出 → 确认后 DB 更新，显示刷新
8. 编辑模式（editEntry）进入 HomePage 时，不显示日期 pill
