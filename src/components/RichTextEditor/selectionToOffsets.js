// src/components/RichTextEditor/selectionToOffsets.js
import { $getRoot, $isRangeSelection } from 'lexical'

export function collectTextLeaves(root = $getRoot()) {
  const leaves = []

  function collect(node) {
    if (typeof node.getChildren === 'function') {
      for (const child of node.getChildren()) collect(child)
    } else {
      leaves.push(node)
    }
  }

  collect(root)
  return leaves
}

export function absoluteOffsetForLeafKey(leaves, targetKey, targetOffset) {
  let pos = 0

  for (const leaf of leaves) {
    if (leaf.getKey() === targetKey) return pos + targetOffset

    pos += leaf.getTextContent().length

    // 段落结尾的隐含换行
    const parent = leaf.getParent()
    const siblings = parent?.getChildren?.() ?? []
    if (siblings[siblings.length - 1]?.getKey() === leaf.getKey() && parent?.getNextSibling?.()) {
      pos += 1
    }
  }

  return null
}

export function nodeKeyToOffsets(targetKey, textLength, root = $getRoot()) {
  const leaves = collectTextLeaves(root)
  const start = absoluteOffsetForLeafKey(leaves, targetKey, 0)
  if (start === null) return null
  return { start, end: start + textLength }
}

/**
 * 在 editorState.read() 内调用。
 * 把 Lexical RangeSelection 换算为全文绝对字符偏移 {start, end}。
 * 返回 null 表示无有效选区。
 */
export function selectionToOffsets(selection) {
  if (!$isRangeSelection(selection)) return null

  const leaves = collectTextLeaves()

  try {
    const a = absoluteOffsetForLeafKey(leaves, selection.anchor.key, selection.anchor.offset)
    const b = absoluteOffsetForLeafKey(leaves, selection.focus.key, selection.focus.offset)
    if (a === null || b === null) return null
    const start = Math.min(a, b)
    const end   = Math.max(a, b)
    if (start >= end) return null
    return { start, end }
  } catch {
    return null
  }
}
