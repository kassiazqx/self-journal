// src/lib/exportService.js
import { db } from './db'
import { getImageUrl } from './imageStorage'

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

// ── 阶段 1：下载图片，返回成功/失败分组 ─────────────────────────
// paths: string[]（来自 journal_entries.image_urls，已去重）
// onProgress: (done: number, total: number) => void
// 返回 { ok: Map<path, Blob>, failed: Map<path, Error> }
export async function fetchImages(paths, { onProgress } = {}) {
  const ok = new Map()
  const failed = new Map()
  const total = paths.length
  let done = 0

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
