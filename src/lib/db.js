/**
 * 统一数据访问层
 *
 * 唯一知道「底下用什么存储」的文件。
 * 目前透传 Supabase，将来切换本地 SQLite（Capacitor APK 路线）只改这里。
 *
 * 使用规范：
 *   - 所有 lib 文件和页面组件，import { db } from './db'，不直接 import supabase
 *   - db.js 本身不处理错误，只透传。调用方负责处理 { data, error }
 *
 * 扩展路径：
 *   - SQLite：替换 from/rpc 的实现，接口不变，调用方零修改
 *   - 离线缓存：在这里加中间层（读缓存 → 写队列 → 同步）
 */
import { supabase } from './supabase'

export const db = {
  // 表操作（目前透传 Supabase，将来可换实现）
  from: (table) => supabase.from(table),

  // Auth（统一入口，避免组件直接依赖 supabase）
  auth: supabase.auth,

  // RPC 调用
  rpc: (fn, args) => supabase.rpc(fn, args),
}
