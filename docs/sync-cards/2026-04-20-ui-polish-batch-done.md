# 同步卡：UI 小批次优化 · 完成记录

> **状态：✅ 已完成**
> 日期：2026-04-20

---

## 涉及文件

| 文件 | 改动 |
|---|---|
| `src/pages/RecordsPage.jsx` | 回顾信改为顶部固定卡片入口 |
| `src/pages/HomePage.jsx` | 键盘弹起时底部栏贴键盘 |
| `src/components/RecordDetail.jsx` | 编辑入口从 header 移到原始记录流 ✎ |
| `src/components/MainLayout.jsx` | 两处 RecordsPage 补传 onOpenLetterList prop（bug fix） |
| `src/pages/SettingsPage.jsx` | 修复回顾信频率切换报错（updateMemory 参数错误） |

---

## Task 1：RecordsPage — 回顾信改为顶部固定卡片

**改动：**
- 删除时间流中的 `LetterCard` 渲染（信不再混在日记流里）
- 删除原「未读回顾信横幅」（`latestUnreadLetter` state 一并清理）
- 滚动容器顶部固定一张卡片：
  - **有信时**：最新一封内容节选（60字）+ 封数 + 期间 + 未读气泡 → 点击跳回顾信列表
  - **无信时**：灰色虚线卡片 + 「记录满 10 篇后自动生成」引导文字，不可点击
- `allLetters` 按 `period_end` 降序，`allLetters[0]` 是最新封

**Bug fix（同批修复）：**
- `RecordsPage` 函数签名补 `onOpenLetterList` prop
- `MainLayout.jsx` 两处 `<RecordsPage>` 均补传 `onOpenLetterList={handleOpenLetterList}`（之前两处都漏传，点卡片报 `is not a function`）

---

## Task 2：HomePage — 键盘弹起时底部栏贴键盘

**改动：**
- 新增 `keyboardOffset` state + `visualViewport` resize/scroll 监听
- 计算公式：`window.innerHeight - vv.height - nav.getBoundingClientRect().height`
  - 用 `document.querySelector('nav')` 实测导航栏高度，兼容浏览器和 PWA 模式
- 底部浮动栏从 `bottom: 0` 改为 `bottom: keyboardOffset`（整体上移，不改 paddingBottom）
- `transition: 'bottom 0.1s'` 让移动有轻微缓动

**注意：**
- 使用 PWA（添加到主屏幕）时体验更佳，浏览器模式下地址栏弹出会额外占位，属系统行为无法规避

---

## Task 3：RecordDetail — 编辑入口移到原始记录流 ✎

**改动：**
- 删除 header 右侧「编辑」文字按钮
- 「── 原始记录流 ──」标题行改为 flex 布局，右侧加金色 ✎ span
- `padding: '6px 8px', margin: '-6px -8px'` 补偿触摸区至约 26×26px（满足 §8 最小触摸目标约束）

---

## Bug Fix：SettingsPage 回顾信频率切换报错

**现象：** 选择「手动生成」等选项时控制台报 `Could not find the '0' column of 'user_memory'`

**根因：** `saveUserLetterPrefs(user.id, updated, (patch) => updateMemory(user.id, patch))` 中 `updateMemory` 只接受一个参数 `fields`，但传入了 `user.id` 作为第一个参数，导致 UUID 字符串被 spread 成列名

**修复：** 第三个参数改为 `() => {}`，偏好只走 localStorage 存储（`saveUserLetterPrefs` 已有降级路径）

---

## 验收结果

- ✅ 记录页顶部固定回顾信卡片（有信/无信两态）
- ✅ 点击卡片正确跳转回顾信列表
- ✅ 时间流不再出现信卡片
- ✅ 写作页键盘弹起时底部栏贴键盘，PWA 模式准确
- ✅ RecordDetail header 编辑按钮消失，✎ 出现在原始记录流标题行
- ✅ 回顾信频率设置不再报错
