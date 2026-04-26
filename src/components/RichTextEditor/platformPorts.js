function cloneRectLike(rect) {
  if (!rect) return null
  return {
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    width: rect.width,
    height: rect.height,
    x: rect.x ?? rect.left,
    y: rect.y ?? rect.top,
  }
}

export const webSelectionUiPort = {
  getSelection() {
    if (typeof window === 'undefined' || typeof window.getSelection !== 'function') return null
    return window.getSelection()
  },

  clearSelection() {
    this.getSelection()?.removeAllRanges()
  },

  cloneRectFromRange(range) {
    try {
      return cloneRectLike(range?.getBoundingClientRect?.())
    } catch {
      return null
    }
  },

  cloneRectFromElement(element) {
    try {
      return cloneRectLike(element?.getBoundingClientRect?.())
    } catch {
      return null
    }
  },
}

export const webClipboardPort = {
  canWriteText() {
    return typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function'
  },

  async writeText(text) {
    if (!this.canWriteText()) throw new Error('Clipboard API unavailable')
    await navigator.clipboard.writeText(text)
  },
}

export const webViewportPort = {
  getVisualViewport() {
    if (typeof window === 'undefined') return null
    return window.visualViewport ?? null
  },
}

export function cloneRectLikeObject(rect) {
  return cloneRectLike(rect)
}
