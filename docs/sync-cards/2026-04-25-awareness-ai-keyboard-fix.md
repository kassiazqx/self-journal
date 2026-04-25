# 同步卡：AwarenessFlow / AIConversation 键盘避让对齐

**日期：** 2026-04-25  
**类型：** 代码 session  
**分支：** dev

| Task | 问题 | 最终方案 | 改动文件 |
|---|---|---|---|
| Task 1 | 觉察卡片底部按钮随滚动轻微漂移 | `AwarenessFlow` 改成“内容区内层滚动 + fixed 底部按钮”，仅在 `visualViewport.resize` 时更新 `bottom` | `src/components/AwarenessFlow.jsx` |
| Task 2 | AI 深入觉察输入栏随消息区滚动不稳 | `AIConversation` 改成“消息列表内层滚动 + fixed 输入栏”，删除 `visualViewport.scroll` 补偿 | `src/components/AIConversation.jsx` |

## 关键决策

- 跟 `HomePage` 保持同一模式：外层不滚，真正滚动只发生在内容区内部。
- `paddingBottom` / `scrollPaddingBottom` 放到内层滚动容器，给 fixed 底栏留空间。
- 不再追 `visualViewport.scroll`，只在键盘 `resize` 时更新底栏位置。
