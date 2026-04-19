# 同步卡：FilterBar「日期 ▾」chip 未关闭人物/需求浮层

> - 来源：code-reviewer 审查（2026-04-19）
> - 执行方：代码 session
> - 状态：✅ 已完成（2026-04-19，commit ede9624）

---

## 问题

「日期 ▾」chip 的 onClick 里只关闭了情绪/类型浮层，未关闭后来新增的人物/需求浮层。
当人物或需求浮层已展开时，点「日期 ▾」会导致两个浮层同时显示。

## 修复

`src/components/FilterBar.jsx` 第 273 行，onClick 追加两句：

```js
// 修复前
onClick={() => { setShowCalendar(v => !v); setShowEmotionMenu(false); setShowCategoryMenu(false) }}

// 修复后
onClick={() => { setShowCalendar(v => !v); setShowEmotionMenu(false); setShowCategoryMenu(false); setShowPeopleMenu(false); setShowCoreNeedsMenu(false) }}
```

## 根因

人物/需求筛选维度是后来新增的（commit `44e46a6`），加入时四个「入口 chip」（情绪/类型/人物/需求）的互斥逻辑都正确更新了，但「日期 ▾」单独在另一处，漏改。
