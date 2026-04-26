import { useState, useCallback, useRef, useEffect } from 'react'
import { webSelectionUiPort } from '../components/RichTextEditor/platformPorts'

/**
 * @typedef {object} SelectionSnapshot
 * @property {'mouse'|'touch'|'selectionchange'|'annotation-click'} source
 * @property {number} start
 * @property {number} end
 * @property {string} text
 * @property {{ top: number, left: number, right: number, bottom: number, width: number, height: number } | null} rect
 * @property {boolean} preserveDomSelection
 * @property {boolean} suppressNativeSelection
 * @property {{ annotate: boolean, copy: boolean, cut: boolean, paste: boolean, selectAll: boolean }} actions
 */

/**
 * 封装「长按/选区/点击标注 → 弹菜单 → addAnnotation」交互。
 * 只读页仍支持 DOM selection 路径；编辑器页改走 SelectionSnapshot 路径。
 */
export function useAnnotationInteraction({
  containerRef,
  rawText,
  getRawText,
  addAnnotation,
  clipAnnotations,
  activeColor,
  setActiveColor,
  annotations,
  disableSelectionChange = false,
  selectionUiPort = webSelectionUiPort,
}) {
  const resolveRawText = useCallback(() => {
    const latestRawText = getRawText?.()
    return typeof latestRawText === 'string' ? latestRawText : (rawText ?? '')
  }, [getRawText, rawText])

  const isFullyCovered = useCallback((selStart, selEnd, type) => {
    const ofType = (annotations ?? []).filter(
      a => a.type === type && a.end > selStart && a.start < selEnd
    )
    if (!ofType.length) return false
    const sorted = [...ofType].sort((a, b) => a.start - b.start)
    let covered = selStart
    for (const a of sorted) {
      if (a.start > covered) return false
      covered = Math.max(covered, a.end)
      if (covered >= selEnd) return true
    }
    return covered >= selEnd
  }, [annotations])

  const [menuVisible, setMenuVisible] = useState(false)
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0, flipDown: false })
  const [hasOverlap, setHasOverlap] = useState(false)
  const pendingRangeRef = useRef(null)
  const pendingSelectionRef = useRef(null)
  const lastOpenMenuAtRef = useRef(0)

  const MENU_HEIGHT = 52
  const MENU_HALF_W = 120
  const isTouchDevice = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

  const getRangeOffsets = useCallback((range) => {
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
      const currentRawText = resolveRawText()
      const start = getOffset(range.startContainer, range.startOffset)
      const end = getOffset(range.endContainer, range.endOffset)
      if (start >= end) return null
      if (start < 0 || end > currentRawText.length) return null
      return { start, end }
    } catch {
      return null
    }
  }, [containerRef, resolveRawText])

  const showMenuForOffsets = useCallback(({
    start,
    end,
    rect = null,
    rawPoint = null,
    unionOverlaps = false,
    preserveDomSelection = false,
    suppressNativeSelection = false,
    actions = null,
  }) => {
    if (!containerRef.current) return
    const currentRawText = resolveRawText()
    if (start < 0 || end > currentRawText.length || start >= end) return

    const overlapping = (annotations ?? []).filter(
      a => a.start < end && a.end > start
    )

    const finalRange = unionOverlaps && overlapping.length > 0
      ? {
          start: Math.min(...overlapping.map(a => a.start)),
          end: Math.max(...overlapping.map(a => a.end)),
        }
      : { start, end }

    if (unionOverlaps && overlapping.length === 0) return

    pendingRangeRef.current = finalRange
    pendingSelectionRef.current = {
      preserveDomSelection,
      suppressNativeSelection,
      actions,
    }

    setHasOverlap(overlapping.length > 0)

    const containerRect = containerRef.current.getBoundingClientRect()
    const containerW = containerRef.current.offsetWidth

    let rawLeft = MENU_HALF_W
    let rawTop = 0
    let flipDown = isTouchDevice

    if (rect) {
      rawLeft = rect.left - containerRect.left + rect.width / 2
      rawTop = rect.top - containerRect.top
      flipDown = isTouchDevice || rawTop < MENU_HEIGHT
    } else if (rawPoint) {
      rawLeft = rawPoint.left
      rawTop = rawPoint.top
      flipDown = isTouchDevice || rawTop < MENU_HEIGHT
    }

    const left = Math.max(MENU_HALF_W, Math.min(rawLeft, containerW - MENU_HALF_W))
    const top = rect
      ? (flipDown ? rect.bottom - containerRect.top : rawTop)
      : (flipDown ? rawTop + 24 : rawTop)

    setMenuPosition({ top, left, flipDown })
    setMenuVisible(true)

    if (suppressNativeSelection && !preserveDomSelection) {
      selectionUiPort.clearSelection()
    }
  }, [annotations, containerRef, isTouchDevice, resolveRawText, selectionUiPort])

  const tryShowMenu = useCallback(() => {
    const selection = selectionUiPort.getSelection()
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

    showMenuForOffsets({
      start: offsets.start,
      end: offsets.end,
      rect: range.getBoundingClientRect(),
      preserveDomSelection: false,
      suppressNativeSelection: false,
      actions: {
        annotate: true,
        copy: true,
        cut: false,
        paste: false,
        selectAll: false,
      },
    })
  }, [containerRef, getRangeOffsets, selectionUiPort, showMenuForOffsets])

  const handleMouseUp = useCallback(() => {
    setTimeout(tryShowMenu, 0)
  }, [tryShowMenu])

  const handleTouchEnd = useCallback(() => {}, [])

  useEffect(() => {
    if (disableSelectionChange) return undefined

    let timer = null
    function onSelectionChange() {
      clearTimeout(timer)
      timer = setTimeout(() => {
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

  const closeMenu = useCallback((options = {}) => {
    const { clearSelection = true } = options
    setMenuVisible(false)
    setHasOverlap(false)
    pendingRangeRef.current = null
    pendingSelectionRef.current = null
    if (clearSelection) selectionUiPort.clearSelection()
  }, [selectionUiPort])

  const applyAnnotation = useCallback((type, color) => {
    const r = pendingRangeRef.current
    if (!r) return

    if (isFullyCovered(r.start, r.end, type)) {
      clipAnnotations(r.start, r.end, type)
    } else {
      addAnnotation(type, color, r.start, r.end)
    }

    closeMenu()
  }, [isFullyCovered, clipAnnotations, addAnnotation, closeMenu])

  const handleBold = useCallback(() => applyAnnotation('bold', undefined), [applyAnnotation])
  const handleHighlight = useCallback(() => applyAnnotation('highlight', activeColor), [applyAnnotation, activeColor])
  const handleUnderline = useCallback(() => applyAnnotation('underline', activeColor), [applyAnnotation, activeColor])

  const handleCancel = useCallback(() => {
    const r = pendingRangeRef.current
    if (!r) return
    clipAnnotations(r.start, r.end, 'all')
    closeMenu()
  }, [clipAnnotations, closeMenu])

  const handleColorChange = useCallback((colorId) => {
    setActiveColor?.(colorId)
    const r = pendingRangeRef.current
    if (!r) return
    for (const type of ['highlight', 'underline']) {
      if (isFullyCovered(r.start, r.end, type)) {
        clipAnnotations(r.start, r.end, type)
        addAnnotation(type, colorId, r.start, r.end)
      }
    }
  }, [setActiveColor, clipAnnotations, addAnnotation, isFullyCovered])

  const openMenuForRange = useCallback((e, segStart, segEnd) => {
    e.stopPropagation()
    if (!containerRef.current) return

    const containerRect = containerRef.current.getBoundingClientRect()
    showMenuForOffsets({
      start: segStart,
      end: segEnd,
      rawPoint: {
        left: e.clientX - containerRect.left,
        top: e.clientY - containerRect.top,
      },
      unionOverlaps: true,
      suppressNativeSelection: true,
      preserveDomSelection: false,
      actions: {
        annotate: true,
        copy: true,
        cut: false,
        paste: false,
        selectAll: false,
      },
    })
  }, [containerRef, showMenuForOffsets])

  const openMenuFromSelectionSnapshot = useCallback((snapshot) => {
    if (!snapshot) return
    lastOpenMenuAtRef.current = Date.now()
    showMenuForOffsets({
      start: snapshot.start,
      end: snapshot.end,
      rect: snapshot.rect,
      preserveDomSelection: snapshot.preserveDomSelection,
      suppressNativeSelection: snapshot.suppressNativeSelection,
      actions: snapshot.actions,
    })
  }, [showMenuForOffsets])

  const openMenuFromAnnotationSnapshot = useCallback((snapshot) => {
    if (!snapshot) return
    lastOpenMenuAtRef.current = Date.now()
    showMenuForOffsets({
      start: snapshot.start,
      end: snapshot.end,
      rect: snapshot.rect,
      unionOverlaps: true,
      preserveDomSelection: snapshot.preserveDomSelection,
      suppressNativeSelection: snapshot.suppressNativeSelection,
      actions: snapshot.actions,
    })
  }, [showMenuForOffsets])

  const openMenuAt = useCallback((offsets, selectionRect) => {
    const currentRawText = resolveRawText()
    openMenuFromSelectionSnapshot({
      source: 'mouse',
      start: offsets.start,
      end: offsets.end,
      text: currentRawText.slice(offsets.start, offsets.end),
      rect: selectionRect,
      preserveDomSelection: false,
      suppressNativeSelection: false,
      actions: {
        annotate: true,
        copy: true,
        cut: true,
        paste: true,
        selectAll: true,
      },
    })
  }, [openMenuFromSelectionSnapshot, resolveRawText])

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
    openMenuFromSelectionSnapshot,
    openMenuFromAnnotationSnapshot,
    hasOverlap,
  }
}
