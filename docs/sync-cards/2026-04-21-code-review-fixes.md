# 同步卡：Code Review 修复批次
**日期：** 2026-04-21  
**session 类型：** 代码  
**状态：** ✅ 已完成，已上线（commit af70497）

## 修复内容

| # | 问题 | 文件 | 修复 |
|---|---|---|---|
| 1 | RecordsPage EntryCard 情绪词有重复 key | RecordsPage.jsx:36 | `[...new Set(...)]` 去重，与 RecordDetail 一致 |
| 2 | AI 提取 prompt 未约束情绪词不重复 | prompts.js:211-212 | emotions / emotion_display 字段说明加「不得重复」 |
| 3 | handleBatchDelete Storage 失败被吞 | RecordsPage.jsx:383 | 改 try/catch，Storage 失败抛出阻止 DB 删除，避免孤儿文件；重试安全（deleteImage 幂等） |
| 4 | 裸 JSON 兜底正则非贪婪匹配 | reviewLetterService.js:106 | 改为 `[\s\S]*` 贪婪，正确捕获含嵌套对象的完整 JSON |

## 未修复（决策记录）

- **RecordsPage 直接用 db 查询**（架构规范轻微违反）：pre-existing，下次大重构顺手移到 journalService
- **SettingsPage saveUserLetterPrefs 传空函数**：回顾信偏好不写 user_memory，换设备丢失；低优先级，localStorage 已足够当前单设备使用
- **EditEntryPage onBack prop 未使用**：取消按钮已去除为有意设计，prop 可在下次清理时删除
- **await checkAndGenerateLetter 阻塞列表加载**：产品 brainstorm 后再决定是否拆分
