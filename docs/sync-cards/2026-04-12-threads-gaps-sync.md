# 同步卡片：脉络交互细节补充（2026-04-12）

> 给代码 session / 架构 session 的快速同步。详细设计见 `docs/superpowers/specs/2026-04-12-threads-interaction-gaps.md`，完整 UI 设计稿见 `.superpowers/brainstorm/57585-1775973695/content/threads-final-design.html`。

---

## 本次产品决策汇总

### 1. 脉络关联记录手动增删

- **入口**：脉络详情页「···」浮窗 → 「编辑关联记录」→ 编辑模式
- **编辑模式**：橙色顶部 banner + 搜索框置顶 + 现有记录带红色 × + 搜索结果带绿色 +
- **AI 关联的记录也可被用户手动移除**，`removed_by_user=true` 后 AI 不再重复添加
- **手动添加的记录**（`added_by='user'`）AI 无法自动移除
- **arc_summary 不自动更新**：编辑完成后显示⚠过期提示，用户手动点击重新生成

### 2. 单条脉络「重新分析」

- 只扫描从未被此脉络评估过的新 entry（跳过 `removed_by_user=true` 的）
- **必须带入现有脉络名称 + arc_summary 作为上下文**，否则 AI 不知道脉络是关于什么的
- 结果写入候选待用户确认，不自动加入

### 3. 候选脉络状态机（新增 `rejected`）

```
candidate → 接受 → confirmed
candidate → 忽略 → rejected（灰色保留在待确认列表下方，AI 不重复提议）
candidate → 删除 → 行删除（AI 可能重复提议）
confirmed → 归档 → archived
confirmed → 删除 → 行删除（二次确认）
archived  → 恢复 → confirmed
archived  → 永久删除 → 行删除（二次确认）
rejected  → 删除 → 行删除（灰色卡片右侧按钮触发）
```

**threads.status CHECK 约束需更新**：加入 `'rejected'`

### 4. 待确认 Tab 布局

- 上方：活跃候选（status='candidate'），正常色，可点入详情
- 下方（分隔线后）：已忽略（status='rejected'），灰色，不可点入，右侧有「删除」按钮
- **角标只计 candidate，不计 rejected**
- 直接返回不操作 = 候选状态不变

### 5. 候选详情页操作

- 展示：AI 发现理由 + 关联记录列表（只读）
- 底部按钮：`[ ✓ 接受 ]  [ 忽略 ]`（无删除，删除在灰色列表卡片上）

### 6. 脉络归档

- **「···」菜单**：编辑名称 / 编辑关联记录 / 重新分析 / 归档（橙色）/ 删除（红色）
- 归档态详情页：只读，无「···」菜单，底部固定「恢复」+「永久删除」
- 永久删除弹窗说明：删脉络和关联关系，**原始笔记完整保留**

### 7. 手动触发分析 UI

- 入口：ThreadsPage 已确认 Tab 底部虚线按钮 **或** 右上角「+」→「AI 分析发现」
- 「+」为右上角小浮窗（≈154px），两选项：手动创建 / AI 分析发现
- AI 分析确认 sheet：说明耗时 + 时间范围横向 chip（7天/30天/半年/1年/全部，默认半年）
- 分析中：入口按钮变 spinner，页面可继续使用
- 完成后：底部 toast「发现 N 个候选，已加入待确认 · 去查看 ›」

### 8. category_tags 编辑

- 位置：RecordDetail 顶部 header card，emotion chips 下方单独一行
- 布局：`chips-area（flex:1）+ ✎（flex-shrink:0）`，与摘要索引区 ✎ 对齐
- 点 ✎ → 底部 sheet 多选，标签从 user_options 读取
- 保存 → 写回 `journal_entries.category_tags`（array）

### 9. 洞察页脉络区块

- 有候选时：header 右侧橙色角标「N 个待确认」+ 区块底部橙色提示条「去确认 ›」
- 无候选时：不渲染提示条

---

## 数据库变更

```sql
-- 1. thread_entries 新增字段
ALTER TABLE thread_entries
  ADD COLUMN removed_by_user boolean NOT NULL DEFAULT false;

-- 2. threads.status 约束更新（加 rejected）
-- 需要先删除旧约束再添加新约束，具体操作视 Supabase migration 方式
```

---

## 待代码 session 确认

- [ ] threads.status 的 CHECK 约束修改方式（Supabase migration）
- [ ] thread_entries.removed_by_user 字段添加
- [ ] 候选详情页是新建页面（CandidateDetailPage.jsx）还是复用 ThreadDetailPage.jsx 带参数？
