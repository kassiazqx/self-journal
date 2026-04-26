// src/hooks/useAnnotationInteraction.js
import { useState, useCallback, useRef, useEffect } from 'react'

/**
 * 封装「长按/选区 → 弹出菜单 → addAnnotation」的交互逻辑。
 *
 * @param {object} params
 * @param {React.RefObject} params.containerRef - 绑在文本容器上的 ref（position: relative）
 * @param {string} params.rawText - 原始纯文本（与 DB 存储、AnnotatedText 接收的完全一致）
 * @param {Function} params.addAnnotation - useAnnotations 返回的 addAnnotation
 * @param {Function} params.clipAnnotations - useAnnotations 返回的 clipAnnotations
 * @param {string} params.activeColor - useAnnotations 返回的 activeColor
 * @param {Array} params.annotations - useAnnotations 返回的 annotations（用于 Rule 1/2/3）
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
 *   handleCancel: Function,
 *   openMenuForRange: Function,
 *   hasOverlap: boolean,
 * }}
 */
export function useAnnotationInteraction({ containerRef, rawText, addAnnotation, clipAnnotations, activeColor, setActiveColor, annotations, disableSelectionChange = false }) {
  // 判断 [selStart, selEnd) 内每个字符是否都被 type 类型标注覆盖
  const isFullyCovered = useCallback((selStart, selEnd, type) => {
    const ofType = (annotations ?? []).filter(
      a => a.type === type && a.end > selStart && a.start < selEnd
    )
    if (!ofType.length) return false
    const sorted = [...ofType].sort((a, b) => a.start - b.start)
    let covered = selStart
    for (const a of sorted) {
      if (a.start > covered) return false   // 有间隙
      covered = Math.max(covered, a.end)
      if (covered >= selEnd) return true
    }
    return covered >= selEnd
  }, [annotations])

  const [menuVisible, setMenuVisible] = useState(false)
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0, flipDown: false })
  const [hasOverlap, setHasOverlap] = useState(false)
  const pendingRangeRef = useRef(null)
  const lastOpenMenuAtRef = useRef(0)  // 防止 mouseup + selectionchange 双触发

  const MENU_HEIGHT = 52  // AnnotationMenu 近似高度（px）
  const isTouchDevice = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

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

  const MENU_HALF_W = 120

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

    // 计算与已有标注的重叠
    const overlaps = (annotations ?? []).some(
      a => a.start < offsets.end && a.end > offsets.start
    )
    setHasOverlap(overlaps)

    // 计算菜单位置，并夹紧在容器范围内防止截断
    const rect = range.getBoundingClientRect()
    const containerRect = containerRef.current.getBoundingClientRect()
    const rawLeft = rect.left - containerRect.left + rect.width / 2
    const containerW = containerRef.current.offsetWidth
    const left = Math.max(MENU_HALF_W, Math.min(rawLeft, containerW - MENU_HALF_W))
    // 手机始终放选区下方；桌面如果选区离顶部太近也放下方
    const rawTop = rect.top - containerRect.top
    const flipDown = isTouchDevice || rawTop < MENU_HEIGHT
    const top = flipDown ? rect.bottom - containerRect.top : rawTop

    setMenuPosition({ top, left, flipDown })
    setMenuVisible(true)
  }, [rawText, containerRef, annotations]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleMouseUp = useCallback(() => {
    setTimeout(tryShowMenu, 0)
  }, [tryShowMenu])

  const handleTouchEnd = useCallback(() => {}, [])  // 移动端由 selectionchange 驱动，此处留空保留接口

  // 移动端：selectionchange 防抖 300ms
  useEffect(() => {
    if (disableSelectionChange) return   // ⬅️ Lexical 场景下跳过全局监听
    let timer = null
    function onSelectionChange() {
      clearTimeout(timer)
      timer = setTimeout(() => {
        // mouseup 已经通过 openMenuAt 处理过了，跳过避免双触发
        if (Date.now() - lastOpenMenuAtRef.current < 500) return
        tryShowMenu()
      }, 300)
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange)
      clearTimeout(timer)
    }
  }, [tryShowMenu, disableSelectionChange])

  const closeMenu = useCallback(() => {
    setMenuVisible(false)
    setHasOverlap(false)
    pendingRangeRef.current = null
    window.getSelection()?.removeAllRanges()
  }, []) // intentionally empty — no captured vars

  const applyAnnotation = useCallback((type, color) => {
    const r = pendingRangeRef.current
    if (!r) return
    if (isFullyCovered(r.start, r.end, type)) {
      // Rule 2：toggle — 选区被该类型完全覆盖，点击 = 取消
      clipAnnotations(r.start, r.end, type)
    } else {
      addAnnotation(type, color, r.start, r.end)
    }
    closeMenu()
  }, [isFullyCovered, clipAnnotations, addAnnotation, closeMenu])

  const handleBold      = useCallback(() => applyAnnotation('bold', undefined),       [applyAnnotation])
  const handleHighlight = useCallback(() => applyAnnotation('highlight', activeColor), [applyAnnotation, activeColor])
  const handleUnderline = useCallback(() => applyAnnotation('underline', activeColor), [applyAnnotation, activeColor])

  // Rule 1：取消 — 剪切选区内所有类型的所有标注
  const handleCancel = useCallback(() => {
    const r = pendingRangeRef.current
    if (!r) return
    clipAnnotations(r.start, r.end, 'all')
    closeMenu()
  }, [clipAnnotations, closeMenu])

  // 换色：始终更新 activeColor；若选区被该类型完全覆盖则同时替换颜色
  const handleColorChange = useCallback((colorId) => {
    setActiveColor(colorId)
    const r = pendingRangeRef.current
    if (!r) return
    for (const type of ['highlight', 'underline']) {
      if (isFullyCovered(r.start, r.end, type)) {
        clipAnnotations(r.start, r.end, type)
        addAnnotation(type, colorId, r.start, r.end)
      }
    }
    // 不关闭菜单，用户可能继续操作
  }, [setActiveColor, clipAnnotations, addAnnotation, isFullyCovered])

  // Rule 3：单击已标注 Segment → 以覆盖该 segment 的所有标注的并集为虚拟选区，弹出菜单
  const openMenuForRange = useCallback((e, segStart, segEnd) => {
    e.stopPropagation()
    if (!containerRef.current) return
    if (segStart < 0 || segEnd > rawText.length || segStart >= segEnd) return
    const overlapping = (annotations ?? []).filter(
      a => a.start < segEnd && a.end > segStart
    )
    if (!overlapping.length) return
    const unionStart = Math.min(...overlapping.map(a => a.start))
    const unionEnd   = Math.max(...overlapping.map(a => a.end))
    pendingRangeRef.current = { start: unionStart, end: unionEnd }
    const containerRect = containerRef.current.getBoundingClientRect()
    const containerW = containerRef.current.offsetWidth
    const rawLeft = e.clientX - containerRect.left
    const left = Math.max(MENU_HALF_W, Math.min(rawLeft, containerW - MENU_HALF_W))
    const rawTop = e.clientY - containerRect.top
    const flipDown = isTouchDevice || rawTop < MENU_HEIGHT
    const top = flipDown ? rawTop + 24 : rawTop
    setHasOverlap(true)
    setMenuPosition({ top, left, flipDown })
    setMenuVisible(true)
  }, [annotations, containerRef, isTouchDevice, rawText.length])

  /**
   * Lexical 场景专用：接收已计算好的 {start, end} 偏移和选区 DOMRect，直接弹菜单。
   * 用于替代 selectionchange 路径。
   *
   * @param {{ start: number, end: number }} offsets
   * @param {DOMRect} selectionRect  - window.getSelection().getRangeAt(0).getBoundingClientRect()
   */
  const openMenuAt = useCallback((offsets, selectionRect) => {
    if (!containerRef.current) return
    lastOpenMenuAtRef.current = Date.now()  // 标记时间，抑制后续 selectionchange 重复触发
    pendingRangeRef.current = { start: offsets.start, end: offsets.end }
    const overlaps = (annotations ?? []).some(
      a => a.start < offsets.end && a.end > offsets.start
    )
    setHasOverlap(overlaps)
    const containerRect = containerRef.current.getBoundingClientRect()
    const containerW = containerRef.current.offsetWidth
    const rawLeft = selectionRect.left + selectionRect.width / 2 - containerRect.left
    const left = Math.max(MENU_HALF_W, Math.min(rawLeft, containerW - MENU_HALF_W))
    const rawTop = selectionRect.top - containerRect.top
    const flipDown = isTouchDevice || rawTop < MENU_HEIGHT
    const top = flipDown ? selectionRect.bottom - containerRect.top : rawTop
    setMenuPosition({ top, left, flipDown })
    setMenuVisible(true)
  }, [annotations, containerRef, isTouchDevice])

  return {
    menuVisible,
    menuPosition,
    handleMouseUp,
    handleTouchEnd,
    closeMenu,
    handleBold,
    handleHighlight,
    handleUnderline,
    handleCancel,
    handleColorChange,
    openMenuForRange,
    openMenuAt,
    hasOverlap,
  }
}
