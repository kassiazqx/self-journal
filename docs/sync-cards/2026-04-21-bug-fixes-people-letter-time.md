# 同步卡：Bug 修复批次 · 架构审查

> **状态：⏳ 待实现**
> Plan：`docs/superpowers/plans/2026-04-21-bug-fixes-people-letter-time.md`

---

## 一、改动清单

| # | 问题 | 文件 | 改动性质 |
|---|---|---|---|
| 1 | 人物子串误匹配（男朋友→朋友） | `contactsService.js` | 算法替换 |
| 2 | dismiss 人物状态切页后重置 | `HomePage.jsx` | localStorage 字段新增 |
| 3 | 回顾信设置切页重置 | `reviewLetterService.js` + `SettingsPage.jsx` | export 补齐 + useEffect 加载 |
| 4 | 触发方式改为自定义数字 + 手动 | `SettingsPage.jsx` | UI 替换，去掉「按天」选项 |
| 5 | EditEntryPage 无时间编辑 | `EditEntryPage.jsx` | 新增 DatetimePicker + 写 created_at |

---

## 二、架构审查要点

### §A detectPeopleFromText 算法变更（Task 1）

**改前：** `text.includes(kw)` — O(contacts × keywords)，简单字符串包含
**改后：** 所有 (canonical, kw) 对按 `kw.length` 降序排，长词优先匹配，已消耗区间 `[idx, idx+kw.length)` 不允许后续短词重叠。

**性能：** 联系人列表通常 < 50 个，排序成本可忽略不计。每次 render 实时调用，没有缓存，与现状一致。

**风险点：**
- 如果同一联系人有多个 alias，alias 之间也参与长度排序，行为正确（已有联系人命中后直接 break）
- 两个不同联系人的词互不重叠时均能匹配（场景：「我朋友和我男朋友都来了」→ 两个都识别）✅

**已知限制：** 纯字符串匹配，无分词，联系人词条本身的粒度由用户在设置页维护。

---

### §B dismissedPeople 加入草稿 localStorage（Task 2）

**改动：** `saveDraft()` 新增 `dismissedPeople: [...dismissedPeople]` 字段（Set 序列化为数组），`loadDraft()` 还原为 `new Set()`。

**向后兼容：** 旧草稿没有此字段，`draft.dismissedPeople ?? []` 兜底为空数组，兼容 ✅

**数据量：** 人名字符串，极小，不影响 localStorage 配额。

**草稿有效期：** 已有 24 小时过期机制，dismissedPeople 随草稿一起过期，不需要额外清理。

---

### §C getUserLetterPrefs export（Task 3）

**改动极小**：只加 `export` 关键字。函数逻辑不变：优先读 Supabase `user_memory.user_profile.letter_prefs`，降级 localStorage，默认值 `{ type: 'count', count_threshold: 10 }`。

**调用时机：** SettingsPage 的 `useEffect([user])` 中调用，用户登录后执行一次，之后由 onChange 实时保存，不会频繁调用。

---

### §D 去掉「按天」触发选项（Task 4）

**去掉：** `type: 'days'` + `day_interval` 字段不再出现在 UI。

**数据层影响：** `letterPrefs` 对象里 `type` 和 `day_interval` 字段依然存在于 `reviewLetterService.js` 的 `checkAndGenerateLetter` 逻辑中。**现有已保存了 `type: 'days'` 的用户**：打开 SettingsPage 后会加载到 `days`，但 UI 里没有这个选项，radio 都不选中（外观异常）。

**⚠️ 建议处理方式：** 加载 prefs 后，若 `type === 'days'`，自动 fallback 为 `{ type: 'count', count_threshold: 10 }`。

**实现：** 在 Task 3 Step 3 的 `.then(prefs => ...)` 里加一行：
```js
if (prefs.type === 'days') prefs = { ...prefs, type: 'count' }
```

---

### §E EditEntryPage 写入 `created_at`（Task 5）

**安全性：** `updateEntry` 里有 `.eq('user_id', userId)` RLS 双保险，用户只能改自己的记录，不存在越权风险。

**时区：** `editDatetime.toISOString()` 输出 UTC，与现有 `journal_entries.created_at` 格式一致 ✅

**排序影响：** `created_at` 改变后，该条目在时间流的位置会随之移动，下次加载列表时生效。这是预期行为——用户主动改时间，就是想让它出现在对应位置。

**已知限制：** 未做时间合法性校验（如未来时间、过去几年）。当前用 `DatetimePicker` 组件，该组件已有合理的时间范围限制，与写作页一致，可接受。

---

## 三、不涉及范围

- `checkAndGenerateLetter` 的 `days` 分支逻辑：保留不动（后续可单独清理）
- 联系人分词算法升级：本次只修子串问题，不引入 jieba 等分词库
- 人物识别的 dismiss 状态不跨设备同步（只在 localStorage，Supabase user_memory 未同步）——当前接受，不在本次范围

---

## 四、实施前确认清单

- [ ] **§D** 已确认：加载 `type: 'days'` 时自动 fallback 为 `count`（已写入 plan Task 3）
- [ ] 所有改动均在已有文件内，无新表、无新 API、无 schema 变更
