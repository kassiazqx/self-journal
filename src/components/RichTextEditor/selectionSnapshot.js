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

export function createSelectionSnapshot({
  selection,
  source,
  rect,
  preserveDomSelection = false,
  suppressNativeSelection = false,
  isEditable = true,
}) {
  const offsets = selectionToOffsets(selection)
  if (!offsets) return null

  const text = sliceSnapshotText(offsets.start, offsets.end)
  if (!text) return null

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
  if (!text) return null

  const offsets = nodeKeyToOffsets(node.getKey(), text.length)
  if (!offsets) return null

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
