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
