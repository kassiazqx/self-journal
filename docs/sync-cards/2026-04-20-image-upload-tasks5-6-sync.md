# 同步卡：图片上传批次 Tasks 5–6

**日期：** 2026-04-20  
**变更范围：** RecordsPage / EditEntryPage / HomePage  
**Commit：** 5858140

---

## 变更概要

### Task 5 — RecordsPage 列表缩略图 + 上传失败 Banner

**文件：** `src/pages/RecordsPage.jsx`

1. **三处 select 均加 `image_urls`**
   - `load()`（初始加载）
   - `loadMoreEntries()`（无限滚动分页）
   - `handleFilter()`（搜索筛选结果）
   - 注意：三处都加是必须的，任一遗漏会导致对应场景的卡片不显示缩略图

2. **EntryCard 改版**
   - 容器改为 `display: flex`，左侧文字区 `flex: 1`，右侧缩略图 `56×56`
   - 日期行时间前插入 SVG 相机图标 + 图片数量（有图片时显示）
   - 无图片的条目：布局不变，仅文字

3. **图片上传失败 Banner**
   - 挂载时读取 `localStorage['image_upload_failed']`（JSON 数组）
   - 有失败记录时显示黄色 banner，点 ✕ 清除 localStorage 并隐藏

---

### Task 6 — EditEntryPage 图片编辑

**文件：** `src/pages/EditEntryPage.jsx`

1. **图片 state 初始化**
   - `imagePaths`：从 `entry.image_urls ?? []` 初始化（已有图片路径）
   - `newFiles` / `newPreviews`：新选但未上传的文件
   - `pathsToDeleteRef`（useRef）：待删除路径，延迟到保存后执行

2. **删除已有图片（两阶段提交，关键架构决策）**
   - 用户点 ✕：路径写入 `pathsToDeleteRef`，UI 立即移除
   - **不**立即删 Storage（防止 Cancel 后 DB 仍有旧路径造成 404 孤儿引用）
   - `handleSave` 写回新 `image_urls` 成功后，才批量调 `deleteImage`
   - 见 `arch-context.md §4.35`

3. **handleSave 改版**
   - 顺序：写 content → upsert conversations → 上传新图 → 写 image_urls → 删旧 Storage
   - 全程包在 `try/catch/finally`，出错后 `saving` 必然被重置，不会 UI 卡死
   - 新图上传失败时 `uploadImage` 返回 null，filter(Boolean) 过滤，不影响已有图片写回

4. **ObjectURL 清理**
   - `useEffect` cleanup 在组件卸载时 revokeObjectURL（对齐 HomePage 已有模式）
   - `handleDeleteNew` 在删除预览格时逐个 revokeObjectURL

5. **图片区 UI**
   - 3 列网格：已有图片（从 Storage URL 显示）+ 新选图（本地预览，角标「待上传」）+ ＋ 格（未满 5 张时显示）
   - 点图片全屏查看，点 ✕ 删除
   - `handleImageSelect` 加指纹去重（`name_size_lastModified`）

---

### 写作页 Bug 修复

**文件：** `src/pages/HomePage.jsx`

1. **删除按钮 ✕ 常驻显示**
   - 之前：需长按进入 `editingImages` 编辑态才显示 ✕
   - 现在：添加图片后右上角始终有 ✕，可直接点击删除
   - 拖拽调序（长按激活）逻辑保留，不冲突（`onPointerDown stopPropagation` 防误触发 dnd-kit）

2. **重复选图去重**
   - 用 `name_size_lastModified` 作指纹，已选的同一张图不会重复加入

---

## 给架构 session 的信息

- `image_urls` 字段类型：`text[]`（Storage 路径数组，非 URL）
- 所有图片操作（上传/删除/URL 转换）仍通过 `imageStorage.js` 进行，无 Storage 直接调用渗透
- EditEntryPage 的两阶段删除设计见 `arch-context.md §4.35`
- code-reviewer 在本批次发现并修复 6 个问题（2 Critical / 2 Important / 2 Suggestion）

## 给产品 session 的信息

- **记录列表**：有图片的笔记卡片右侧有缩略图预览，时间旁有相机图标+数量
- **编辑记录**（长按 → 编辑）：可在编辑页底部查看/删除已有图片，可新增图片，保存时同步
- **写作页**：选完图片后直接点右上角 ✕ 即可删除，不再需要长按
- **上传失败 banner**：若上次写作时图片上传失败，下次打开记录列表会有黄色提示条
