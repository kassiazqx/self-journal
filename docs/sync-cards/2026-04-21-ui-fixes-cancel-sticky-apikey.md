# 同步卡：UI 小修复（取消按钮 / 顶栏固定 / API Key 自动填充）

> **状态：⏳ 待实现**
> Plan：`docs/superpowers/plans/2026-04-21-ui-fixes-cancel-sticky-apikey.md`

---

## 一、改动清单

| # | 问题 | 文件 | 改动性质 |
|---|---|---|---|
| 1 | EditEntryPage 顶栏无取消按钮 | `EditEntryPage.jsx:203-227` | 加取消按钮 + sticky |
| 2 | RecordDetail 顶栏随内容滚走 | `RecordDetail.jsx:503-末尾` | 外层去 overflow，内容区独立滚动，顶栏 sticky |
| 3 | ReviewLetterDetail 顶栏随内容滚走 | `ReviewLetterDetail.jsx:26-末尾` | 同上 |
| 4 | API Key 被浏览器当密码保存 | `SettingsPage.jsx:363` | `autoComplete="new-password"` |

---

## 二、架构审查要点

### §A sticky 生效前提（Task 2 / 3 共同结论）

`position: sticky` 的参照系是**最近的有 overflow 的祖先元素**。如果祖先本身就有 `overflowY: 'auto'`，sticky 的参照系就是这个容器，顶栏只能相对容器顶部固定——而容器本身会滚动，结果等于没有固定。

**正确做法：** 外层 flex 容器去掉 `overflowY`，把 `overflowY: 'auto'` 下移到内容区 div，顶栏在外层 flex 容器内 sticky，参照系变为视口，生效。

两个组件结构变化相同：
```
外层 div（flex column, height 100%）        ← 无 overflow
  顶栏 div（sticky, top 0, zIndex 10）      ← 不动
  内容区 div（flex: 1, overflowY: auto）    ← 滚动
```

### §B RecordDetail 的 paddingBottom 归宿

原外层有 `paddingBottom: 100`（给底部操作栏留空间），移到内容区 div 上，行为不变。

### §C EditEntryPage sticky 可直接加

EditEntryPage 的外层结构是 flex column，顶栏已有 `flexShrink: 0`，外层无 `overflowY`，直接加 sticky 即可生效，无需重构。

### §D autoComplete="new-password" 原理

Chrome 会忽略 `autoComplete="off"`（认为帮用户记密码比开发者说的重要），但会尊重 `"new-password"`（语义：新密码输入框，不要用已保存凭据填充）。此为目前最有效的 Chrome 绕过方式，不影响其他浏览器。

---

## 三、不涉及范围

- CandidateDetailPage / ThreadDetailPage 顶栏：同样无 sticky，但无退出/保存功能，优先级低，不在本次范围
- 其他页面的 API key 相关输入：仅 SettingsPage 有此字段

---

## 四、实施前确认清单

- [x] RecordDetail 和 ReviewLetterDetail 的 sticky 失效根因相同（overflow 祖先），修法相同
- [x] EditEntryPage 外层无 overflow，sticky 可直接生效，无需重构
- [x] paddingBottom: 100 归属内容区，不丢失
- [ ] 所有改动均在已有文件内，无新表、无 API 变更
