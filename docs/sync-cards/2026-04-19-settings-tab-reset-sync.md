# 同步卡：「我的」Tab 切换重置子页面

> - 来源：用户需求（2026-04-19）
> - 执行方：代码 session
> - 状态：✅ 已完成（2026-04-19，commit 63db670）

---

## 问题

「我的」页面有三个子页面（内容标签 / 人物管理 / 需求管理）。切换到其他 Tab 再切回「我的」，会停留在上次离开时的子页面，不会自动回到顶层。

## 修复方案

与 `writeResetKey`（写作页重置）完全相同的模式：

- `MainLayout.jsx` 新增 `settingsResetKey` state
- `goTab('mine')` 时自增该 key
- `<SettingsPage key={settingsResetKey} />` 强制重挂载，内部所有 state（showTagManager / showPeoplePage / showNeedsPage）自动归零

## 改动文件

- `src/components/MainLayout.jsx`（+3 行）
