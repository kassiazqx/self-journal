# 完整数据备份导出 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 替换现有导出功能为完整备份导出——8 张表数据导出为 JSON，可选含图片打包为 zip。

**Architecture:** 新建 `src/lib/exportService.js` 封装所有导出逻辑（8 表查询、图片两阶段下载、JSZip 打包），`SettingsPage.jsx` 移除旧导出逻辑，替换为新 UI + 调用 exportService。图片失败采用两阶段设计：先 fetchImages 拿结果，SettingsPage 决定是否继续，再 buildZip 打包，service 内部不持有用户决策状态。`thread_entries` 无 user_id 字段，通过先查 threads 取 id 列表再 `.in()` 查询。

**Tech Stack:** JSZip (`jszip`)，Supabase JS client，`getImageUrl`（`src/lib/imageStorage.js`）

---

## 文件改动地图

| 文件 | 改动 |
|---|---|
| `src/lib/exportService.js` | 新建：8 表查询、fetchImages、buildZip、exportDataJson |
| `src/pages/SettingsPage.jsx` | 移除旧 handleExport + 旧两个按钮，替换为新 UI + 调用 exportService |

---

## Task 0：安装 JSZip

**Files:**
- `package.json`（通过 npm install 更新）

- [ ] **Step 1：安装依赖**

```bash
npm install jszip
```

期望：`package.json` dependencies 中出现 `"jszip": "^x.x.x"`

- [ ] **Step 2：验证能 import**

```bash
node -e "require('./node_modules/jszip'); console.log('ok')"
```

期望：打印 `ok`，无报错

---

## Task 1：新建 `exportService.js` — 8 表数据查询

**Files:**
- Create: `src/lib/exportService.js`

- [ ] **Step 1：创建文件，实现 `exportDataJson`**

```js
// src/lib/exportService.js
import { db } from './db'

// ── 查询 8 张表，返回结构化 JSON 字符串 ──────────────────────────
export async function exportDataJson(userId) {
  // thread_entries 无 user_id 字段，需先取 thread_id 列表
  const { data: threads } = await db.from('threads')
    .select('*').eq('user_id', userId)
  const threadIds = (threads ?? []).map(t => t.id)

  const [
    journalEntries,
    conversations,
    reviewLetters,
    threadEntries,
    userMemory,
    userOptions,
    userContacts,
  ] = await Promise.all([
    db.from('journal_entries').select('*').eq('user_id', userId).then(r => r.data ?? []),
    db.from('conversations').select('*').eq('user_id', userId).then(r => r.data ?? []),
    db.from('review_letters').select('*').eq('user_id', userId).then(r => r.data ?? []),
    threadIds.length
      ? db.from('thread_entries').select('*').in('thread_id', threadIds).then(r => r.data ?? [])
      : Promise.resolve([]),
    db.from('user_memory').select('*').eq('user_id', userId).then(r => r.data ?? []),
    db.from('user_options').select('*').eq('user_id', userId).then(r => r.data ?? []),
    db.from('user_contacts').select('*').eq('user_id', userId).then(r => r.data ?? []),
  ])

  const payload = {
    version: '1',
    exportedAt: new Date().toISOString(),
    userId,
    tables: {
      journal_entries: journalEntries,
      conversations,
      review_letters: reviewLetters,
      threads: threads ?? [],
      thread_entries: threadEntries,
      user_memory: userMemory,
      user_options: userOptions,
      user_contacts: userContacts,
    },
  }

  return JSON.stringify(payload, null, 2)
}
```

- [ ] **Step 2：验证编译**

```bash
npm run build 2>&1 | tail -5
```

期望：无 error

---

## Task 2：`exportService.js` — 图片两阶段下载（`fetchImages` + `buildZip`）

**Files:**
- Modify: `src/lib/exportService.js`（追加两个函数）

- [ ] **Step 1：追加 `fetchImages`**

在文件末尾追加：

```js
// ── 阶段 1：下载图片，返回成功/失败分组 ─────────────────────────
// paths: string[]（来自 journal_entries.image_urls，已去重）
// onProgress: (done: number, total: number) => void
// 返回 { ok: Map<path, Blob>, failed: Map<path, Error> }
export async function fetchImages(paths, { onProgress } = {}) {
  const ok = new Map()
  const failed = new Map()
  const total = paths.length
  let done = 0

  // 引入 getImageUrl（唯一知道 Supabase URL 格式的函数，不自行拼接）
  const { getImageUrl } = await import('./imageStorage')

  // 每批 3 张并发下载
  for (let i = 0; i < paths.length; i += 3) {
    const batch = paths.slice(i, i + 3)
    await Promise.all(batch.map(async path => {
      try {
        const url = getImageUrl(path)
        const res = await fetch(url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const blob = await res.blob()
        ok.set(path, blob)
      } catch (err) {
        failed.set(path, err)
      } finally {
        done++
        onProgress?.(done, total)
      }
    }))
  }

  return { ok, failed }
}
```

- [ ] **Step 2：追加 `buildZip`**

继续追加：

```js
// ── 阶段 2：打包 zip ─────────────────────────────────────────────
// jsonString: exportDataJson() 的返回值
// imageBlobs: Map<path, Blob>（ok 部分，失败的已由调用方决定跳过）
// 返回 Blob（zip）
export async function buildZip(jsonString, imageBlobs) {
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()

  zip.file('data.json', jsonString)

  const images = zip.folder('images')
  for (const [path, blob] of imageBlobs) {
    // path 形如 "userId/entryId/filename.jpg"，直接作为 zip 内路径
    images.file(path, blob)
  }

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}
```

- [ ] **Step 3：验证编译**

```bash
npm run build 2>&1 | tail -5
```

期望：无 error

---

## Task 3：`SettingsPage.jsx` — 移除旧导出 UI，新增新 UI state

**Files:**
- Modify: `src/pages/SettingsPage.jsx`

- [ ] **Step 1：在 import 区引入 exportService**

找到顶部 import 区，新增：

```js
import { exportDataJson, fetchImages, buildZip } from '../lib/exportService'
```

- [ ] **Step 2：新增导出相关 state（在现有 state 之后）**

找到 `const [exporting, setExporting] = useState(false)` 附近，替换 / 补充为：

```js
const [includeImages, setIncludeImages] = useState(false)
const [exportStatus, setExportStatus] = useState(null)
// exportStatus: null | 'exporting' | 'fetching-images' | 'confirm-failed' | 'building' | 'done' | 'error'
const [exportProgress, setExportProgress] = useState({ done: 0, total: 0 })
const [failedImages, setFailedImages] = useState([])   // [{ path, reason }]
const [pendingExport, setPendingExport] = useState(null) // { jsonString, okBlobs }，等用户决定后用
```

- [ ] **Step 3：验证编译**

```bash
npm run build 2>&1 | tail -5
```

---

## Task 4：`SettingsPage.jsx` — 实现导出主流程 `handleExportBackup`

**Files:**
- Modify: `src/pages/SettingsPage.jsx`

- [ ] **Step 1：新增 `handleExportBackup` 函数（替换旧 `handleExport`）**

找到旧 `handleExport` 函数（第 131 行），**完整替换**为以下（旧函数删除，新函数加在同位置）：

```js
  async function handleExportBackup() {
    const date = new Date().toISOString().slice(0, 10)
    setExportStatus('exporting')
    setFailedImages([])
    setPendingExport(null)

    try {
      // 1. 查询 8 张表
      const jsonString = await exportDataJson(user.id)

      if (!includeImages) {
        // 不含图片：直接下载 JSON
        downloadFile(jsonString, `self-journal-backup-${date}.json`, 'application/json')
        setExportStatus('done')
        setTimeout(() => setExportStatus(null), 3000)
        return
      }

      // 2. 收集所有图片路径（去重）
      const parsed = JSON.parse(jsonString)
      const allPaths = [...new Set(
        (parsed.tables.journal_entries ?? []).flatMap(e => e.image_urls ?? []).filter(Boolean)
      )]

      if (allPaths.length === 0) {
        // 无图片，直接打包
        setExportStatus('building')
        const zipBlob = await buildZip(jsonString, new Map())
        downloadFile(zipBlob, `self-journal-backup-${date}.zip`, 'application/zip')
        setExportStatus('done')
        setTimeout(() => setExportStatus(null), 3000)
        return
      }

      // 3. 下载图片（阶段 1）
      setExportStatus('fetching-images')
      setExportProgress({ done: 0, total: allPaths.length })
      const { ok, failed } = await fetchImages(allPaths, {
        onProgress: (done, total) => setExportProgress({ done, total }),
      })

      if (failed.size > 0) {
        // 有失败：暂停，等用户决定
        setFailedImages([...failed.entries()].map(([path, err]) => ({ path, reason: err.message })))
        setPendingExport({ jsonString, okBlobs: ok })
        setExportStatus('confirm-failed')
        return
      }

      // 4. 打包 zip（阶段 2，无失败）
      setExportStatus('building')
      const zipBlob = await buildZip(jsonString, ok)
      downloadFile(zipBlob, `self-journal-backup-${date}.zip`, 'application/zip')
      setExportStatus('done')
      setTimeout(() => setExportStatus(null), 3000)

    } catch (err) {
      console.error('[export]', err)
      setExportStatus('error')
    }
  }

  // 用户在失败弹窗选「继续导出（跳过失败图片）」
  async function handleContinueExport() {
    if (!pendingExport) return
    const date = new Date().toISOString().slice(0, 10)
    setExportStatus('building')
    setFailedImages([])
    try {
      const zipBlob = await buildZip(pendingExport.jsonString, pendingExport.okBlobs)
      downloadFile(zipBlob, `self-journal-backup-${date}.zip`, 'application/zip')
      setExportStatus('done')
      setTimeout(() => setExportStatus(null), 3000)
    } catch (err) {
      console.error('[export]', err)
      setExportStatus('error')
    } finally {
      setPendingExport(null)
    }
  }

  // 用户在失败弹窗选「取消并放弃本次导出」
  function handleCancelExport() {
    setPendingExport(null)
    setFailedImages([])
    setExportStatus(null)
  }
```

- [ ] **Step 2：修改 `downloadFile` 函数使其同时支持 Blob**

找到现有 `downloadFile`（第 121 行）：

```js
  function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }
```

替换为：

```js
  function downloadFile(content, filename, mimeType) {
    // content 可以是 string 或 Blob（zip 用 Blob 直接传）
    const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }
```

- [ ] **Step 3：验证编译**

```bash
npm run build 2>&1 | tail -5
```

---

## Task 5：`SettingsPage.jsx` — 替换旧导出 UI 为新 UI

**Files:**
- Modify: `src/pages/SettingsPage.jsx`

**找到旧导出按钮区域（第 160 行附近，包含「导出 JSON」「导出 TXT」两个按钮的 div）整段删除，替换为以下 JSX：**

- [ ] **Step 1：替换导出 UI**

找旧的两按钮区域（通常有 `handleExport('json')` 和 `handleExport('txt')` 的 onClick），将整段替换为：

```jsx
{/* ─── 数据导出 ─── */}
<div style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid #ede9e2' }}>
  <div style={{ fontSize: 13, fontWeight: 600, color: '#333', marginBottom: 6 }}>数据导出</div>
  <div style={{ fontSize: 12, color: '#999', marginBottom: 14, lineHeight: 1.6 }}>
    导出你的全部数据，仅在本机浏览器下载，不会上传到任何服务器
  </div>

  {/* 包含图片勾选 */}
  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#555', marginBottom: 16, cursor: 'pointer' }}>
    <input
      type="checkbox"
      checked={includeImages}
      onChange={e => setIncludeImages(e.target.checked)}
      disabled={exportStatus !== null}
    />
    包含图片（导出为 zip 格式，文件较大）
  </label>

  {/* 导出按钮 */}
  <button
    onClick={handleExportBackup}
    disabled={exportStatus !== null && exportStatus !== 'error'}
    style={{
      background: (exportStatus !== null && exportStatus !== 'error') ? '#e0dbd4' : '#c9a96e',
      color: 'white', border: 'none', borderRadius: 8,
      padding: '9px 20px', fontSize: 13, cursor: (exportStatus !== null && exportStatus !== 'error') ? 'not-allowed' : 'pointer',
    }}
  >
    {exportStatus === null || exportStatus === 'error' ? '导出备份' : '导出中…'}
  </button>

  {/* 进度 / 状态文字 */}
  {exportStatus === 'fetching-images' && (
    <div style={{ marginTop: 8, fontSize: 12, color: '#999' }}>
      正在下载图片 {exportProgress.done} / {exportProgress.total}…
    </div>
  )}
  {exportStatus === 'building' && (
    <div style={{ marginTop: 8, fontSize: 12, color: '#999' }}>正在打包…</div>
  )}
  {exportStatus === 'done' && (
    <div style={{ marginTop: 8, fontSize: 12, color: '#6aaa6a' }}>✓ 已导出</div>
  )}
  {exportStatus === 'error' && (
    <div style={{ marginTop: 8, fontSize: 12, color: '#e06c6c' }}>导出失败，请重试</div>
  )}

  {/* 图片失败确认 sheet */}
  {exportStatus === 'confirm-failed' && (
    <div style={{
      marginTop: 12, background: '#fff8f2', border: '1px solid #f0d9c8',
      borderRadius: 10, padding: '14px 16px',
    }}>
      <div style={{ fontSize: 13, color: '#c06040', fontWeight: 500, marginBottom: 8 }}>
        ⚠️ {failedImages.length} 张图片下载失败
      </div>
      <div style={{ fontSize: 12, color: '#888', marginBottom: 12, maxHeight: 120, overflowY: 'auto' }}>
        {failedImages.map(({ path, reason }) => (
          <div key={path} style={{ marginBottom: 4 }}>
            · {path} — {reason}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={handleContinueExport}
          style={{
            flex: 1, background: '#c9a96e', color: 'white', border: 'none',
            borderRadius: 8, padding: '8px 0', fontSize: 12, cursor: 'pointer',
          }}
        >
          继续导出（跳过这 {failedImages.length} 张）
        </button>
        <button
          onClick={handleCancelExport}
          style={{
            flex: 1, background: 'none', color: '#999', border: '1px solid #e0dbd4',
            borderRadius: 8, padding: '8px 0', fontSize: 12, cursor: 'pointer',
          }}
        >
          取消并放弃本次导出
        </button>
      </div>
    </div>
  )}
</div>
```

- [ ] **Step 2：验证编译**

```bash
npm run build 2>&1 | tail -5
```

期望：无 error

- [ ] **Step 3：Commit**

```bash
git add src/lib/exportService.js src/pages/SettingsPage.jsx package.json package-lock.json
git commit -m "feat: 完整数据备份导出（8表JSON + 图片zip，两阶段失败处理）"
```

---

## Task 6：本地验收

```bash
npm run dev
```

**验收清单（按 spec §6）：**

1. 不勾选「包含图片」→ 点导出备份 → 下载 JSON，打开能看到 8 张表的数据
2. 勾选「包含图片」→ 进度文字从 0 增长到图片总数 → 下载 zip
3. zip 解压后，`images/` 内的文件路径与 `data.json` 里的 `image_urls` 路径对应
4. 模拟图片失败（临时修改 fetchImages 里某张 URL 为无效地址）→ 弹出失败列表
5. 点「取消并放弃」→ 不生成文件，按钮恢复正常状态
6. 点「继续导出」→ zip 正常下载，只跳过失败图片
7. 原「导出 JSON」「导出 TXT」按钮已消失
8. 旧 `exporting` state 可以同时清理（已被 `exportStatus` 替代）——grep 确认无残留

```bash
grep -n "exporting\b" src/pages/SettingsPage.jsx
```

如有残留的旧 `setExporting` / `exporting` 引用，一并删除。
