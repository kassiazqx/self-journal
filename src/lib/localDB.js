/**
 * 本地数据库（IndexedDB via Dexie）
 *
 * 存储内容：
 *   memory 表 —— AI 记忆相关的 key-value 数据
 *     key: 'rolling_summary'   ← 历史对话滚动摘要
 *     key: 'user_profile'      ← 用户画像（跨对话积累）
 *
 * Supabase 存：日记正文、AI 提取字段、对话记录
 * IndexedDB 存：AI 跨对话记忆（不需要联网，纯本地）
 */

import Dexie from 'dexie'

// ─── 数据库定义 ────────────────────────────────────────────────
const db = new Dexie('self_journal')

db.version(1).stores({
  // key 作为主键（唯一），存任意结构的 content
  memory: 'key',
})

export default db

// ─── 记忆读写 ──────────────────────────────────────────────────

/**
 * 读取一条记忆
 * @param {'rolling_summary' | 'user_profile'} key
 * @returns {string | null}
 */
export async function getMemory(key) {
  try {
    const row = await db.memory.get(key)
    return row?.content ?? null
  } catch (err) {
    console.error(`[localDB] getMemory(${key}) 失败:`, err)
    return null
  }
}

/**
 * 写入/更新一条记忆
 * @param {'rolling_summary' | 'user_profile'} key
 * @param {string} content
 */
export async function setMemory(key, content) {
  try {
    await db.memory.put({ key, content, updated_at: new Date().toISOString() })
  } catch (err) {
    console.error(`[localDB] setMemory(${key}) 失败:`, err)
  }
}

/**
 * 删除一条记忆（一般不需要，重置时用）
 */
export async function deleteMemory(key) {
  try {
    await db.memory.delete(key)
  } catch (err) {
    console.error(`[localDB] deleteMemory(${key}) 失败:`, err)
  }
}

/**
 * 读取所有记忆（调试 / 导出用）
 */
export async function getAllMemory() {
  try {
    return await db.memory.toArray()
  } catch (err) {
    console.error('[localDB] getAllMemory 失败:', err)
    return []
  }
}

// ─── 导出 / 导入（换设备用）────────────────────────────────────

/**
 * 导出本地所有记忆为 JSON 字符串
 * 用法：把返回值写成 .json 文件让用户保存
 */
export async function exportMemoryJSON() {
  const rows = await getAllMemory()
  return JSON.stringify({ version: 1, exported_at: new Date().toISOString(), memory: rows }, null, 2)
}

/**
 * 从 JSON 字符串导入记忆（覆盖同名 key）
 * @param {string} jsonStr
 * @returns {{ success: boolean, count: number, error?: string }}
 */
export async function importMemoryJSON(jsonStr) {
  try {
    const parsed = JSON.parse(jsonStr)
    if (!parsed.memory || !Array.isArray(parsed.memory)) {
      return { success: false, count: 0, error: '格式不正确' }
    }
    await db.memory.bulkPut(parsed.memory)
    return { success: true, count: parsed.memory.length }
  } catch (err) {
    console.error('[localDB] importMemoryJSON 失败:', err)
    return { success: false, count: 0, error: err.message }
  }
}
