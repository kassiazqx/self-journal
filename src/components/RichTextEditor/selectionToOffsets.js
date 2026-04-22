// src/components/RichTextEditor/selectionToOffsets.js
import { $getRoot, $isRangeSelection } from 'lexical'

/**
 * 在 editorState.read() 内调用。
 * 把 Lexical RangeSelection 换算为全文绝对字符偏移 {start, end}。
 * 返回 null 表示无有效选区。
 */
export function selectionToOffsets(selection) {
  if (!$isRangeSelection(selection)) return null

  const root = $getRoot()
  const leaves = []

  function collectLeaves(node) {
    if (typeof node.getChildren === 'function') {
      for (const child of node.getChildren()) collectLeaves(child)
    } else {
      leaves.push(node)
    }
  }
  collectLeaves(root)

  function absoluteOffset(targetKey, targetOffset) {
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
    return pos
  }

  try {
    const a = absoluteOffset(selection.anchor.key, selection.anchor.offset)
    const b = absoluteOffset(selection.focus.key, selection.focus.offset)
    const start = Math.min(a, b)
    const end   = Math.max(a, b)
    if (start >= end) return null
    return { start, end }
  } catch {
    return null
  }
}
