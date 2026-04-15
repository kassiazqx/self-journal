# 同步卡片：脉络交互细节 + RecordDetail 重设计（最终版）

> **代码 session 冷启动时读这一份即可。**
>
> 本卡覆盖从 spec 起草到架构审查的所有调整，是最终决策汇总。
>
> - 详细设计：`docs/superpowers/specs/2026-04-12-threads-interaction-gaps.md`（§A–§I）
> - 完整 UI 设计稿：`.superpowers/brainstorm/57585-1775973695/content/threads-final-design.html`（段①–⑧，共 10 个页面状态）
> - 原始 threads 功能 Plan：`docs/superpowers/plans/2026-04-11-threads-insights.md`（Task 1–12）

---

## 一、数据库变更（Task 0，必须最先执行）

```sql
-- 1. thread_entries 新增字段：标记用户手动移除，防止 AI 重复添加
ALTER TABLE thread_entries
  ADD COLUMN removed_by_user boolean NOT NULL DEFAULT false;

-- 2. threads.status 约束更新（新增 rejected 状态）
ALTER TABLE threads DROP CONSTRAINT IF EXISTS threads_status_check;
ALTER TABLE threads ADD CONSTRAINT threads_status_check
  CHECK (status IN ('candidate','confirmed','archived','rejected'));

-- 3. user_options 新增排序字段（支持拖动排序，表中当前不存在此字段）
ALTER TABLE user_options ADD COLUMN sort_order integer NOT NULL DEFAULT 0;
```

---

## 二、脉络状态机（完整，含新增 rejected）

```
candidate  →  接受  → confirmed
candidate  →  忽略  → rejected   （灰色保留在待确认 Tab 下方，AI 不重复提议）
candidate  →  删除  → 行删除     （AI 将来可能重复提议）
confirmed  →  归档  → archived
confirmed  →  删除  → 行删除     （二次确认弹窗）
archived   →  恢复  → confirmed
archived   →  永久删除 → 行删除  （二次确认弹窗）
rejected   →  删除  → 行删除     （灰色卡片右侧「删除」按钮触发）
```

---

## 三、ThreadsPage 三个 Tab

### 已确认 Tab（默认进入）
- 脉络卡片列表，点击 → 已确认脉络详情页
- Tab 底部虚线按钮「🔍 AI 分析发现新脉络」（快捷入口，等价于右上角「＋」→ AI 分析发现）
- 右上角「＋」浮窗（≈154px 右对齐），两个选项：
  - ✏️ 手动创建（命名 + 手动选 entry，创建后 status=confirmed）
  - 🔍 AI 分析发现（弹出确认 sheet）

**AI 分析确认 sheet 内容：**
- 说明耗时（通常 10~20 秒）+ 结果以候选形式出现需逐一确认
- 时间范围横向滑动 chip：`7天 / 30天 / 半年（默认）/ 1年 / 全部`
- 按钮：`[ 取消 ]  [ 开始分析 ]`
- 分析中：入口按钮变 spinner，页面可继续使用
- 分析完成：底部 toast「发现 N 个候选，已加入待确认 · 去查看 ›」
- 无新候选：toast 显示「暂时没有发现新脉络，稍后再试」

### 待确认 Tab
角标只计 `status='candidate'`，不计 `rejected`，避免虚高。

```
┌─ 活跃候选（status='candidate'）─────────────────┐
│  正常色卡片                                      │
│  来源标签：回顾信触发 · 日期 / 手动分析 · 日期   │
│  点击 → 候选详情页（CandidateDetailPage.jsx）    │
├─ 分隔线 ＋ 「已忽略」小标题 ────────────────────┤
│  灰色卡片（status='rejected'）                   │
│  不可点击进详情，右侧「删除」按钮 → 行删除       │
└─────────────────────────────────────────────────┘
```

直接返回不操作 = 候选状态不变（等同于「看了但还没决定」）。

### 已归档 Tab
- 卡片降低透明度（opacity ≈ 0.7），显示归档日期
- 点击 → 归档态详情页（ThreadDetailPage.jsx mode='archived'）

---

## 四、组件方案（已确认）

**两个文件，不合并：**

| 页面 | 文件 | 原因 |
|---|---|---|
| 候选详情 | 新建 `CandidateDetailPage.jsx` | 内容结构不同：AI 发现理由 ≠ arc_summary；标题固定为「候选脉络」而非脉络名 |
| 已确认详情 | `ThreadDetailPage.jsx` + `mode='confirmed'` | 共用 arc_summary + entries 结构 |
| 归档详情 | `ThreadDetailPage.jsx` + `mode='archived'` | 共用 arc_summary + entries 结构，差异只在 UI 状态和底部操作 |

### CandidateDetailPage.jsx 内容结构
1. 顶部：`‹ 脉络` / `候选脉络`（固定标题）/ 橙色「待确认」角标
2. 脉络名称 ＋ 来源标签（回顾信触发 · 日期 / 手动分析 · 日期）
3. AI 发现理由（文字框）
4. 关联记录列表（只读，可点击跳到笔记详情）
5. 底部固定：`[ ✓ 接受这条脉络 ]  [ 忽略 ]`
   - 接受 → `status='confirmed'`，跳回已确认 Tab，绿色 toast 约 3 秒消失
   - 忽略 → `status='rejected'`，返回列表，出现在灰色区

### ThreadDetailPage.jsx（mode='confirmed'）
1. 顶部：`‹ 脉络` / 脉络名称 / `···` 菜单按钮
2. arc_summary 文字框（含「AI 生成轨迹 · 日期」小字）
3. 若编辑完成后 arc_summary 过期：显示黄色⚠警告 ＋「点击重新生成轨迹 ›」
4. 关联记录列表（可点击进笔记详情，显示「AI 关联」/「我手动添加」标签）
5. 无固定底部操作栏

**`···` 菜单（右对齐浮窗 ≈154px，5 个选项）：**

| 选项 | 颜色 | 操作 |
|---|---|---|
| ✏️ 编辑名称 | 正常 | 内联编辑或弹出输入框 |
| 📝 编辑关联记录 | 正常 | 进入编辑模式 |
| 🔄 重新分析 | 正常 | 只扫描从未评估过的新 entry |
| 📁 归档 | 橙色 | 二次确认后 status='archived' |
| 🗑️ 删除 | 红色 | 二次确认后永久删除 |

**编辑关联记录模式：**
- 页面顶部：橙色 banner「编辑关联记录 ········ 完成」
- 搜索框固定在 banner 下方，用于搜索并添加记录
- 现有记录每条右侧有**红色 × 按钮**（AI 关联的也可移除）
- 搜索结果每条左侧有**绿色 + 按钮**
- 移除时 `removed_by_user=true`，不物理删除行，AI 不再重复添加
- 手动添加（`added_by='user'`）AI 无法自动移除
- 点「完成」保存，arc_summary 进入过期状态，显示⚠提示

**「🔄 重新分析」逻辑：**
- 只扫描从未被此脉络评估过的新 entry（不在 thread_entries 中的）
- 跳过 `removed_by_user=true` 的记录（用户排除意愿被尊重）
- **必须带入脉络名称 + arc_summary 作为上下文**，否则 AI 不知道脉络方向
- 结果写入候选待用户确认，不自动加入

### ThreadDetailPage.jsx（mode='archived'）
1. 顶部：`‹ 脉络` / 脉络名称（灰色）/ 灰色「已归档」角标（**无 `···` 菜单**）
2. 只读 banner：「📁 已归档 · 归档于 X月X日 · 仅供查看」
3. arc_summary（灰色调，文字可读）
4. 关联记录列表（opacity 降低，可点击跳到笔记详情）
5. 底部固定操作栏：
   - `[ ↩ 恢复为活跃脉络 ]`（→ status='confirmed'，跳回已确认 Tab）
   - `[ 永久删除 ]`（→ 居中确认弹窗）

**永久删除确认弹窗说明：**
- 「脉络及其 N 条关联关系将被永久删除」
- 「原始笔记不受影响」
- 「操作不可撤销」
- 按钮：`[ 取消 ]  [ 确认删除 ]`（确认为红色）
- 执行：`DELETE FROM threads WHERE id = ?`（thread_entries 因外键 CASCADE 自动清除）

---

## 五、洞察页脉络区块候选提示

- **有候选时**：区块 header 右侧显示橙色角标「N 个待确认」＋ 原有「查看全部 ›」并排；区块底部显示橙色提示条「回顾信生成时发现了 N 个新脉络候选 · 去确认 ›」，点击直跳 ThreadsPage 待确认 Tab
- **无候选时**：提示条不渲染，区块 header 只显示「查看全部 ›」

---

## 六、RecordDetail 顶部标签区重设计（§I）

### 布局顺序（从上到下）

```
[ 觉察 ▾ ]                         ← template_type（可点击切换）
[ 烦躁 ] [ 克制后的疲惫 ]           ← emotion_display（点击内联编辑）
[ 状态 −1 ▾ ]                       ← overall_state_score（可点击切换）
[ #人际 ] [ #情绪 ] ✎               ← category_tags（点 chips 或 ✎ 编辑）
```

### 四个字段交互

**`template_type`**
- badge 右侧带 ▾，点击 → 小下拉框（≈140px），5 选项：觉察 / 感恩 / 学习 / 行动 / 随手记
- 点选后立即写回 `journal_entries.template_type`，badge 文字同步刷新

**`emotion_display`**
- 点任意 chip → chips 消失，变为单个文字输入框，预填当前所有词（顿号分隔）
- 输入框右侧「✓」确认；Esc / 点外部取消
- 保存：按「、」拆分 → 新 `emotion_display` 数组 → `mapDisplayToBase()` → 同步更新 `emotions` → 两字段写回 Supabase
- ⚠️ RecordDetail.jsx 已有 `editingEmotions` 状态和 `mapDisplayToBase()` 调用，对齐现有逻辑，无需大改

**`overall_state_score`**（字段名确认：`overall_state_score`，非 `state_score`）
- chip 带 ▾，点击 → 小下拉框（≈160px），7 选项（颜色渐变）：

| 选项 | 颜色 |
|---|---|
| +3 非常好 | 深绿 |
| +2 比较好 | 绿 |
| +1 还不错 | 浅绿 |
| 0 中性 | 灰 |
| −1 有点难 | 浅红 |
| −2 比较难 | 红 |
| −3 非常难 | 深红 |

- 当前值左侧显示 ✓；点选后写回 `journal_entries.overall_state_score`，chip 同步刷新
- **历史数据兼容**：历史记录中可能存在 ±4/±5 的值（旧 prompt 范围 -5/+5），展示时 clamp 处理（超出范围的值显示原始数字，保存时不强制回写）

**`category_tags`**
- chips 区域或末尾 ✎ 点击 → 底部 sheet 弹出
- sheet 内容：chip 网格多选，已选高亮橙色；底部注释「在「我的」页面可以自定义这些标签」
- 按钮：`[ 取消 ]  [ 保存 ]`；保存写回 `journal_entries.category_tags`（array）
- 标签来源：`user_options` 表，`category = 'content_category'`，按 `sort_order` 排序

### core_needs 确认保持现状
`core_needs` **已在主体字段区**（核心字段区 `EditableFieldRow`），**无需移动，无需任何操作**。

---

## 七、「我的」页面：内容大类标签管理（§H）

**入口：** 「我的」→「自定义选项」→「内容大类标签」

**标签管理页 UI：**
- 列表：每条显示 ☰ 拖动手柄 ＋ 标签 chip 预览 ＋ − 删除按钮
- 列表底部：「+ 添加新标签」按钮行（内联输入，不跳新页）
- 说明文字：「删除标签不影响已打过该标签的笔记记录」

**排序：** 长按 ☰ 拖动，结果写回 `user_options.sort_order`

**删除：** 直接删除，无二次确认（误删可重新添加）；只从 `user_options` 删，历史笔记 `category_tags` 字段不受影响

**新增：** 内联输入框，输入标签名后点「完成」保存到 `user_options`（建议加 # 前缀，不强制）

---

## 八、其他代码变更（本轮架构 session 已完成）

| 文件 | 变更内容 |
|---|---|
| `src/lib/prompts.js` | `overall_state_score` 范围从 `-5到5` 改为 **`-3到3`**；状态描述词对应更新 |
| `src/lib/emotionMap.js` | 词库从 58词扩展到 **61词**（+渴望/敬佩/欣赏；崇敬从敬畏组移入敬佩组） |

---

## 九、全部已确认，无待决策项

所有交互细节、字段名、组件方案、数据库 SQL 均已最终确认，代码 session 可直接实施。
