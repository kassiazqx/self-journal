// src/hooks/useAnnotationInteraction.js
import { useState, useCallback, useRef, useEffect } from 'react'

/**
 * 封装「长按/选区 → 弹出菜单 → addAnnotation」的交互逻辑。
 *
 * @param {object} params
 * @param {React.RefObject} params.containerRef - 绑在文本容器上的 ref（position: relative）
 * @param {string} params.rawText - 原始纯文本（与 DB 存储、AnnotatedText 接收的完全一致）
 * @param {Function} params.addAnnotation - useAnnotations 返回的 addAnnotation
 * @param {string} params.activeColor - useAnnotations 返回的 activeColor
 *
 * @returns {{
 *   menuVisible: boolean,
 *   menuPosition: { top: number, left: number },
 *   handleMouseUp: Function,
 *   handleTouchEnd: Function,
 *   closeMenu: Function,
 *   handleBold: Function,
 *   handleHighlight: Function,
 *   handleUnderline: Function,
 *   pendingRange: { start: number, end: number } | null,
 * }}
 */
export function useAnnotationInteraction({ containerRef, rawText, addAnnotation, activeColor }) {
  const [menuVisible, setMenuVisible] = useState(false)
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 })
  const pendingRangeRef = useRef(null)

  /**
   * 从 DOM Range 计算相对于 containerRef 纯文本的 start/end 偏移。
   * ⚠️ 架构约束：基准文本必须与 rawText prop 一致（不能 trim）。
   */
  function getRangeOffsets(range) {
    if (!containerRef.current) return null
    const container = containerRef.current

    function getOffset(targetNode, targetOffset) {
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
      let offset = 0
      while (walker.nextNode()) {
        const node = walker.currentNode
        if (node === targetNode) return offset + targetOffset
        offset += node.textContent.length
      }
      return offset
    }

    try {
      const start = getOffset(range.startContainer, range.startOffset)
      const end   = getOffset(range.endContainer, range.endOffset)
      if (start >= end) return null
      if (start < 0 || end > rawText.length) return null
      return { start, end }
    } catch {
      return null
    }
  }

  // rawText と containerRef を deps に含めて stale closure を防ぐ
  const tryShowMenu = useCallback(() => {
    const selection = window.getSelection()
    if (!selection || selection.toString().length === 0) return
    if (selection.rangeCount === 0) return

    let range
    try {
      range = selection.getRangeAt(0)
    } catch {
      return
    }

    if (!containerRef.current?.contains(range.commonAncestorContainer)) return

    const offsets = getRangeOffsets(range)
    if (!offsets) return

    pendingRangeRef.current = offsets

    // 计算菜单位置，并夹紧在容器范围内防止截断
    const rect = range.getBoundingClientRect()
    const containerRect = containerRef.current.getBoundingClientRect()
    const MENU_HALF_W = 120  // 菜单宽度约 240px，取一半做边界
    const rawLeft = rect.left - containerRect.left + rect.width / 2
    const containerW = containerRef.current.offsetWidth
    const left = Math.max(MENU_HALF_W, Math.min(rawLeft, containerW - MENU_HALF_W))
    const top  = rect.top - containerRect.top - 4

    setMenuPosition({ top, left })
    setMenuVisible(true)
  }, [rawText, containerRef]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleMouseUp = useCallback(() => {
    setTimeout(tryShowMenu, 0)
  }, [tryShowMenu])

  const handleTouchEnd = useCallback(() => {}, [])  // 移动端由 selectionchange 驱动，此处留空保留接口

  // 移动端：selection handles 的 touch 事件不冒泡到我们的 div，
  // 所以 touchend 无法可靠捕获拖动结束。
  // 改用 selectionchange 防抖：拖动中持续触发（计时器一直重置），
  // 用户停止拖动 500ms 后无新事件 → 弹菜单。
  useEffect(() => {
    let timer = null
    function onSelectionChange() {
      clearTimeout(timer)
      timer = setTimeout(tryShowMenu, 300)
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange)
      clearTimeout(timer)
    }
  }, [tryShowMenu])

  const closeMenu = useCallback(() => {
    setMenuVisible(false)
    pendingRangeRef.current = null
    window.getSelection()?.removeAllRanges()
  }, [])

  function applyAnnotation(type, color) {
    const r = pendingRangeRef.current
    if (!r) return
    addAnnotation(type, color, r.start, r.end)
    closeMenu()
  }

  const handleBold      = useCallback(() => applyAnnotation('bold', undefined),       [addAnnotation, closeMenu])
  const handleHighlight = useCallback(() => applyAnnotation('highlight', activeColor), [addAnnotation, activeColor, closeMenu])
  const handleUnderline = useCallback(() => applyAnnotation('underline', activeColor), [addAnnotation, activeColor, closeMenu])

  return {
    menuVisible,
    menuPosition,
    handleMouseUp,
    handleTouchEnd,
    closeMenu,
    handleBold,
    handleHighlight,
    handleUnderline,
    pendingRange: pendingRangeRef.current,
  }
}
