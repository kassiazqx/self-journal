# 同步卡：回顾信详情页相关脉络卡片

**状态：** ✅ 已完成  
**日期：** 2026-04-21  
**commit：** 105c3eb

---

## 完成内容

### DB 变更
- `threads` 表新增 `review_letter_id uuid REFERENCES review_letters(id) ON DELETE SET NULL`（手动在 Supabase SQL Editor 执行）

### 代码变更
| 文件 | 改动 |
|---|---|
| `src/lib/threadService.js` | 新增 `fetchThreadsByLetterId(letterId)` |
| `src/lib/reviewLetterService.js` | Step 7 insert thread 时写入 `review_letter_id: letter.id`；修复 AI 返回裸数组格式（格式C）时正文夹带 JSON 的问题 |
| `src/components/ReviewLetterDetail.jsx` | 展示相关脉络卡片（三态：待确认/已接受/已忽略）；内嵌接受/忽略操作；点击跳转详情页 |
| `src/components/MainLayout.jsx` | 补传 `onOpenCandidateDetail` / `onOpenThreadDetail` prop |

---

## 注意事项

- **历史回顾信不会显示脉络卡片**：只有 SQL 迁移执行后生成的新信，对应 threads 才有 `review_letter_id`，历史信脉络区域不显示（`threads.length === 0` 时整块隐藏），是预期行为
- **AI JSON 格式容错**：现支持三种格式——①``` ```json``` 代码块，②裸对象 `{suggested_threads:[...]}`,③裸数组 `[{...}]`；格式C时自动包装为标准结构
