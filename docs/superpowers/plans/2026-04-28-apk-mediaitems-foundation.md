# APK MediaItems Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 APK 阶段把图片能力收口成统一 `mediaItems[]` 模型，支持本地持久化、草稿恢复、删除/排序/展示一致，并给“是否继续上云”留出分叉。

**Architecture:** UI 层不再直接持有 `selectedFiles` / `selectedPreviews` / `imagePaths` 三轨状态，而是只消费一个 `mediaItems[]`。二进制文件走本地媒体存储适配层；远端上传走独立 remote adapter；页面只通过 `useEntryMedia()` 做新增、删除、调序、恢复。这样 APK 若走本地优先，底层可从 Web `ObjectURL` / IndexedDB 切到 Capacitor Filesystem，而页面和交互层尽量不再重写。

**Tech Stack:** React, Capacitor Filesystem, Capacitor Camera/Photo Picker（如启用）, local metadata store, existing Supabase image upload path as optional remote adapter

---

## Why This Plan Exists

- 当前 Web 图片链路是三轨状态：
  - `selectedFiles`
  - `selectedPreviews`
  - `imagePaths`
- 这套结构能跑，但不适合作为 APK 终局：
  - 选中未保存图、已保存远端图、本地草稿图，本质是三类同源对象，却被拆成多套状态
  - 删除、调序、恢复、保存时都要手动保持“多数组下标同步”
  - APK 阶段真正要处理的是 `localUri / remotePath / preview / status`，不是单纯 `File[]`
- 所以：
  - `pendingImages[]` 只是中间态，不是终局态
  - 终局应直接进入 `mediaItems[]`

## Scope

- 做：
  - 定义统一 `mediaItems[]` 运行时模型
  - 定义本地媒体存储适配接口
  - 定义 `useEntryMedia()` 控制层，收口新增/删除/调序/恢复
  - 让草稿恢复、本地预览、编辑已保存记录共用同一套媒体状态
  - 让“继续保留云端上传”成为可选分支，不绑死在 UI 层
- 不做：
  - 当前 Web batch 的小修
  - 视频、Live Photo、裁剪、滤镜、OCR
  - 云端数据模型大迁移（先兼容现有 `image_urls`）

## Assumptions

- APK 阶段至少要求：未保存图片在 app 重启后仍可恢复
- 图片二进制落本地持久化，不靠 JS 内存活着
- UI 最终只认 `mediaItems[]`，不再感知平台细节
- 第一阶段可以继续兼容现有 Supabase `image_urls text[]`
- 若未来改“本地 only、不上云”，应停在 Task 4；若保留云同步，再继续 Task 5

## Core Model

```js
{
  id,                 // 本地稳定 ID，非数组下标
  source,             // 'local' | 'remote'
  localUri,           // 本地文件 URI；remote-only 可为 null
  remotePath,         // Supabase Storage path；local-only 可为 null
  previewUrl,         // 当前可渲染地址，优先本地
  fileName,
  mimeType,
  width,
  height,
  status,             // 'draft' | 'saved' | 'uploading' | 'failed'
  createdAt,
}
```

**关键原则：**

- `id` 才是唯一标识，绝不再用数组下标代表某张图
- `previewUrl` 是渲染字段，不是持久化真相
- `localUri` / `remotePath` 才是底层真相
- 页面层不自己拼 URL，不自己管平台 API

## File Structure

- Create: `src/lib/mediaTypes.js`
  - 定义 `MediaItem` 结构与基础 helper
- Create: `src/lib/mediaMappers.js`
  - `image_urls[]` ↔ `mediaItems[]` 转换
- Create: `src/lib/mediaLocalStore.js`
  - 平台无关接口，只暴露 save/read/delete/list
- Create: `src/lib/platform/mediaLocalStore.web.js`
  - Web fallback 实现（调试/兼容）
- Create: `src/lib/platform/mediaLocalStore.capacitor.js`
  - APK 本地实现（Capacitor Filesystem）
- Create: `src/lib/mediaRemoteStore.js`
  - 远端上传/删除/URL 解析；可先包装现有 `imageStorage.js`
- Create: `src/hooks/useEntryMedia.js`
  - 页面唯一媒体控制层
- Modify: `src/pages/HomePage.jsx`
  - 用 `useEntryMedia()` 替换 `selectedFiles/selectedPreviews/imagePaths`
- Modify: `src/components/RecordDetail.jsx`
  - 用统一 media 渲染入口显示本地/远端图片
- Modify: `src/lib/draftStorage.js`
  - 草稿只存媒体 metadata，不存大 blob
- Optional Modify: `src/lib/imageStorage.js`
  - 降级为 remote-only 适配器，避免 UI 直连

---

### Task 1: 冻结 `mediaItems[]` 领域模型

**Files:**
- Create: `src/lib/mediaTypes.js`
- Create: `src/lib/mediaMappers.js`
- Test: `src/lib/mediaTypes.test.js`

- [ ] **Step 1: 定义运行时结构与状态迁移 helper**

```js
// src/lib/mediaTypes.js
export function createDraftMediaItem({
  id,
  localUri,
  previewUrl,
  fileName = '',
  mimeType = 'image/jpeg',
  width = null,
  height = null,
  createdAt = new Date().toISOString(),
}) {
  return {
    id,
    source: 'local',
    localUri,
    remotePath: null,
    previewUrl,
    fileName,
    mimeType,
    width,
    height,
    status: 'draft',
    createdAt,
  }
}

export function markMediaUploaded(item, remotePath, previewUrl) {
  return {
    ...item,
    source: 'remote',
    remotePath,
    previewUrl,
    status: 'saved',
  }
}
```

- [ ] **Step 2: 明确兼容旧 `image_urls` 的 mapper**

```js
// src/lib/mediaMappers.js
export function remotePathsToMediaItems(paths, getRemotePreviewUrl) {
  return (paths ?? []).map((path, index) => ({
    id: `remote:${index}:${path}`,
    source: 'remote',
    localUri: null,
    remotePath: path,
    previewUrl: getRemotePreviewUrl(path),
    fileName: '',
    mimeType: 'image/jpeg',
    width: null,
    height: null,
    status: 'saved',
    createdAt: null,
  }))
}

export function mediaItemsToRemotePaths(items) {
  return (items ?? [])
    .filter((item) => item.remotePath)
    .map((item) => item.remotePath)
}
```

- [ ] **Step 3: 用测试锁死“不靠数组下标同步”的规则**

```js
test('删除中间一张图不影响其他 item 身份', () => {
  const items = [
    { id: 'a', remotePath: '1' },
    { id: 'b', remotePath: '2' },
    { id: 'c', remotePath: '3' },
  ]
  const next = items.filter((item) => item.id !== 'b')
  assert.deepEqual(next.map((item) => item.id), ['a', 'c'])
})
```

---

### Task 2: 建本地媒体存储适配层

**Files:**
- Create: `src/lib/mediaLocalStore.js`
- Create: `src/lib/platform/mediaLocalStore.web.js`
- Create: `src/lib/platform/mediaLocalStore.capacitor.js`
- Test: `src/lib/mediaLocalStore.test.js`

- [ ] **Step 1: 先冻结接口，不让 UI 直接碰平台 API**

```js
// src/lib/mediaLocalStore.js
export async function saveLocalMedia({ id, file }) {}
export async function readLocalMedia(id) {}
export async function deleteLocalMedia(id) {}
export async function getLocalPreviewUrl(id) {}
```

- [ ] **Step 2: APK 实现采用“文件系统存二进制，metadata 走上层”**

```js
// src/lib/platform/mediaLocalStore.capacitor.js
// 目标：Directory.Data / media/<id>.jpg
// 返回 localUri，供 mediaItems.localUri 持久化
```

- [ ] **Step 3: Web fallback 只作开发/兼容，不把它当终局**

```js
// src/lib/platform/mediaLocalStore.web.js
// 可用 IndexedDB + ObjectURL
// 但注释明确：仅作为 web fallback / 调试桥，不是 APK 终局
```

---

### Task 3: 建 `useEntryMedia()` 控制层

**Files:**
- Create: `src/hooks/useEntryMedia.js`
- Test: `src/hooks/useEntryMedia.test.js`

- [ ] **Step 1: 控制层只暴露意图，不暴露底层细节**

```js
// src/hooks/useEntryMedia.js
export function useEntryMedia() {
  return {
    mediaItems,
    addPickedFiles,
    removeMediaItem,
    reorderMediaItems,
    restoreDraftMedia,
    clearDraftMedia,
    syncPendingUploads,
  }
}
```

- [ ] **Step 2: 新增/删除/调序都只改一份 `mediaItems[]`**

```js
function removeMediaItem(id) {
  setMediaItems((prev) => prev.filter((item) => item.id !== id))
}

function reorderMediaItems(activeId, overId) {
  // 基于 id 调序，不再基于 fileIndex / previewIndex
}
```

- [ ] **Step 3: 规定页面层禁用以下旧状态**

```text
- selectedFiles
- selectedPreviews
- imagePaths（页面态）
```

页面最终只拿：

```js
const { mediaItems, addPickedFiles, removeMediaItem, reorderMediaItems } = useEntryMedia(...)
```

---

### Task 4: 草稿恢复与本地持久化

**Files:**
- Modify: `src/lib/draftStorage.js`
- Modify: `src/hooks/useEntryMedia.js`
- Test: `src/lib/draftStorage.test.js`

- [ ] **Step 1: 草稿只存 metadata，不存 blob 本身**

```js
// draft snapshot
{
  content,
  template,
  selectedDatetime,
  mediaItems: [
    {
      id,
      source: 'local',
      localUri,
      remotePath: null,
      fileName,
      mimeType,
      status: 'draft',
    }
  ]
}
```

- [ ] **Step 2: 恢复时先读 metadata，再问 localStore 拿预览**

```js
async function restoreDraftMedia(snapshotItems) {
  const restored = await Promise.all(
    snapshotItems.map(async (item) => ({
      ...item,
      previewUrl: await getLocalPreviewUrl(item.id),
    }))
  )
  setMediaItems(restored.filter((item) => item.previewUrl))
}
```

- [ ] **Step 3: 明确清理时机**

```text
- 点“新建”丢弃：删 draft metadata + 删本地媒体文件
- 点“✓”保存成功：若走本地 only，保留 entry 关联文件；若走远端上传，再按策略决定是否删本地草稿副本
- 删除单张图：同时删 local store 和 mediaItems 项
```

---

### Task 5: 远端上传分叉（可选）

**Files:**
- Create: `src/lib/mediaRemoteStore.js`
- Modify: `src/hooks/useEntryMedia.js`
- Optional Modify: `src/lib/imageStorage.js`

- [ ] **Step 1: 先把 remote 行为收口成独立 adapter**

```js
// src/lib/mediaRemoteStore.js
export async function uploadMediaItem(item, { userId, entryId }) {}
export async function deleteRemoteMedia(remotePath) {}
export function getRemotePreviewUrl(remotePath) {}
```

- [ ] **Step 2: 明确两条产品分叉**

```text
A. Local-only：
   - entry 只保存本地 media metadata
   - 不走 Supabase Storage

B. Local-first + cloud-backed：
   - 先写本地
   - 后台上传成功后把 item 从 draft/uploading 切到 saved
   - journal_entries 继续兼容写 image_urls
```

- [ ] **Step 3: 若继续兼容现有 DB，先不做服务端大迁移**

```text
- 本阶段只把 mediaItems 映射回 image_urls
- 不急着把 Supabase schema 改成 media_items JSONB / 子表
- 等图片链在 APK 上跑稳，再决定是否升级服务端模型
```

---

### Task 6: 页面迁移与渲染统一

**Files:**
- Modify: `src/pages/HomePage.jsx`
- Modify: `src/components/RecordDetail.jsx`
- Optional Modify: `src/pages/RecordsPage.jsx`

- [ ] **Step 1: `HomePage` 全面切到 `useEntryMedia()`**

```text
- 选图
- 删除
- 调序
- 首屏预览
- 草稿恢复
```

- [ ] **Step 2: `RecordDetail` 不再假设只有 remote path**

```js
// 渲染时统一走 item.previewUrl
mediaItems.map((item) => (
  <img key={item.id} src={item.previewUrl} />
))
```

- [ ] **Step 3: 编辑旧记录时先把 remote path 转成 mediaItems，再进统一页面逻辑**

```js
const initialMediaItems = remotePathsToMediaItems(entry.image_urls, getRemotePreviewUrl)
```

---

### Task 7: 决策门

**Files:**
- Docs only

- [ ] **Step 1: APK 开工前先确认产品分叉**

必须先定 1 个：

```text
1. Local-only
2. Local-first + cloud-backed
```

- [ ] **Step 2: 若没定，不开始 Task 5**

原因：

```text
- Task 1~4 是共用地基
- Task 5 取决于产品是否继续保留云端图片
- 不先定，后面会重复改 upload / cleanup / detail render 语义
```

---

## Recommended Order

1. Task 1
2. Task 2
3. Task 3
4. Task 4
5. 先停，确认 `local-only` 还是 `local-first + cloud-backed`
6. 若保留云端，再做 Task 5
7. Task 6

## Notes For Future Session

- 这份 plan 是 APK 媒体专项，不等于整个 APK 打包 plan
- 这份 plan 刻意不处理：
  - Auth
  - 离线文本存储
  - SQLite 全量迁移
  - Android 权限细节
- 下一次真正做 APK 媒体时，先读：
  - [2026-04-28-persistence-trust-batch-a.md](/Users/kassia/Desktop/AI/个人/noteapp/self-journal/docs/superpowers/plans/2026-04-28-persistence-trust-batch-a.md)
  - [2026-04-19-image-upload-plan.md](/Users/kassia/Desktop/AI/个人/noteapp/self-journal/docs/superpowers/plans/2026-04-19-image-upload-plan.md)
