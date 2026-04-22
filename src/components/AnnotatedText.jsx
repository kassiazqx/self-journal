// src/components/AnnotatedText.jsx
import React, { useMemo } from 'react'
import { getAnnotationColor } from '../lib/annotationConfig'

/**
 * 将文本切割为带标注信息的片段。
 * 允许同一位置叠加多个标注（如 bold + highlight）。
 */
function buildSegments(text, annotations) {
  if (!annotations.length) return [{ text, start: 0, end: text.length, types: new Set(), colors: {} }]

  const points = new Set([0, text.length])
  for (const a of annotations) {
    if (a.start >= 0 && a.start < text.length) points.add(a.start)
    if (a.end > 0 && a.end <= text.length) points.add(a.end)
  }
  const sorted = [...points].sort((a, b) => a - b)

  return sorted.slice(0, -1).map((s, i) => {
    const e = sorted[i + 1]
    const types = new Set()
    const colors = {}
    for (const a of annotations) {
      if (a.start <= s && a.end >= e) {
        types.add(a.type)
        if (a.color) colors[a.type] = a.color
      }
    }
    return { text: text.slice(s, e), start: s, end: e, types, colors }
  })
}

/**
 * 单个文字片段渲染单元。
 *
 * 高亮：CSS background-color（天然支持多行换行）
 * 下划线：CSS text-decoration wavy（天然支持多行换行）
 * 加粗：fontWeight: 700
 */
function Segment({ seg, onAnnotatedClick }) {
  const isBold      = seg.types.has('bold')
  const hasHighlight = seg.types.has('highlight')
  const hasUnderline = seg.types.has('underline')

  if (!isBold && !hasHighlight && !hasUnderline) {
    return <span>{seg.text}</span>
  }

  // 有标注时，注册 onClick 供 Rule 3 单击唤起菜单
  const handleClick = onAnnotatedClick
    ? (e) => onAnnotatedClick(e, seg.start, seg.end)
    : undefined

  const hlHex = hasHighlight ? getAnnotationColor(seg.colors.highlight) : null
  const ulHex = hasUnderline ? getAnnotationColor(seg.colors.underline) : null

  // 将 hex 转为 rgba 以便控制透明度
  function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    return `rgba(${r},${g},${b},${alpha})`
  }

  const style = {
    fontWeight: isBold ? 700 : undefined,
    // 高亮：半透明背景色，天然跨行
    background: hasHighlight
      ? `linear-gradient(transparent 10%, ${hexToRgba(hlHex, 0.38)} 10%, ${hexToRgba(hlHex, 0.38)} 88%, transparent 88%)`
      : undefined,
    // 下划线：波浪线，天然跨行
    textDecoration: hasUnderline ? 'underline' : undefined,
    textDecorationColor: hasUnderline ? ulHex : undefined,
    textDecorationStyle: hasUnderline ? 'wavy' : undefined,
    textDecorationThickness: hasUnderline ? '1.5px' : undefined,
    textUnderlineOffset: hasUnderline ? '2px' : undefined,
  }

  return <span style={style} onClick={handleClick}>{seg.text}</span>
}

/**
 * AnnotatedText：将 text + annotations 渲染为带高亮/加粗/下划线的内联内容。
 *
 * ⚠️ 架构约束：text 和 annotations 的 start/end 必须基于同一个原始字符串，
 *    不能对 text 进行任何 trim() 或变换后再传入。
 */
export default function AnnotatedText({ text, annotations, style, onAnnotatedClick }) {
  const sorted = useMemo(() => {
    if (!Array.isArray(annotations) || !annotations.length) return []
    return [...annotations].sort((a, b) => a.start - b.start)
  }, [annotations])

  const segments = useMemo(() => buildSegments(text ?? '', sorted), [text, sorted])

  return (
    <span style={style}>
      {segments.map((seg) => (
        <Segment
          key={`${seg.start}-${seg.end}`}
          seg={seg}
          onAnnotatedClick={onAnnotatedClick}
        />
      ))}
    </span>
  )
}
