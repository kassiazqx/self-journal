// src/lib/annotationConfig.js

export const DEFAULT_ANNOTATION_COLORS = [
  { id: 'straw', label: '暖米', hex: '#C8A87A' },
  { id: 'pink',  label: '藕粉', hex: '#C4A0A2' },
  { id: 'sage',  label: '雾绿', hex: '#8DB0A4' },
  { id: 'slate', label: '灰蓝', hex: '#8FAABC' },
]

/**
 * 根据 color id 返回 hex 值。找不到则返回默认暖米色。
 * @param {string} colorId - 'straw' | 'pink' | 'sage' | 'slate'
 * @returns {string} hex 颜色字符串
 */
export function getAnnotationColor(colorId) {
  return (
    DEFAULT_ANNOTATION_COLORS.find(c => c.id === colorId)?.hex
    ?? DEFAULT_ANNOTATION_COLORS[0].hex
  )
}
