# 图片上传功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 允许用户在写作时上传最多5张图片，关联到日记条目，在记录列表卡片和详情页展示。

**Architecture:** 图片通过 imageStorage.js 抽象层访问 Supabase Storage，DB 只存 Storage 路径（不存 URL）。新建日记采用"延迟上传"：先保存文字拿到 entry_id（客户端 UUID），跳转后后台上传图片，再写回 image_urls 字段。写作页用 @dnd-kit/sortable 支持移动端拖拽调序。上传失败通过 MainLayout 层的 Toast（即时）和 localStorage Banner（跨会话）双层通知用户。

**Tech Stack:** React 19, Supabase Storage, @dnd-kit/core + @dnd-kit/sortable + @dnd-kit/utilities, Canvas API（压缩，无额外依赖）

---

## 文件结构

| 文件 | 操作 | 职责 |
|---|---|---|
| `src/lib/imageStorage.js` | **新建** | Storage 唯一访问点：compress / upload / delete / getUrl |
| `src/lib/db.js` | **修改** | 新增 `storage: supabase.storage` 属性 |
| `src/components/MainLayout.jsx` | **修改** | 新增 Toast 状态 + `notify()` 函数，传给 HomePage |
| `src/pages/HomePage.jsx` | **修改** | 相机图标、图片宫格、延迟上传逻辑 |
| `src/components/RecordDetail.jsx` | **修改** | raw_entry 下方只读图片宫格 + 全屏查看 |
| `src/pages/RecordsPage.jsx` | **修改** | select 补 image_urls，EntryCard 缩略图 + SVG 图标 |
| `src/pages/EditEntryPage.jsx` | **修改** | 编辑时加载 / 增删图片，保存时上传新图并写回 |

---

## Task 0：数据库手动准备（用户在 Supabase 控制台操作）

> ⚠️ 这一步由用户在浏览器完成，不写代码。完成后告知 AI 继续。

- [ ] **Step 1：新增 image_urls 字段**

进入 Supabase 控制台 → SQL Editor，运行：

```sql
ALTER TABLE journal_entries
ADD COLUMN image_urls text[] DEFAULT '{}';
```

- [ ] **Step 2：创建 Storage Bucket**

进入 Supabase 控制台 → Storage → New Bucket：
- Bucket 名：`journal-images`
- 勾选 **Public**

- [ ] **Step 3：添加 RLS Policy**

在 SQL Editor 运行：

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

-- 读取（SELECT）
CREATE POLICY "任何人可读图片"
ON storage.objects FOR SELECT
USING (bucket_id = 'journal-images');
```

---

## Task 1：imageStorage.js + db.js storage 接缝

**Files:**
- Create: `src/lib/imageStorage.js`
- Modify: `src/lib/db.js`

- [ ] **Step 1：在 db.js 暴露 storage 属性**

读 `src/lib/db.js`（27行），在 `db` 对象末尾追加 `storage`：

```js
// src/lib/db.js
import { supabase } from './supabase'

export const db = {
  // 表操作（目前透传 Supabase，将来可换实现）
  from: (table) => supabase.from(table),

  // Auth（统一入口，避免组件直接依赖 supabase）
  auth: supabase.auth,

  // RPC 调用
  rpc: (fn, args) => supabase.rpc(fn, args),

  // Storage（imageStorage.js 是唯一合法调用点，不要在 UI 组件里直接用）
  storage: supabase.storage,
}
```

- [ ] **Step 2：新建 imageStorage.js**

```js
// src/lib/imageStorage.js
// Storage 抽象层：所有图片操作的唯一入口
// 未来迁移本地存储只改这一个文件
import { db } from './db'

const BUCKET = 'journal-images'
const MAX_SIZE_BYTES = 500 * 1024  // 500 KB
const MAX_LONG_EDGE = 1600

// ── 压缩图片 ────────────────────────────────────────────────────
// 返回 Blob（JPEG，≤500KB，长边≤1600px）
export async function compressImage(file) {
  return new Promise((resolve) => {
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(objectUrl)
      let { width, height } = img

      // 缩放：长边不超过 MAX_LONG_EDGE
      if (Math.max(width, height) > MAX_LONG_EDGE) {
        const ratio = MAX_LONG_EDGE / Math.max(width, height)
        width = Math.round(width * ratio)
        height = Math.round(height * ratio)
      }

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d').drawImage(img, 0, 0, width, height)

      // quality 从 0.9 逐步降低，直到满足大小要求或低于 0.3
      let quality = 0.9
      function tryCompress() {
        canvas.toBlob((blob) => {
          if (!blob) { resolve(null); return }
          if (blob.size <= MAX_SIZE_BYTES || quality <= 0.3) {
            resolve(blob)
          } else {
            quality = Math.round((quality - 0.1) * 10) / 10
            tryCompress()
          }
        }, 'image/jpeg', quality)
      }
      tryCompress()
    }
    img.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(null) }
    img.src = objectUrl
  })
}

// ── 上传图片 ─────────────────────────────────────────────────────
// 返回 Storage 路径（失败返回 null）
// 调用方负责：过滤 null、通知用户失败、写 localStorage 标记
export async function uploadImage(file, userId, entryId) {
  try {
    const blob = await compressImage(file)
    if (!blob) return null

    const safeName = file.name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '')
    const path = `${userId}/${entryId}/${Date.now()}_${safeName || 'image'}`

    const { error } = await db.storage.from(BUCKET).upload(path, blob, {
      contentType: 'image/jpeg',
    })
    if (error) { console.error('[uploadImage]', error); return null }

    return path
  } catch (err) {
    console.error('[uploadImage]', err)
    return null
  }
}

// ── 删除图片 ─────────────────────────────────────────────────────
// storagePath：image_urls 中存的路径字符串（不是完整 URL）
// 失败时 console.error，不抛异常
export async function deleteImage(storagePath) {
  if (!storagePath) return
  const { error } = await db.storage.from(BUCKET).remove([storagePath])
  if (error) console.error('[deleteImage]', error)
}

// ── 路径 → 完整 URL ──────────────────────────────────────────────
// 这是唯一知道 Supabase public URL 格式的地方
// 未来迁移本地存储只改这一个函数
export function getImageUrl(storagePath) {
  if (!storagePath) return ''
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  return `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${storagePath}`
}
```

- [ ] **Step 3：构建验证**

```bash
npm run build
```

期望：编译通过，无 error。

- [ ] **Step 4：Commit**

```bash
git add src/lib/db.js src/lib/imageStorage.js
git commit -m "feat: imageStorage.js 抽象层 + db.storage 接缝"
```

---

## Task 2：MainLayout 全局 Toast 通知

**Files:**
- Modify: `src/components/MainLayout.jsx:27-37`（state 区）和渲染区

目标：在 MainLayout 添加 `toast` state 和 `notify()` 函数，渲染 Toast 浮层，并通过 `onNotify` prop 传给 HomePage。

- [ ] **Step 1：在 MainLayout 添加 toast state 和 notify 函数**

在 `src/components/MainLayout.jsx` 第 34 行（`const [refreshKey, setRefreshKey] = useState(0)` 附近）插入：

```js
  const [toast, setToast] = useState(null)
  const toastTimerRef = useRef(null)

  function notify(msg) {
    clearTimeout(toastTimerRef.current)
    setToast(msg)
    toastTimerRef.current = setTimeout(() => setToast(null), 3500)
  }
```

并在 `useState` 行之前的 import 中加入 `useRef`（当前已有 `useState, useEffect`，补充 `useRef`）：

```js
import { useState, useEffect, useRef } from 'react'
```

- [ ] **Step 2：在 MainLayout JSX 顶层渲染 Toast**

在 `src/components/MainLayout.jsx` 最外层 `<div>` 内、主内容区 `<div style={{ flex: 1, overflow: 'hidden' ...` 之前插入：

```jsx
      {/* 全局 Toast 通知（图片上传失败等异步事件触发） */}
      {toast && (
        <div style={{
          position: 'fixed',
          top: 56,
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.72)',
          color: 'white',
          padding: '8px 18px',
          borderRadius: 20,
          fontSize: 13,
          zIndex: 999,
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
        }}>
          {toast}
        </div>
      )}
```

- [ ] **Step 3：把 onNotify 传给所有 HomePage 实例**

MainLayout.jsx 中有两处渲染 HomePage（第 296 行 Tab 渲染 + 第 231 行 editHome screen）。两处都加 `onNotify={notify}` prop：

```jsx
{/* Tab write 渲染（约第 295 行） */}
<HomePage key={writeResetKey} onDone={handleHomeSaved} onOpenLetter={...} onNotify={notify} />

{/* editHome screen 渲染（约第 231 行） */}
<HomePage
  editEntry={screen.entry}
  onDone={handleEditHomeDone}
  onCancel={() => { reset(); goTab('records') }}
  onOpenLetter={letter => push({ type: 'letter', letter })}
  onNotify={notify}
/>
```

- [ ] **Step 4：构建验证**

```bash
npm run build
```

期望：编译通过，无 error。

- [ ] **Step 5：Commit**

```bash
git add src/components/MainLayout.jsx
git commit -m "feat: MainLayout 全局 Toast 通知机制"
```

---

---

## Task 3：HomePage 图片上传功能

**Files:**
- Modify: `src/pages/HomePage.jsx`

安装 @dnd-kit（触屏兼容拖拽库），给写作页加相机图标、图片宫格、延迟上传逻辑。

- [ ] **Step 1：安装 @dnd-kit**

```bash
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

期望：`package.json` dependencies 中出现三个 `@dnd-kit/*` 包。

- [ ] **Step 2：在 HomePage.jsx 顶部补充 import**

在现有 import 区（第 18-28 行）末尾追加：

```js
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { uploadImage, deleteImage, getImageUrl } from '../lib/imageStorage'
```

- [ ] **Step 3：定义 SortableImageItem 组件**

在 `clearDraft` 函数（第 65-67 行）之后、`export default function HomePage` 之前，插入组件定义：

```js
// ─── 图片宫格单项（支持拖拽） ─────────────────────────────────────
// 必须定义在模块顶层，不能放 HomePage 函数体内（re-render 会重建组件类型）
function SortableImageItem({ id, previewSrc, editingImages, onDelete, onFullscreen }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style = {
    aspectRatio: '1/1',
    borderRadius: 6,
    overflow: 'hidden',
    position: 'relative',
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.7 : 1,
    cursor: editingImages ? 'grab' : 'pointer',
    touchAction: editingImages ? 'none' : 'auto',
  }
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(editingImages ? { ...attributes, ...listeners } : {})}
      onClick={() => { if (!editingImages) onFullscreen() }}
    >
      <img src={previewSrc} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      {editingImages && (
        <button
          onPointerDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); onDelete() }}
          style={{
            position: 'absolute', top: 4, right: 4,
            width: 18, height: 18, borderRadius: '50%',
            background: 'rgba(0,0,0,0.6)', color: 'white',
            border: 'none', fontSize: 11, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            lineHeight: 1, zIndex: 1,
          }}
        >✕</button>
      )}
    </div>
  )
}
```

- [ ] **Step 4：在 HomePage 函数内添加图片相关 state**

在 `const [saving, setSaving] = useState(false)` 行（第 117 行）之后插入：

```js
  // ── 图片上传 ────────────────────────────────────────────────────
  const MAX_IMAGES = 5
  // selectedFiles：新选的 File 对象（新建/编辑时新增的图片，未上传）
  // selectedPreviews：与 selectedFiles 一一对应的 ObjectURL（用于本地预览）
  // imagePaths：编辑已有记录时从 entry.image_urls 初始化的 Storage 路径
  const [selectedFiles, setSelectedFiles] = useState([])
  const [selectedPreviews, setSelectedPreviews] = useState([])
  const [imagePaths, setImagePaths] = useState(
    editEntry?.image_urls ?? []
  )
  const [uploading, setUploading] = useState(false)
  const [editingImages, setEditingImages] = useState(false)
  const [fullscreenSrc, setFullscreenSrc] = useState(null)
  const touchTimerRef = useRef(null)

  // 所有图片数量（已有路径 + 本次新选）
  const totalImages = imagePaths.length + selectedFiles.length

  // 合并展示列表：{ id, previewSrc, type: 'path'|'file', fileIndex? }
  const imageItems = [
    ...imagePaths.map(p => ({ id: p, previewSrc: getImageUrl(p), type: 'path' })),
    ...selectedPreviews.map((src, i) => ({ id: `new-${i}`, previewSrc: src, type: 'file', fileIndex: i })),
  ]
```

- [ ] **Step 5：编辑模式退出时清理 ObjectURL**

在现有 `useEffect(() => () => { if (letterReadTimer) clearTimeout(letterReadTimer) }, [letterReadTimer])` 行之后插入：

```js
  // 组件卸载时释放 ObjectURL，防止内存泄漏
  useEffect(() => {
    return () => { selectedPreviews.forEach(url => URL.revokeObjectURL(url)) }
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 6：添加图片操作函数**

在 `handleDeepAwareness` 函数（第 338 行）之后插入：

```js
  // ── 图片选择 ──────────────────────────────────────────────────
  const handleImageSelect = (e) => {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    const remaining = MAX_IMAGES - totalImages
    const toAdd = files.slice(0, remaining)
    const newPreviews = toAdd.map(f => URL.createObjectURL(f))
    setSelectedFiles(prev => [...prev, ...toAdd])
    setSelectedPreviews(prev => [...prev, ...newPreviews])
    e.target.value = ''
  }

  // ── 删除图片 ──────────────────────────────────────────────────
  const handleDeleteImage = async (item) => {
    if (item.type === 'path') {
      await deleteImage(item.id)
      setImagePaths(prev => prev.filter(p => p !== item.id))
    } else {
      const idx = item.fileIndex
      URL.revokeObjectURL(selectedPreviews[idx])
      setSelectedFiles(prev => prev.filter((_, i) => i !== idx))
      setSelectedPreviews(prev => prev.filter((_, i) => i !== idx))
    }
  }

  // ── 拖拽调序 ─────────────────────────────────────────────────
  const handleDragEnd = (event) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = imageItems.findIndex(item => item.id === active.id)
    const newIndex = imageItems.findIndex(item => item.id === over.id)
    const reordered = arrayMove(imageItems, oldIndex, newIndex)
    const newPaths = reordered.filter(it => it.type === 'path').map(it => it.id)
    const newFileOrder = reordered.filter(it => it.type === 'file').map(it => it.fileIndex)
    setImagePaths(newPaths)
    setSelectedFiles(prev => newFileOrder.map(i => prev[i]))
    setSelectedPreviews(prev => newFileOrder.map(i => prev[i]))
  }

  // ── 长按进入编辑态 ────────────────────────────────────────────
  const handleImageTouchStart = () => {
    touchTimerRef.current = setTimeout(() => setEditingImages(true), 500)
  }
  const handleImageTouchEnd = () => { clearTimeout(touchTimerRef.current) }

  // ── @dnd-kit sensors ──────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } })
  )
```

- [ ] **Step 7：修改 handleDone 加入延迟上传**

将现有 `handleDone`（第 292-335 行）替换为以下版本（新增图片逻辑，文字部分不变）：

```js
  const handleDone = useCallback(async () => {
    if (!content.trim() || saving) return
    setSaving(true)

    const trimmed = content.trim()
    const autoDetected = detectPeopleFromText(trimmed, contacts)
    const allPeople = [...new Set([...selectedPeople, ...autoDetected])]
      .filter(p => !dismissedPeople.has(p))

    if (isEditMode) {
      const fields = {
        content: trimmed,
        template_type: template.id,
        people_involved: allPeople,
        image_urls: imagePaths,
      }
      const updatedEntry = { ...editEntry, ...fields }
      onDone?.(updatedEntry, false)

      const entryId = editEntry.id
      const userId = user.id
      const filesToUpload = [...selectedFiles]
      const existingPaths = [...imagePaths]
      const notifyFn = onNotify

      updateEntry({ id: entryId, userId, fields })
        .then(async ({ error }) => {
          if (error) { console.error('[edit]', error); return }
          if (!filesToUpload.length) return
          const newPaths = await Promise.all(
            filesToUpload.map(f => uploadImage(f, userId, entryId))
          )
          const successPaths = newPaths.filter(Boolean)
          const failedCount = newPaths.length - successPaths.length
          if (successPaths.length > 0) {
            await updateEntry({
              id: entryId, userId,
              fields: { image_urls: [...existingPaths, ...successPaths] },
            })
          }
          if (failedCount > 0) notifyFn?.('图片上传失败，进入记录可重新添加')
        })
        .catch(console.error)
      return
    }

    // 新建模式：乐观插入
    const optimisticEntry = {
      id: crypto.randomUUID(),
      user_id: user.id,
      content: trimmed,
      template_type: template.id,
      created_at: selectedDatetime.toISOString(),
      people_involved: allPeople,
    }

    clearDraft()
    const gotoAwareness = template.awarenessStart !== null
    setSaving(false)
    onDone?.(optimisticEntry, gotoAwareness)

    const entryId = optimisticEntry.id
    const userId = user.id
    const filesToUpload = [...selectedFiles]
    const notifyFn = onNotify

    insertEntry(optimisticEntry)
      .then(({ error }) => { if (error) console.error('[insert]', error) })

    if (filesToUpload.length > 0) {
      ;(async () => {
        const paths = await Promise.all(
          filesToUpload.map(f => uploadImage(f, userId, entryId))
        )
        const successPaths = paths.filter(Boolean)
        const failedCount = paths.length - successPaths.length
        if (successPaths.length > 0) {
          await updateEntry({ id: entryId, userId, fields: { image_urls: successPaths } })
        }
        if (failedCount > 0) {
          notifyFn?.('图片上传失败，进入记录可重新添加')
          try {
            const failed = JSON.parse(localStorage.getItem('image_upload_failed') ?? '[]')
            failed.push({ entryId, createdAt: Date.now() })
            localStorage.setItem('image_upload_failed', JSON.stringify(failed))
          } catch (_) {}
        }
      })()
    }
  }, [content, saving, isEditMode, template, editEntry, user, onDone, contacts,
      selectedPeople, dismissedPeople, selectedDatetime, imagePaths, selectedFiles, onNotify])
```

- [ ] **Step 8：修改 HomePage 函数签名接收 onNotify**

将第 70 行改为：

```js
export default function HomePage({ onDone, editEntry, onCancel, onOpenLetter, onNotify }) {
```

- [ ] **Step 9：在底部操作栏最左侧加相机图标**

在现有底部浮动栏 `<div className="flex items-center gap-2">` 之后（第 597 行）、`{/* 左：✦ 深入觉察 */}` 之前插入：

```jsx
          {/* 最左：相机图标 */}
          <label
            style={{
              cursor: totalImages >= MAX_IMAGES ? 'not-allowed' : 'pointer',
              opacity: uploading || totalImages >= MAX_IMAGES ? 0.4 : 1,
              flexShrink: 0,
            }}
          >
            <input
              type="file" accept="image/*" multiple
              style={{ display: 'none' }}
              disabled={uploading || totalImages >= MAX_IMAGES}
              onChange={handleImageSelect}
            />
            <svg width="22" height="18" viewBox="0 0 22 18" fill="none"
              stroke="#bbb" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1" y="4" width="20" height="13" rx="2.5"/>
              <circle cx="11" cy="10.5" r="3.5"/>
              <path d="M7.5 4L8.8 1.5h4.4L14.5 4"/>
            </svg>
          </label>
```

- [ ] **Step 10：在输入区与底部浮动栏之间插入图片宫格 JSX**

在输入区容器 `</div>`（第 586 行 relative 容器结束）之后、底部浮动栏 `<div className="absolute ...">` 之前插入：

```jsx
      {/* ── 图片宫格（有图时渲染） ── */}
      {imageItems.length > 0 && (
        <div
          style={{ padding: '4px 18px 2px' }}
          onTouchStart={handleImageTouchStart}
          onTouchEnd={handleImageTouchEnd}
          onMouseLeave={() => clearTimeout(touchTimerRef.current)}
          onClick={e => { if (e.target === e.currentTarget) setEditingImages(false) }}
        >
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={imageItems.map(it => it.id)} strategy={rectSortingStrategy}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 3 }}>
                {imageItems.map(item => (
                  <SortableImageItem
                    key={item.id}
                    id={item.id}
                    previewSrc={item.previewSrc}
                    editingImages={editingImages}
                    onDelete={() => handleDeleteImage(item)}
                    onFullscreen={() => setFullscreenSrc(item.previewSrc)}
                  />
                ))}
                {totalImages < MAX_IMAGES && !editingImages && (
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
            </SortableContext>
          </DndContext>
          <div style={{ fontSize: 10, color: '#bbb', marginTop: 3 }}>
            长按拖动调序 · 最多{MAX_IMAGES}张
          </div>
        </div>
      )}

      {/* ── 全屏图片查看 ── */}
      {fullscreenSrc && (
        <div
          onClick={() => setFullscreenSrc(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)',
            zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <img src={fullscreenSrc} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
        </div>
      )}
```

- [ ] **Step 11：构建验证**

```bash
npm run build
```

期望：编译通过，无 error。

- [ ] **Step 12：本地验证清单**

```bash
npm run dev
```

手动验证：
1. 写作页底部左侧出现相机 SVG 图标
2. 点击相机图标，弹出系统文件选择器
3. 选 1 张图 → 宫格出现缩略图
4. 选满 5 张 → ＋ 格消失，相机图标变灰
5. 长按图片 500ms → 右上角出现 ✕ 按钮
6. 编辑态点 ✕ → 图片消失
7. 短按图片（非编辑态）→ 全屏查看，点击关闭
8. 点 ✓ 保存 → 立即跳转，console 无 error

- [ ] **Step 13：Commit**

```bash
git add src/pages/HomePage.jsx package.json package-lock.json
git commit -m "feat: 写作页图片上传（相机入口 + 宫格 + @dnd-kit 拖拽 + 延迟上传）"
```

---

## Task 4：RecordDetail 只读图片宫格

**Files:**
- Modify: `src/components/RecordDetail.jsx`

在原始记录流的 raw_entry 文字正下方插入只读图片宫格（不可调序、不可删除）。

- [ ] **Step 1：在 RecordDetail.jsx 顶部追加 import**

在第 13 行（`import DatetimePicker from './DatetimePicker'`）之后追加：

```js
import { getImageUrl } from '../lib/imageStorage'
```

- [ ] **Step 2：添加 fullscreenImg state**

在 RecordDetail 函数内，现有 `const [saving, setSaving] = useState(false)` 附近（或找到现有 state 区），插入：

```js
  const [fullscreenImg, setFullscreenImg] = useState(null)
```

- [ ] **Step 3：在 raw_entry 渲染后插入图片宫格（有觉察对话时）**

找到第 1023-1032 行的 `if (msg.nodeType === 'raw_entry')` 分支，将其返回值从：

```jsx
              if (msg.nodeType === 'raw_entry') {
                return (
                  <div key={i} style={{
                    fontSize: 14, color: '#2d2d2d',
                    lineHeight: 1.85, marginBottom: 20,
                    whiteSpace: 'pre-wrap',
                  }}>
                    {msg.content}
                  </div>
                )
              }
```

替换为：

```jsx
              if (msg.nodeType === 'raw_entry') {
                const imgs = entry.image_urls ?? []
                return (
                  <React.Fragment key={i}>
                    <div style={{
                      fontSize: 14, color: '#2d2d2d',
                      lineHeight: 1.85, marginBottom: imgs.length > 0 ? 8 : 20,
                      whiteSpace: 'pre-wrap',
                    }}>
                      {msg.content}
                    </div>
                    {imgs.length > 0 && (
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 3 }}>
                          {imgs.map((path, idx) => (
                            <div
                              key={idx}
                              style={{ aspectRatio: '1/1', borderRadius: 6, overflow: 'hidden', cursor: 'pointer' }}
                              onClick={() => setFullscreenImg(getImageUrl(path))}
                            >
                              <img src={getImageUrl(path)} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
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

> ⚠️ `React.Fragment` 需要 React 已 import。检查第 1 行是否有 `import React from 'react'` 或 `import { ..., Fragment } from 'react'`。若没有，在 import 区添加 `import React from 'react'`。

- [ ] **Step 4：在无觉察对话时（messages.length === 0）的文字下方也加图片宫格**

找到第 1015-1019 行的 `messages.length === 0` 分支：

```jsx
          {messages.length === 0 ? (
            /* 没有觉察对话时，只展示原始日记文字 */
            <div style={{ fontSize: 14, color: '#2d2d2d', lineHeight: 1.85, whiteSpace: 'pre-wrap' }}>
              {entry.content}
            </div>
          ) : (
```

替换为：

```jsx
          {messages.length === 0 ? (
            <React.Fragment>
              <div style={{ fontSize: 14, color: '#2d2d2d', lineHeight: 1.85, whiteSpace: 'pre-wrap',
                marginBottom: (entry.image_urls ?? []).length > 0 ? 8 : 0 }}>
                {entry.content}
              </div>
              {(entry.image_urls ?? []).length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 3 }}>
                    {(entry.image_urls ?? []).map((path, idx) => (
                      <div
                        key={idx}
                        style={{ aspectRatio: '1/1', borderRadius: 6, overflow: 'hidden', cursor: 'pointer' }}
                        onClick={() => setFullscreenImg(getImageUrl(path))}
                      >
                        <img src={getImageUrl(path)} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 10, color: '#bbb', marginTop: 3 }}>点击图片全屏查看</div>
                </div>
              )}
            </React.Fragment>
          ) : (
```

- [ ] **Step 5：在 RecordDetail return 顶层加全屏遮罩**

在 RecordDetail 的 return 最外层 `<div>` 内第一个子元素之前插入：

```jsx
      {/* 全屏图片查看 */}
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

- [ ] **Step 6：构建验证**

```bash
npm run build
```

期望：编译通过，无 error。

- [ ] **Step 7：本地验证清单**

```bash
npm run dev
```

手动验证：
1. 打开一条有图片的日记详情页（需先在写作页保存并等待上传完成）
2. 原始记录流区块：raw_entry 文字下方出现图片宫格
3. 点击图片 → 全屏查看，点击关闭
4. 觉察对话（ai_prompt / ai_answer）位置和样式完全不变
5. 无图片的日记详情页：layout 不变，无空白区域

- [ ] **Step 8：Commit**

```bash
git add src/components/RecordDetail.jsx
git commit -m "feat: 详情页原始记录流内插入只读图片宫格"
```

---

## Task 5：RecordsPage 列表卡片缩略图 + 图片计数

**Files:**
- Modify: `src/pages/RecordsPage.jsx`

在列表卡片右侧加第一张图片的缩略图，日期行加 SVG 相机图标 + 数量，同时在 RecordsPage 挂载时检查 `image_upload_failed` Banner。

- [ ] **Step 1：在 RecordsPage.jsx 顶部追加 import**

在第 8 行（`import { resolveTemplate } from '../lib/templates'`）之后追加：

```js
import { getImageUrl } from '../lib/imageStorage'
```

- [ ] **Step 2：在 RecordsPage load 函数中把 image_urls 加入 select**

找到第 195-199 行的 select 查询（load 函数内）：

```js
      db.from('journal_entries')
        .select('id, content, template_type, created_at, emotion_display, emotions, emotion_confidence')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .range(0, ENTRY_PAGE - 1),
```

替换为：

```js
      db.from('journal_entries')
        .select('id, content, template_type, created_at, emotion_display, emotions, emotion_confidence, image_urls')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .range(0, ENTRY_PAGE - 1),
```

- [ ] **Step 3：同样修改 loadMoreEntries 的 select**

找到第 230-231 行的 loadMoreEntries select：

```js
      .select('id, content, template_type, created_at, emotion_display, emotions, emotion_confidence')
```

替换为：

```js
      .select('id, content, template_type, created_at, emotion_display, emotions, emotion_confidence, image_urls')
```

- [ ] **Step 4：修改 EntryCard 组件，加缩略图和图标**

找到 `function EntryCard({ entry, onOpen, onLongPress })` 组件（第 33 行）。将最外层 return 的 `<div>`（卡片容器，第 58 行）内的结构修改：

在现有 `<div>` 第一行（时间行+模板行）改成 `display: flex` 布局，右侧加缩略图：

将第 58-103 行的 return JSX 替换为：

```jsx
  return (
    <div
      onClick={handleClick}
      onMouseDown={startPress}
      onMouseUp={cancelPress}
      onMouseLeave={cancelPress}
      onTouchStart={startPress}
      onTouchEnd={cancelPress}
      onTouchMove={cancelPress}
      style={{
        background: 'white', borderRadius: 12, padding: '12px 14px',
        marginBottom: 8, cursor: 'pointer',
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        WebkitUserSelect: 'none', userSelect: 'none',
        display: 'flex', gap: 10, alignItems: 'flex-start',
      }}
    >
      {/* 左侧：文字内容 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between',
          alignItems: 'center', marginBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 10, color: tpl.color, fontWeight: 500 }}>
              {tpl.label}
            </span>
            <span style={{ fontSize: 10, color: '#ccc' }}>{formatTime(entry.created_at)}</span>
            {/* 图片计数（有图时显示） */}
            {(entry.image_urls ?? []).length > 0 && (
              <>
                <span style={{ fontSize: 10, color: '#ddd' }}>·</span>
                <svg width="11" height="9" viewBox="0 0 22 18" fill="none"
                  stroke="#bbb" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
                  style={{ verticalAlign: 'middle' }}>
                  <rect x="1" y="4" width="20" height="13" rx="2.5"/>
                  <circle cx="11" cy="10.5" r="3.5"/>
                  <path d="M7.5 4L8.8 1.5h4.4L14.5 4"/>
                </svg>
                <span style={{ fontSize: 10, color: '#bbb' }}>{entry.image_urls.length}</span>
              </>
            )}
          </div>
        </div>
        <div style={{
          fontSize: 13, color: '#555', lineHeight: 1.6,
          marginBottom: emotions.length ? 8 : 0,
          display: '-webkit-box', WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {preview}
        </div>
        {emotions.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {emotions.slice(0, 3).map(w => (
              <span key={w} style={{
                fontSize: 10, background: '#f0ece4', color: '#8a7a6a',
                padding: '2px 7px', borderRadius: 10,
              }}>{w}</span>
            ))}
            {emotions.length > 3 && (
              <span style={{ fontSize: 10, color: '#bbb' }}>…</span>
            )}
          </div>
        )}
      </div>

      {/* 右侧：缩略图（有图时显示） */}
      {(entry.image_urls ?? []).length > 0 && (
        <img
          src={getImageUrl(entry.image_urls[0])}
          style={{ width: 56, height: 56, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }}
          alt=""
        />
      )}
    </div>
  )
```

- [ ] **Step 5：在 RecordsPage 挂载时检查 image_upload_failed Banner**

在 RecordsPage 函数内 state 区末尾（`const [confirmDelete, setConfirmDelete] = useState(false)` 之后）加：

```js
  const [uploadFailedBanner, setUploadFailedBanner] = useState(false)
  const [uploadFailedCount, setUploadFailedCount] = useState(0)
```

在 `useEffect(() => { load() }, [load])` 行之后插入：

```js
  // 检查跨会话图片上传失败标记
  useEffect(() => {
    try {
      const failed = JSON.parse(localStorage.getItem('image_upload_failed') ?? '[]')
      if (failed.length > 0) {
        setUploadFailedCount(failed.length)
        setUploadFailedBanner(true)
      }
    } catch (_) {}
  }, [])
```

- [ ] **Step 6：渲染上传失败 Banner**

在 RecordsPage 的 return JSX 顶部（搜索框 FilterBar 之前）插入：

```jsx
      {/* 图片上传失败 Banner（跨会话持久化） */}
      {uploadFailedBanner && (
        <div style={{
          background: '#fff8f0', border: '1px solid #f0d8b8',
          borderRadius: 10, margin: '8px 14px 0',
          padding: '10px 14px', display: 'flex',
          justifyContent: 'space-between', alignItems: 'center',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 12, color: '#a07040' }}>
            有{uploadFailedCount > 1 ? ` ${uploadFailedCount} 条` : ''}图片上传失败，进入记录重新添加
          </span>
          <button
            onClick={() => {
              localStorage.removeItem('image_upload_failed')
              setUploadFailedBanner(false)
            }}
            style={{ background: 'none', border: 'none', color: '#bbb', fontSize: 16, cursor: 'pointer', padding: '0 4px' }}
          >✕</button>
        </div>
      )}
```

- [ ] **Step 7：构建验证**

```bash
npm run build
```

期望：编译通过，无 error。

- [ ] **Step 8：本地验证清单**

```bash
npm run dev
```

手动验证：
1. 记录列表页，有图片的条目右侧出现 56×56 缩略图
2. 日期行时间后出现 SVG 相机图标 + 数量
3. 无图片的条目：布局不变，无缩略图
4. 在 localStorage 手动设置 `image_upload_failed` 后刷新页面，出现黄色 Banner
5. 点 ✕ 关闭 Banner → localStorage 清除

- [ ] **Step 9：Commit**

```bash
git add src/pages/RecordsPage.jsx
git commit -m "feat: 列表卡片缩略图 + SVG 图标计数 + 上传失败 Banner"
```

---

## Task 6：EditEntryPage 图片编辑

**Files:**
- Modify: `src/pages/EditEntryPage.jsx`

在编辑页加载已有图片，支持删除（实时）和新增（保存时上传），保存时写回最终 image_urls。

- [ ] **Step 1：在 EditEntryPage.jsx 顶部追加 import**

在第 8 行（`import { updateEntry } from '../lib/journalService'`）之后追加：

```js
import { uploadImage, deleteImage, getImageUrl } from '../lib/imageStorage'
```

- [ ] **Step 2：在 EditEntryPage 函数内添加图片 state**

在 `const [saving, setSaving] = useState(false)` 行之后插入：

```js
  // 图片：已有路径（从 entry.image_urls 初始化） + 新选文件
  const [imagePaths, setImagePaths] = useState(entry.image_urls ?? [])
  const [newFiles, setNewFiles] = useState([])
  const [newPreviews, setNewPreviews] = useState([])
  const [fullscreenImg, setFullscreenImg] = useState(null)
  const MAX_IMAGES = 5
  const totalImages = imagePaths.length + newFiles.length
```

- [ ] **Step 3：添加图片操作函数**

在 `handleSave` 函数（第 78 行）之前插入：

```js
  // 删除已有图片（实时删除 Storage，不等保存）
  async function handleDeleteExisting(path) {
    await deleteImage(path)
    setImagePaths(prev => prev.filter(p => p !== path))
  }

  // 删除新选图片（释放 ObjectURL）
  function handleDeleteNew(idx) {
    URL.revokeObjectURL(newPreviews[idx])
    setNewFiles(prev => prev.filter((_, i) => i !== idx))
    setNewPreviews(prev => prev.filter((_, i) => i !== idx))
  }

  // 选择新图片
  function handleImageSelect(e) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    const remaining = MAX_IMAGES - totalImages
    const toAdd = files.slice(0, remaining)
    const previews = toAdd.map(f => URL.createObjectURL(f))
    setNewFiles(prev => [...prev, ...toAdd])
    setNewPreviews(prev => [...prev, ...previews])
    e.target.value = ''
  }
```

- [ ] **Step 4：修改 handleSave 函数，上传新图并写回 image_urls**

将现有 `handleSave`（第 78-117 行）替换为（在原有逻辑末尾增加图片处理）：

```js
  async function handleSave() {
    if (saving) return
    setSaving(true)

    const hasFlow = messages && messages.length > 0

    if (!hasFlow) {
      const newContent = (contentMap['__raw__'] ?? '').trim()
      await updateEntry({ id: entry.id, userId: user.id, fields: { content: newContent } })
    } else {
      const updatedMessages = messages.map(msg => {
        if (msg.id in contentMap) return { ...msg, content: contentMap[msg.id] }
        return msg
      })
      const rawMsg = updatedMessages.find(m => m.nodeType === 'raw_entry')
      const newContent = (rawMsg?.content ?? entry.content ?? '').trim()
      await Promise.all([
        updateEntry({ id: entry.id, userId: user.id, fields: { content: newContent } }),
        db.from('conversations').upsert(
          { user_id: user.id, entry_id: entry.id, context_type: 'entry',
            messages: updatedMessages, updated_at: new Date().toISOString() },
          { onConflict: 'entry_id,context_type' }
        ),
      ])
    }

    // 上传新图片，写回 image_urls（无论有无变化都写回，保证删除操作生效）
    const uploadedPaths = newFiles.length > 0
      ? (await Promise.all(newFiles.map(f => uploadImage(f, user.id, entry.id)))).filter(Boolean)
      : []
    const finalPaths = [...imagePaths, ...uploadedPaths]
    await updateEntry({ id: entry.id, userId: user.id, fields: { image_urls: finalPaths } })

    setSaving(false)
    onDone?.()
  }
```

- [ ] **Step 5：在 EditEntryPage JSX 中加图片区域**

在 return JSX 的内容区 `<div style={{ flex: 1, overflowY: 'auto', padding: '20px 18px 40px' }}>` 末尾（第 154 行后、messages 渲染区之前）的**底部**插入图片管理区：

找到内容区末尾的 `</div>`（第 268 行附近，内容区结束），在这个 `</div>` 之前插入：

```jsx
          {/* ── 图片管理区 ── */}
          <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid #f0ece4' }}>
            <div style={{ fontSize: 11, color: '#bbb', marginBottom: 8 }}>图片</div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 3 }}>
              {/* 已有图片 */}
              {imagePaths.map((path, idx) => (
                <div key={path} style={{ aspectRatio: '1/1', borderRadius: 6, overflow: 'hidden', position: 'relative' }}
                  onClick={() => setFullscreenImg(getImageUrl(path))}>
                  <img src={getImageUrl(path)} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  <button
                    onClick={e => { e.stopPropagation(); handleDeleteExisting(path) }}
                    style={{
                      position: 'absolute', top: 4, right: 4,
                      width: 18, height: 18, borderRadius: '50%',
                      background: 'rgba(0,0,0,0.6)', color: 'white',
                      border: 'none', fontSize: 11, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >✕</button>
                </div>
              ))}

              {/* 新选图片（未上传） */}
              {newPreviews.map((src, idx) => (
                <div key={`new-${idx}`} style={{ aspectRatio: '1/1', borderRadius: 6, overflow: 'hidden', position: 'relative' }}
                  onClick={() => setFullscreenImg(src)}>
                  <img src={src} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  <button
                    onClick={e => { e.stopPropagation(); handleDeleteNew(idx) }}
                    style={{
                      position: 'absolute', top: 4, right: 4,
                      width: 18, height: 18, borderRadius: '50%',
                      background: 'rgba(0,0,0,0.6)', color: 'white',
                      border: 'none', fontSize: 11, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >✕</button>
                  {/* 待上传标记 */}
                  <div style={{
                    position: 'absolute', bottom: 2, left: 2,
                    fontSize: 8, color: 'rgba(255,255,255,0.7)',
                    background: 'rgba(0,0,0,0.4)', borderRadius: 3, padding: '1px 3px',
                  }}>待上传</div>
                </div>
              ))}

              {/* ＋ 格 */}
              {totalImages < MAX_IMAGES && (
                <label style={{
                  aspectRatio: '1/1', borderRadius: 6,
                  border: '1.5px dashed #c9a96e', background: 'none',
                  color: '#c9a96e', fontSize: 20, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <input type="file" accept="image/*" multiple style={{ display: 'none' }}
                    onChange={handleImageSelect} />
                  ＋
                </label>
              )}
            </div>
          </div>
```

- [ ] **Step 6：在 EditEntryPage return 顶层加全屏遮罩**

在最外层 `<div style={{ display: 'flex', flexDirection: 'column', height: '100%' ... }}>` 的第一个子元素之前插入：

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

- [ ] **Step 7：构建验证**

```bash
npm run build
```

期望：编译通过，无 error。

- [ ] **Step 8：本地验证清单**

```bash
npm run dev
```

手动验证：
1. 从记录列表长按 → 编辑，进入 EditEntryPage
2. 已有图片显示在编辑页底部图片管理区
3. 点 ✕ 删除已有图片 → 图片消失（Storage 实时删除）
4. 点 ＋ 选新图 → 出现"待上传"标记的缩略图
5. 点保存 → 新图上传完成，进入详情页时图片完整
6. 点图片 → 全屏查看

- [ ] **Step 9：Commit**

```bash
git add src/pages/EditEntryPage.jsx
git commit -m "feat: 编辑页图片管理（加载/删除/新增/保存上传）"
```

---

## 自检清单（实现前确认）

1. Task 0（数据库）用户已在 Supabase 控制台完成 ✓
2. `imageStorage.js` 中的 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY` 已在 `.env` 中配置 ✓
3. `db.storage` 已正确暴露（Task 1 Step 1）✓
4. `@dnd-kit/*` 三个包已安装（Task 3 Step 1）✓
5. RecordDetail 和 EditEntryPage 不直接 import supabase，只通过 imageStorage.js ✓
6. 所有 `entry.image_urls` 读取均加 `?? []` 防止旧数据 null ✓
