// src/components/RichTextEditor/annotationTransform.js
import { $getRoot, $createTextNode } from 'lexical'
import { AnnotatedNode } from './AnnotatedNode'
import { getAnnotationColor } from '../../lib/annotationConfig'

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

function buildStyle(activeAnnotations) {
  const style = {}
  if (activeAnnotations.find(a => a.type === 'bold')) {
    style.fontWeight = 700
  }
  const hl = activeAnnotations.find(a => a.type === 'highlight')
  if (hl) {
    const hex = getAnnotationColor(hl.color)
    style.background = `linear-gradient(transparent 10%, ${hexToRgba(hex, 0.38)} 10%, ${hexToRgba(hex, 0.38)} 88%, transparent 88%)`
  }
  const ul = activeAnnotations.find(a => a.type === 'underline')
  if (ul) {
    const hex = getAnnotationColor(ul.color)
    style.textDecoration = 'underline'
    style.textDecorationColor = hex
    style.textDecorationStyle = 'wavy'
    style.textDecorationThickness = '1.5px'
    style.textUnderlineOffset = '2px'
  }
  return style
}

/**
 * 在 editor.update() 内调用，把 annotations 范围内的 TextNode
 * 替换为带 CSS 的 AnnotatedNode。
 */
export function applyAnnotationTransform(annotations) {
  const root = $getRoot()
  let absoluteOffset = 0

  for (const para of root.getChildren()) {
    const leaves = para.getChildren()
    for (const node of leaves) {
      const text = node.getTextContent()
      const segStart = absoluteOffset
      const segEnd = absoluteOffset + text.length

      // 找出所有与本 node 重叠的 split 点
      const points = new Set([segStart, segEnd])
      for (const a of annotations) {
        if (a.start > segStart && a.start < segEnd) points.add(a.start)
        if (a.end > segStart && a.end < segEnd) points.add(a.end)
      }
      const sorted = [...points].sort((a, b) => a - b)

      if (sorted.length <= 2) {
        // 无需拆分，整段判断
        const active = annotations.filter(a => a.start <= segStart && a.end >= segEnd)
        if (active.length > 0) {
          const newStyle = buildStyle(active)
          // ⚠️ 守门：样式未变就不 replace，避免触发 onChange 回调造成循环
          if (
            node instanceof AnnotatedNode &&
            JSON.stringify(node.__annotationStyle) === JSON.stringify(newStyle)
          ) {
            // 内容和样式都未变，跳过
          } else {
            node.replace(new AnnotatedNode(text, newStyle))
          }
        } else if (node instanceof AnnotatedNode) {
          node.replace($createTextNode(text))
        }
        // 若都是普通 TextNode 且无 active 标注：不做任何替换
      } else {
        // 需要拆分成多段
        const newNodes = []
        for (let i = 0; i < sorted.length - 1; i++) {
          const s = sorted[i]
          const e = sorted[i + 1]
          const slice = text.slice(s - segStart, e - segStart)
          const active = annotations.filter(a => a.start <= s && a.end >= e)
          if (active.length > 0) {
            newNodes.push(new AnnotatedNode(slice, buildStyle(active)))
          } else {
            newNodes.push($createTextNode(slice))
          }
        }
        for (const n of newNodes) node.insertBefore(n)
        node.remove()
      }

      absoluteOffset += text.length
    }
    // 段落之间有隐含换行
    if (para.getNextSibling()) absoluteOffset += 1
  }
}
