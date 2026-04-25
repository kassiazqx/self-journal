# 同步卡：HomePage 键盘避让重构

**日期：** 2026-04-25  
**类型：** 代码 session  
**分支：** dev

| Task | 问题 | 最终方案 | 改动文件 |
|---|---|---|---|
| Task 1 | 键盘弹起时底部 4-tab 占位且易误触 | `MainLayout` 监听 `visualViewport.resize`，键盘态隐藏底部导航 | `src/components/MainLayout.jsx` |
| Task 2 | 底部悬浮栏会随整页滚动轻微漂移 | `HomePage` 改成“顶部固定 + 内层编辑滚动区”；悬浮栏保留 `position: fixed`，只在键盘 `resize` 时更新 `bottom` | `src/pages/HomePage.jsx` |
| Task 3 | 长文回看时底部内容被键盘挡住 | `paddingBottom` / `scrollPaddingBottom` 从外层根容器移到内层滚动容器，留白 = 键盘高度 + 悬浮栏高度 | `src/pages/HomePage.jsx` |

## 关键决策

- 不再让整个 `HomePage` 根容器滚动；顶部模板栏 / 时间 pill / 引导语固定在滚动区外。
- 真正滚动的区域只保留“编辑器 + 图片区”。
- 删除对 `visualViewport.scroll` 的追踪补偿，避免底部栏在快速滑动时抖动。

## 影响

- 修复写作页 3 个键盘相关问题：底部 tab 误触、悬浮栏漂移、长文底部遮挡。
- 只改布局层级和键盘避让逻辑，不改写作/保存业务逻辑。
