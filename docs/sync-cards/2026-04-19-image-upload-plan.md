# 同步卡：图片上传功能 · 代码 Session

> **代码 session 冷启动必读。按顺序读完再动手。**
> **状态：⏳ 待实现**

---

## 一、必读文档

| 文档 | 说明 |
|---|---|
| `docs/arch-context.md` §2.2 | db.js 适配层规则（lib/ 不得直接 import supabase） |
| `docs/arch-context.md` §2.11 | FilterBar / 父页面数据加载模式（参考结构） |
| `docs/arch-context.md` §4.30 | INSERT 必须显式传 user_id |
| `docs/arch-context.md` §4.33 | imageStorage.js 是唯一合法的 Storage 访问点 ⚠️ |
| `docs/coding-lessons.md` | 8 条编码规则 |
| `docs/superpowers/specs/2026-04-19-image-upload-design.md` | 完整功能 spec（必读） |

---

## 二、Task 0：数据库准备（手动在 Supabase 控制台操作）

代码 session 开始前，**用户需在 Supabase 控制台手动完成**：

### 2.1 新增 image_urls 字段

```sql
ALTER TABLE journal_entries
ADD COLUMN image_urls text[] DEFAULT '{}';
```

### 2.2 创建 Storage Bucket

- 进入 Supabase 控制台 → Storage → New Bucket
- Bucket 名：`journal-images`
- 设为 **Public**（允许直接读取 public URL）
- 添加 RLS Policy（仅允许已登录用户上传/删除自己目录下的文件）：

```sql
-- 上传（INSERT）
CREATE POLICY "用户可上传自己的图片"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'journal-images' AND (storage.foldername(name))[1] = auth.uid()::text);

-- 删除（DELETE）
CREATE POLICY "用户可删除自己的图片"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'journal-images' AND (storage.foldername(name))[1] = auth.uid()::text);

-- 读取（SELECT，public bucket 可省略，但写上更规范）
CREATE POLICY "任何人可读图片"
ON storage.objects FOR SELECT
USING (bucket_id = 'journal-images');
```

---

## 三、涉及文件

| 文件 | 操作 |
|---|---|
| `src/lib/imageStorage.js` | **新建**：Storage 抽象层 |
| `src/pages/HomePage.jsx` | **修改**：新增图片宫格 + 相机图标 + 上传/调序/删除逻辑 |
| `src/components/RecordDetail.jsx` | **修改**：原始记录流内插入图片宫格（只读） |
| `src/pages/RecordsPage.jsx` | **修改**：列表卡片新增缩略图 + 图片计数 |

---

## 四、imageStorage.js 完整接口规格

```js
// src/lib/imageStorage.js
import { db } from './db'

const BUCKET = 'journal-images'
const MAX_SIZE_BYTES = 500 * 1024   // 500 KB
const MAX_LONG_EDGE = 1600

export async function compressImage(file) {
  // 用 Canvas API 压缩
  // 1. 创建 Image 对象加载 file
  // 2. 计算缩放比例（长边不超过 MAX_LONG_EDGE）
  // 3. 用 canvas.toBlob('image/jpeg', quality) 输出
  // 4. quality 从 0.9 开始，每次降低 0.1，直到 size <= MAX_SIZE_BYTES 或 quality < 0.3
  // 返回 Blob
}

export async function uploadImage(file, userId, entryId) {
  // 1. const compressed = await compressImage(file)
  // 2. 路径：`${userId}/${entryId}/${Date.now()}_${file.name.replace(/\s/g,'_')}.jpg`
  // 3. const { error } = await db.storage.from(BUCKET).upload(path, compressed, { contentType: 'image/jpeg' })
  // 4. if (error) return null
  // 5. const { data } = db.storage.from(BUCKET).getPublicUrl(path)
  // 6. return data.publicUrl
}

export async function deleteImage(url) {
  // 从 url 解析 Storage 路径：截取 bucket 名之后的部分
  // 例：https://.../journal-images/abc/def/xxx.jpg → 'abc/def/xxx.jpg'
  // const { error } = await db.storage.from(BUCKET).remove([path])
}

export function getImageUrl(url) {
  // 当前直接返回 url（未来迁移本地存储时在此做路径映射）
  return url
}
```

---

## 五、HomePage.jsx 改动要点

### 5.1 新增 state

```js
const [imageUrls, setImageUrls] = useState([])
const [uploading, setUploading] = useState(false)
const [editingImages, setEditingImages] = useState(false)  // 长按进入编辑态
const [dragIndex, setDragIndex] = useState(null)           // 拖拽源索引
```

### 5.2 编辑记录时初始化 imageUrls

在现有 `loadDraft` 逻辑处（或 `editEntry` 传入时），读取 `entry.image_urls ?? []` 初始化 `imageUrls`。

### 5.3 相机图标 SVG（底部操作栏左侧）

```jsx
// 现有底部栏改为三控件
<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 14px 18px' }}>
  {/* 相机 - 左 */}
  <label style={{ cursor: 'pointer', opacity: uploading ? 0.5 : 1 }}>
    <input
      type="file" accept="image/*" multiple
      style={{ display: 'none' }}
      disabled={uploading || imageUrls.length >= MAX_IMAGES}
      onChange={handleImageSelect}
    />
    <svg width="22" height="18" viewBox="0 0 22 18" fill="none"
      stroke="#bbb" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="4" width="20" height="13" rx="2.5"/>
      <circle cx="11" cy="10.5" r="3.5"/>
      <path d="M7.5 4L8.8 1.5h4.4L14.5 4"/>
    </svg>
  </label>

  {/* 深入觉察 - 中 */}
  <button onClick={...} style={{ fontSize: 12, color: '#c9a96e', background: 'none', border: 'none' }}>
    ✦ 深入觉察
  </button>

  {/* 保存 - 右 */}
  <button onClick={handleSave} style={{ width: 34, height: 34, borderRadius: '50%', background: '#c9a96e', color: 'white', border: 'none', fontSize: 16 }}>✓</button>
</div>
```

### 5.4 handleImageSelect

```js
async function handleImageSelect(e) {
  const files = Array.from(e.target.files)
  if (!files.length) return
  const remaining = MAX_IMAGES - imageUrls.length
  const toUpload = files.slice(0, remaining)  // 超出上限截断
  setUploading(true)
  const urls = await Promise.all(
    toUpload.map(f => uploadImage(f, user.id, entryId))
  )
  setImageUrls(prev => [...prev, ...urls.filter(Boolean)])
  setUploading(false)
  e.target.value = ''  // 重置 input，允许重新选同一张图
}
```

### 5.5 图片宫格 JSX（有图片时渲染，位于文字输入区下方）

```jsx
{imageUrls.length > 0 && (
  <div
    style={{ padding: '4px 14px 2px' }}
    onClick={e => { if (e.target === e.currentTarget) setEditingImages(false) }}
  >
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: 3,
    }}>
      {imageUrls.map((url, i) => (
        <div
          key={url}
          style={{ aspectRatio: '1/1', borderRadius: 6, overflow: 'hidden', position: 'relative' }}
          draggable={editingImages}
          onDragStart={() => setDragIndex(i)}
          onDragOver={e => e.preventDefault()}
          onDrop={() => {
            if (dragIndex === null || dragIndex === i) return
            const next = [...imageUrls]
            const [moved] = next.splice(dragIndex, 1)
            next.splice(i, 0, moved)
            setImageUrls(next)
            setDragIndex(null)
          }}
          onTouchStart={() => {
            const t = setTimeout(() => setEditingImages(true), 500)
            // 松手时清除 timer（防止短按误触发）
            // 用 ref 存 timer id，onTouchEnd 清除
          }}
          onClick={() => {
            if (editingImages) return  // 编辑态下 onClick 不触发全屏
            // 触发全屏查看（简单实现：setFullscreenImg(url)）
          }}
        >
          <img src={getImageUrl(url)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          {editingImages && (
            <button
              onClick={async (e) => {
                e.stopPropagation()
                await deleteImage(url)
                setImageUrls(prev => prev.filter((_, idx) => idx !== i))
              }}
              style={{
                position: 'absolute', top: 4, right: 4,
                width: 18, height: 18, borderRadius: '50%',
                background: 'rgba(0,0,0,0.6)', color: 'white',
                border: 'none', fontSize: 11, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                lineHeight: 1,
              }}
            >✕</button>
          )}
        </div>
      ))}
      {imageUrls.length < MAX_IMAGES && !editingImages && (
        <label style={{
          aspectRatio: '1/1', borderRadius: 6,
          border: '1.5px dashed #c9a96e', background: 'none',
          color: '#c9a96e', fontSize: 20, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <input type="file" accept="image/*" multiple style={{ display: 'none' }}
            disabled={uploading} onChange={handleImageSelect} />
          ＋
        </label>
      )}
    </div>
    <div style={{ fontSize: 10, color: '#bbb', marginTop: 3 }}>
      长按拖动调序 · 最多{MAX_IMAGES}张
    </div>
  </div>
)}
```

### 5.6 保存时写入 image_urls

在现有保存逻辑中，追加 `image_urls: imageUrls` 字段。

---

## 六、RecordDetail.jsx 改动要点

**插入位置：** 原始记录流区块内，`raw_entry` 节点渲染之后、`local_prompt`/`ai_prompt` 渲染之前。

具体在 `RecordDetail.jsx` 第 1023–1032 行的 `raw_entry` case 内，`return` 前追加（或在 return 的 JSX 内 raw_entry div 后面紧跟图片宫格）：

```jsx
if (msg.nodeType === 'raw_entry') {
  return (
    <React.Fragment key={i}>
      <div style={{ fontSize: 14, color: '#2d2d2d', lineHeight: 1.85, marginBottom: 16, whiteSpace: 'pre-wrap' }}>
        {msg.content}
      </div>
      {/* 图片宫格（只在有图时渲染，只读） */}
      {(entry.image_urls ?? []).length > 0 && (
        <div style={{ marginBottom: 6 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 3 }}>
            {(entry.image_urls ?? []).map((url, idx) => (
              <div key={idx} style={{ aspectRatio: '1/1', borderRadius: 6, overflow: 'hidden' }}
                onClick={() => setFullscreenImg(url)}>
                <img src={getImageUrl(url)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
            ))}
          </div>
          <div style={{ fontSize: 10, color: '#bbb', marginTop: 3 }}>点击图片全屏查看</div>
        </div>
      )}
    </React.Fragment>
  )
}
```

**无 messages 时（`messages.length === 0`）：** 在 entry.content 文字 div 后面同样追加图片宫格。

**新增 fullscreenImg state：**

```js
const [fullscreenImg, setFullscreenImg] = useState(null)
```

全屏遮罩 JSX（放在组件 return 顶层）：

```jsx
{fullscreenImg && (
  <div
    onClick={() => setFullscreenImg(null)}
    style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)',
      zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}
  >
    <img src={fullscreenImg} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
  </div>
)}
```

**导入：**

```js
import { getImageUrl } from '../lib/imageStorage'
```

---

## 七、RecordsPage.jsx 改动要点

### 7.1 列表卡片新增缩略图

在现有卡片 JSX 中，有图片时在卡片右侧加缩略图：

```jsx
// 卡片右侧
{(entry.image_urls ?? []).length > 0 && (
  <img
    src={getImageUrl(entry.image_urls[0])}
    style={{ width: 56, height: 56, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }}
  />
)}
```

### 7.2 日期行追加图片计数

```jsx
// 日期行（已有 template_type、时间等字段之后追加）
{(entry.image_urls ?? []).length > 0 && (
  <>
    <svg width="11" height="9" viewBox="0 0 22 18" fill="none"
      stroke="#bbb" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      style={{ verticalAlign: 'middle' }}>
      <rect x="1" y="4" width="20" height="13" rx="2.5"/>
      <circle cx="11" cy="10.5" r="3.5"/>
      <path d="M7.5 4L8.8 1.5h4.4L14.5 4"/>
    </svg>
    <span style={{ color: '#bbb' }}>{entry.image_urls.length}</span>
  </>
)}
```

### 7.3 select 字段补充

RecordsPage 查询时的 `.select()` 需加入 `image_urls`：

```js
.select('id, content, entry_summary, created_at, emotions, emotion_display,
         category_tags, people_involved, core_needs, template_type, image_urls')
```

---

## 八、成功验收清单

1. 写作页底部相机图标可点击，弹出文件选择器
2. 选图后自动压缩（≤500KB）并上传，宫格出现缩略图
3. 最多5张，第6张无法添加（+ 格消失）
4. 长按进入编辑态：每张图右上角出现 ✕，可拖动调序
5. 编辑态点 ✕ 删除图片；点宫格外退出编辑态
6. 短按图片（非编辑态）进入全屏查看，点击关闭
7. 保存后：列表卡片右侧出现第一张缩略图 + 线条图标 + 数量
8. 进详情页：原始记录流 raw_entry 文字下方出现图片宫格
9. 详情页觉察对话（ai_prompt / ai_answer 流式文字）位置和样式不变
10. 编辑已有记录时，原有图片正确加载，可增删调序后保存
11. 不同屏幕宽度下始终三列

---

## 九、注意事项

- `imageStorage.js` 内部可以用 `db.storage`（因为它在 `lib/`），不要在 HomePage / RecordDetail 里直接调
- 上传是「选图即上传」，不等到 ✓ 保存才上传；保存时只写 `image_urls` 数组到数据库
- 删除图片时同时调 `deleteImage(url)` 清理 Storage，防止孤儿文件
- `entry.image_urls` 可能为 null（旧数据），读取时始终加 `?? []`
- RecordDetail 需要 `image_urls` 字段，确认 `select('*')` 已覆盖（现有代码第 143 行已用 `select('*')`，无需改动）
