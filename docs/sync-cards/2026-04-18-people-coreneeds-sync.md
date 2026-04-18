# 同步卡：people_involved + core_needs · 代码执行完成

> **代码 session 完成后的偏差记录和状态同步。**
>
> - 对应 plan：`docs/superpowers/plans/2026-04-18-people-coreneeds.md`
> - 对应 spec：`docs/superpowers/specs/2026-04-17-people-coreneeds-design.md`
> - git commit：`8b20071`
> - 完成日期：2026-04-18

---

## 执行结果

Tasks 1–8 已全部完成并 commit。新增文件：`contactsService.js`、`coreNeedsService.js`。

---

## 与 Plan 的关键偏差

### 偏差 1：chip 双向同步改为「渲染时实时计算」（影响 HomePage.jsx）

**Plan 的方案：** `handleContentChange` 里维护 `selectedPeople` state，文本里检测到人物就 push。

**实际实现：** 渲染时实时 `detectPeopleFromText(content, contacts)` + `selectedPeople`（手动选的）合并，结果作为 `displayedPeople` 不存 state。

**原因：** Plan 方案只加不减——文字删了 chip 不会消失。渲染时实时计算才能做到「文字删了 chip 消失，但 dismiss 仍然有效」。

**dismiss 语义区分（spec 未覆盖）：**
- 文字中人物别名消失 → chip 消失（不是 dismiss，重输还会回来）
- 用户点击 chip 的 ✕ → 写入 `dismissedPeople` Set（本次写作会话永久压制，重输不还原）

### 偏差 2：sheet 词库改为「每次打开时重新加载」（影响 RecordDetail.jsx）

**Plan 的方案：** `useEffect` on mount 时 loadContacts / loadCoreNeeds，之后不再刷新。

**实际实现：** 打开人物 sheet / 需求 sheet 的按钮 onClick 里额外调一次 loadContacts / loadCoreNeeds。

**原因：** 用户在 SettingsPage 新增了联系人后回到 RecordDetail，mount 时的缓存是旧的；sheet 打开时重新加载保证数据永远最新。mount 时的初始加载保留（冷启动用）。

### 偏差 3：seed 函数和 add 函数全部缺 user_id（Bug 修复，非设计偏差）

**Plan 代码** `seedDefaultContacts` 写的是 `user_id: user.id`，但实际执行时 `addContact` / `addCoreNeed` 没有 `user_id`，导致 RLS 403。

**修复：** 四个函数（两个 seed + 两个 add）全部加 `db.auth.getUser()` + `user_id: user.id`。

**教训已写入 §4.30：** Supabase INSERT 不自动填 user_id，所有 insert 必须显式传。

---

## 遗留问题 / 未完成

### 1. 输入校验（§4.29）未加

spec §4.29 要求词条写入前校验长度 ≤ 20、禁特殊字符。RecordDetail 的「+」新增输入框和 SettingsPage 的编辑框目前没有加此校验。

**下一步：** SettingsPage 人物/需求管理的编辑路径上加校验（RecordDetail「+」新增也要加）。

### 2. Task 9（group_name 分组）未做

plan Task 9 是 Tasks 1–8 全部完成后才做的可选任务（需先执行 ALTER TABLE SQL）。本批次没有执行，保留在 plan 文件里。

### 3. pending_core_needs banner 功能结构占位

RecordsPage 新增了 banner（橙色提示条）和 pending 计数展示，但处理弹卡片（spec §7.2 三路径操作：加入词库 / 改措辞 / 合并到已有）目前是结构占位，业务逻辑不完整。

---

## 数据库现状（2026-04-18）

- `user_contacts` 表已存在（Task 0 已执行），清理了重复行（seed 多次导致的重复 canonical）
- `pending_core_needs` 表已存在
- `replace_person_name` / `replace_core_need` RPC 函数已存在
- `user_options` 已有 field_name='core_need' 的默认 20 条词条（seed 完成）

---

## 下一步建议

1. **输入校验**（§4.29）：SettingsPage 和 RecordDetail 的自定义词条/联系人新增输入框加 length ≤ 20 + 禁特殊字符校验
2. **pending_core_needs 处理逻辑**：RecordsPage banner 点击后展示 pending 列表，支持「加入词库 / 改措辞加入 / 合并到已有词条」三路径
3. **Task 9（可选）**：user_contacts 加 group_name 分组字段，@ 浮层按分组显示
