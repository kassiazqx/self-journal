# 图片上传功能 设计文档

> 版本：2026-04-19

---

## §0 背景与范围

允许用户在写作时上传图片，图片与日记条目关联，在记录列表和记录详情中展示。

**涉及场景：**
- 写作页（HomePage）：上传、预览、调序、删除图片
- 编辑页（通过 RecordDetail 编辑入口）：同写作页
- 记录列表页（RecordsPage）：卡片右侧单张缩略图
- 记录详情页（RecordDetail）：原始记录流内宫格展示

**不涉及：**
- 觉察卡片（AwarenessFlow）不加图片入口
- 不改动核心字段区、摘要索引区、情绪标签、脉络等任何现有 UI

---

## §1 数据层

### 1.1 数据库字段

在 `journal_entries` 表新增一列：

```sql
ALTER TABLE journal_entries
ADD COLUMN image_urls text[] DEFAULT '{}';
```

字段语义：
- `text[]` 有序数组，存 Supabase Storage 的 public URL
- 顺序即展示顺序，调序时直接更新整个数组
- 空记录为 `[]`（空数组），不为 null

### 1.2 Supabase Storage

Bucket 名：`journal-images`（需在 Supabase 控制台创建，设为 public）

文件路径规则：
```
journal-images/{user_id}/{entry_id}/{timestamp}_{filename}.jpg
```

例：`journal-images/abc123/entry-456/1745000000_photo.jpg`

### 1.3 图片压缩规则

上传前在前端压缩：
- 目标大小：≤ 500 KB
- 目标格式：JPEG（quality 逐步降低直到满足大小要求）
- 最大尺寸：长边不超过 1600px（保留比例缩放）
- 使用 Canvas API 实现，不引入额外依赖

---

## §2 抽象层 imageStorage.js

**文件位置：** `src/lib/imageStorage.js`

提供四个纯函数接口，所有图片操作都通过这层，不在 UI 组件里直接调 Supabase Storage。未来迁移到本地存储只改这一个文件。

```js
// 压缩并上传图片，返回 public URL
// file: File 对象，userId/entryId: string
// 返回: Promise<string>（public URL）
export async function uploadImage(file, userId, entryId)

// 从 Storage 删除图片
// url: Storage public URL（从中解析路径）
// 返回: Promise<void>
export async function deleteImage(url)

// 从 URL 获取可展示的 URL（当前直接返回 url，未来可做本地路径映射）
// 返回: string
export function getImageUrl(url)

// 压缩图片（内部工具，也可单独调用）
// file: File，返回 Blob
export async function compressImage(file)
```

**实现约束：**
- `uploadImage` 内部先调 `compressImage`，再调 `db`（Storage）上传
- 上传路径：`{userId}/{entryId}/{Date.now()}_{file.name.replace(/\s/g,'_')}.jpg`
- 删除时从 URL 解析出 Storage 路径（截取 bucket 名之后的部分）
- 函数不抛异常，调用方检查返回值

---

## §3 UI 规格

### 3.1 图片上限

`MAX_IMAGES = 5`（单个常量，改一处即可切换至 3 或 6）

### 3.2 写作页

**触发入口：** 底部操作栏左侧的相机图标（极简 SVG 线条）

底部操作栏三控件布局：
```
[相机 SVG]     [✦ 深入觉察]     [✓]
  左                中            右
```
`justify-content: space-between`，三控件各自独立，不互相遮挡。

**无图片时：** 宫格区隐藏，底部操作栏保持三控件不变。

**有图片时：** 文字输入区下方出现图片宫格：

```
display: grid
grid-template-columns: repeat(3, 1fr)
gap: 3px
padding: 4px 14px 2px
```

每格 `aspect-ratio: 1/1`，`border-radius: 6px`，`overflow: hidden`。

图片数 < MAX_IMAGES 时，最后一格显示 `＋` 按钮（`border: 1.5px dashed #c9a96e`）。
图片数 = MAX_IMAGES 时，`＋` 按钮不渲染。

宫格下方提示文字：`长按拖动调序 · 最多5张`（字号 10px，颜色 `#bbb`）

**调序：** HTML5 drag-and-drop（`draggable`、`onDragStart`、`onDragOver`、`onDrop`），长按触发（移动端触发 `touchstart` → `setTimeout 500ms` → 激活拖拽模式）。

**点击图片：** 全屏查看（简单 `position: fixed` 遮罩，点击关闭）。

**删除图片：** 全屏查看状态下右上角显示删除按钮。

### 3.3 记录列表页

有图片的卡片，在卡片右侧添加 56×56 单张缩略图（取 `image_urls[0]`）：

```jsx
<img
  src={getImageUrl(entry.image_urls[0])}
  style={{ width: 56, height: 56, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }}
/>
```

日期行在时间后追加图片数量提示（图片数 > 0 时显示）：

```jsx
<svg ...相机线条图标 width=11 height=9.../>
<span style={{ color: '#bbb' }}>{entry.image_urls.length}</span>
```

无图片的卡片：不渲染缩略图区，布局不变。

### 3.4 记录详情页

图片宫格插入位置：原始记录流区块内，`raw_entry` 节点文字**正下方**，觉察对话问答**之前**。

**有 messages（觉察对话）时：**
```
── 原始记录流 ──
[raw_entry 文字]          ← 现有，不动
[图片宫格]                ← 新增，仅在 image_urls.length > 0 时渲染
[点击图片全屏查看]         ← 新增提示文字
✦ 第一个觉察问题           ← 现有 ai_prompt 节点，不动
用户回答                   ← 现有 ai_answer 节点，不动
...
```

**无 messages（只有原始文字）时：**
```
── 原始记录流 ──
[entry.content 文字]      ← 现有，不动
[图片宫格]                ← 新增
[点击图片全屏查看]
```

宫格规格与写作页完全一致（`repeat(3, 1fr)`，`gap: 3px`，`aspect-ratio: 1/1`，`border-radius: 6px`）。

详情页宫格只展示，不可调序、不可删除（删除通过编辑入口进入写作页操作）。

---

## §4 状态管理

写作页（HomePage）新增状态：

```js
const [imageUrls, setImageUrls] = useState([])  // 当前 entry 已上传的 URL 数组
const [uploading, setUploading] = useState(false) // 上传中状态（防止重复点击）
```

编辑已有记录时，从 `journal_draft` localStorage 读取已存 `image_urls` 初始化；或在 `loadDraft` 时从 entry 读取。

保存时将 `imageUrls` 写入 `journal_entries.image_urls`（与其他字段一起保存）。

---

## §5 编辑已有记录

从 RecordDetail 点「编辑」进入写作页时，`image_urls` 字段随 entry 数据一起传入，初始化 `imageUrls` state。

编辑过程中增删图片：
- 新增：调 `uploadImage()`，返回 URL 追加到 `imageUrls`
- 删除：从 `imageUrls` 移除 URL，同时调 `deleteImage(url)` 从 Storage 删除文件
- 保存：整个 `imageUrls` 数组写回数据库

---

## §6 成功标准

1. 写作页底部相机图标（SVG 线条）可点击，弹出系统文件选择器
2. 选图后图片被压缩到 ≤500KB 并上传，宫格出现缩略图
3. 最多5张，第6张无法添加（+ 按钮不显示）
4. 长按图片可拖动调序，松手后顺序更新
5. 点击图片全屏查看，全屏状态下可删除
6. 保存后，记录列表卡片右侧出现第一张缩略图 + 线条图标 + 数量
7. 点进详情页，原始记录流区块：文字下方出现图片宫格
8. 详情页觉察对话区（ai_prompt / ai_answer 流式文字）位置不变，样式不变
9. 编辑已有记录时，原有图片正确加载，可增删调序后保存
10. 不同屏幕宽度下始终三列，间距一致

---

## §7 不涉及范围（明确排除）

- 觉察卡片（AwarenessFlow）不加图片功能
- 详情页核心字段区、摘要索引区、情绪 chips、脉络标签等 UI 全部不动
- 不做全屏查看的左右滑动翻页（点击图片打开单张全屏即可）
- 不做图片 OCR 或 AI 识图
- 不做视频支持
