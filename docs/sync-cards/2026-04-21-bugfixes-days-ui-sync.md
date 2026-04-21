# 同步卡：Bug 修复批次 + Days 触发清理 + UI 调整
**日期：** 2026-04-21  
**session 类型：** 代码  
**状态：** ✅ 已完成，已 commit（3fd16b8）

---

## 本批次做了什么

### Bug 修复（plan: 2026-04-21-bug-fixes-people-letter-time）

| # | 问题 | 根因 | 修复 |
|---|---|---|---|
| 1 | detectPeopleFromText 子词覆盖长词 | 无长度优先排序，无区间冲突检测 | pairs 按 kw.length 降序，用 usedRanges 追踪已匹配区间 |
| 2 | dismissedPeople 切走草稿丢失 | saveDraft 未存 dismissedPeople | Set→Array 存草稿，loadDraft/handleResumeDraft 恢复为 new Set() |
| 3 | 回顾信触发设置切页重置 | getUserLetterPrefs 未 export，SettingsPage 挂载时未读已存偏好 | 加 export，useEffect 挂载时调用并 setState |
| 4 | 数字框输入中途被强制 | onChange 里 Math.max(3,...) 把 "1" 强制成 "3" | 独立 countInput string state，onBlur 才 clamp 保存 |
| 5 | EditEntryPage 时间 pill 不可见 | header 三列布局 pill 被挤 | 顶栏改为两列：时间 pill（左）| 保存（右），去掉取消和标题 |

### Days 触发死代码清理（plan: 2026-04-21-remove-days-trigger）

- `getUserLetterPrefs` 三个 return 点统一 `days→count` normalize（兼容旧 localStorage/user_memory 存储）
- 默认值删除 `day_interval: 7`
- `checkAndGenerateLetter` 删除 `daysSinceLast` 变量，`shouldGenerate` 简化为单 count 分支
- `SettingsPage` 初始 state 删除 `day_interval: 7`

### UI 调整（无 plan，用户反馈）

- `AwarenessFlow`「保存并退出」→「保存」
- `HomePage` 顶栏编辑模式：新增时间 pill（初始化自 `editEntry.created_at`，可点击弹 DatetimePicker），排列为「时间 | 取消」；保存时写回 `created_at`

---

## 改动文件

| 文件 | 改动 |
|---|---|
| `src/lib/contactsService.js` | detectPeopleFromText 长度优先匹配 + usedRanges |
| `src/lib/reviewLetterService.js` | getUserLetterPrefs export + normalize + 删 daysSinceLast |
| `src/pages/HomePage.jsx` | dismissedPeople 草稿持久化；编辑模式时间 pill + created_at 写回 |
| `src/pages/SettingsPage.jsx` | countInput string state；挂载时加载已存偏好；删 day_interval 初始值 |
| `src/pages/EditEntryPage.jsx` | 顶栏简化为时间pill + 保存 |
| `src/components/AwarenessFlow.jsx` | 「保存并退出」→「保存」 |

---

## 无 DB 变更，无新依赖
