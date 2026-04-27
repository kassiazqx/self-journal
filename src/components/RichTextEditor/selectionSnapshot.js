import { $getRoot } from 'lexical'
import { buildSelectionActionModel } from './actionModel'
import { cloneRectLikeObject } from './platformPorts'
import { nodeKeyToOffsets, selectionToOffsets } from './selectionToOffsets'

/**
 * @typedef {object} SelectionSnapshot
 * @property {'mouse'|'touch'|'selectionchange'|'annotation-click'} source
 * @property {number} start
 * @property {number} end
 * @property {string} text
 * @property {ReturnType<typeof cloneRectLikeObject>|null} rect
 * @property {boolean} preserveDomSelection
 * @property {boolean} suppressNativeSelection
 * @property {{ annotate: boolean, copy: boolean, cut: boolean, paste: boolean, selectAll: boolean }} actions
 */

function sliceSnapshotText(start, end) {
  return $getRoot().getTextContent().slice(start, end)
}

function debugSnapshotMiss(reason, details) {
  if (!import.meta.env.DEV) return
  console.log('[selectionSnapshot]', reason, details)
}

export function createSelectionSnapshot({
  selection,
  source,
  rect,
  preserveDomSelection = false,
  suppressNativeSelection = false,
  isEditable = true,
}) {
  const offsets = selectionToOffsets(selection)
  if (!offsets) {
    debugSnapshotMiss('offsets-missing', {
      source,
      hasSelection: Boolean(selection),
      anchorKey: selection?.anchor?.key ?? null,
      focusKey: selection?.focus?.key ?? null,
    })
    return null
  }

  const text = sliceSnapshotText(offsets.start, offsets.end)
  if (!text) {
    debugSnapshotMiss('text-empty', {
      source,
      start: offsets.start,
      end: offsets.end,
    })
    return null
  }

  return {
    source,
    start: offsets.start,
    end: offsets.end,
    text,
    rect: cloneRectLikeObject(rect),
    preserveDomSelection,
    suppressNativeSelection,
    actions: buildSelectionActionModel({ hasText: true, isEditable }),
  }
}

export function createAnnotatedNodeSnapshot({
  node,
  rect,
  source = 'annotation-click',
  preserveDomSelection = false,
  suppressNativeSelection = true,
  isEditable = true,
}) {
  const text = node?.getTextContent?.() ?? ''
  if (!text) {
    debugSnapshotMiss('annotation-text-empty', { source })
    return null
  }

  const offsets = nodeKeyToOffsets(node.getKey(), text.length)
  if (!offsets) {
    debugSnapshotMiss('annotation-offsets-missing', {
      source,
      nodeKey: node?.getKey?.() ?? null,
    })
    return null
  }

  return {
    source,
    start: offsets.start,
    end: offsets.end,
    text,
    rect: cloneRectLikeObject(rect),
    preserveDomSelection,
    suppressNativeSelection,
    actions: buildSelectionActionModel({ hasText: true, isEditable }),
  }
}
