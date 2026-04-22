// src/hooks/useAnnotations.js
import { useState, useCallback } from 'react'

const LS_COLOR_KEY = 'annotation_active_color'

/**
 * @param {Array} initialAnnotations - 从 DB 读取的初始标注数组（可为 null/undefined）
 */
export function useAnnotations(initialAnnotations) {
  const [annotations, setAnnotations] = useState(
    Array.isArray(initialAnnotations) ? initialAnnotations : []
  )
  const [activeColor, setActiveColorState] = useState(() => {
    try {
      return localStorage.getItem(LS_COLOR_KEY) ?? 'straw'
    } catch {
      return 'straw'
    }
  })
  const [dirty, setDirty] = useState(false)

  const setActiveColor = useCallback((colorId) => {
    setActiveColorState(colorId)
    try {
      localStorage.setItem(LS_COLOR_KEY, colorId)
    } catch { /* ignore */ }
  }, [])

  /**
   * 新增一条标注。
   * @param {'bold'|'highlight'|'underline'} type
   * @param {string|undefined} color - bold 时传 undefined；否则传 colorId
   * @param {number} start - UTF-16 字符偏移，inclusive
   * @param {number} end   - UTF-16 字符偏移，exclusive
   */
  const addAnnotation = useCallback((type, color, start, end) => {
    if (start >= end) return
    const entry = type === 'bold'
      ? { type, start, end }
      : { type, start, end, color }
    setAnnotations(prev => {
      // 防止重复标注（相同 type + start + end）
      if (prev.some(a => a.type === type && a.start === start && a.end === end)) return prev
      return [...prev, entry]
    })
    setDirty(true)
  }, [])

  /**
   * 删除指定下标的标注。
   * @param {number} idx
   */
  const removeAnnotation = useCallback((idx) => {
    setAnnotations(prev => prev.filter((_, i) => i !== idx))
    setDirty(true)
  }, [])

  /**
   * 外部保存成功后调用，重置 dirty。
   */
  const markSaved = useCallback(() => setDirty(false), [])

  /**
   * 清空所有标注（日记内容编辑保存时调用）。
   */
  const clearAll = useCallback(() => {
    setAnnotations([])
    setDirty(true)
  }, [])

  /**
   * 剪切掉 [clipStart, clipEnd) 范围内的标注（或指定类型）。
   * 超出范围的部分保留为新的标注条目。
   * @param {number} clipStart
   * @param {number} clipEnd
   * @param {'all'|'bold'|'highlight'|'underline'} typesToClip
   */
  const clipAnnotations = useCallback((clipStart, clipEnd, typesToClip = 'all') => {
    setAnnotations(prev => {
      const result = []
      for (const a of prev) {
        const shouldClip = typesToClip === 'all' || typesToClip === a.type
        if (!shouldClip || a.end <= clipStart || a.start >= clipEnd) {
          result.push(a)
          continue
        }
        if (a.start < clipStart) result.push({ ...a, end: clipStart })
        if (a.end > clipEnd)     result.push({ ...a, start: clipEnd })
      }
      return result
    })
    setDirty(true)
  }, [])

  /**
   * 重置为新的初始标注数组（用于异步加载场景，如 ThreadDetailPage）。
   * 调用后 dirty 重置为 false，视为"刚从 DB 加载"的干净状态。
   * @param {Array|null} newAnnotations
   */
  const resetAnnotations = useCallback((newAnnotations) => {
    setAnnotations(Array.isArray(newAnnotations) ? newAnnotations : [])
    setDirty(false)
  }, [])

  return { annotations, activeColor, setActiveColor, addAnnotation, removeAnnotation, markSaved, clearAll, clipAnnotations, resetAnnotations, dirty }
}
