// src/components/AnnotationMenu.jsx
import React from 'react'
import { DEFAULT_ANNOTATION_COLORS } from '../lib/annotationConfig'

/**
 * 长按弹出标注菜单。
 * 绝对定位，由父组件控制 `position`（{ top, left }）和 `visible`。
 *
 * @param {{ top: number, left: number }} position - 菜单左上角坐标（相对最近 position:relative 祖先）
 * @param {boolean} visible
 * @param {string} activeColor - 当前活动色 id（'straw'|'pink'|'sage'|'slate'）
 * @param {() => void} onBold
 * @param {() => void} onHighlight
 * @param {() => void} onUnderline
 * @param {(colorId: string) => void} onColorChange
 * @param {() => void} onClose - 点菜单外部关闭时调用
 */
export default function AnnotationMenu({
  position,
  visible,
  activeColor,
  onBold,
  onHighlight,
  onUnderline,
  onColorChange,
  onClose,
}) {
  if (!visible) return null

  const btnStyle = {
    padding: '4px 10px',
    color: 'white',
    fontSize: 13,
    borderRight: '1px solid #3a3a3c',
    whiteSpace: 'nowrap',
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    cursor: 'pointer',
    background: 'none',
    border: 'none',
  }

  function stop(e) { e.stopPropagation() }

  return (
    <>
      {/* 透明遮罩，点外部关闭 */}
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 199 }}
        onMouseDown={onClose}
        onTouchStart={onClose}
      />
      <div
        onMouseDown={stop}
        onTouchStart={stop}
        style={{
          position: 'absolute',
          top: position.top,
          left: position.left,
          transform: 'translateX(-50%) translateY(-100%)',
          marginTop: -8,
          background: '#1c1c1e',
          borderRadius: 12,
          padding: '6px 0',
          display: 'flex',
          boxShadow: '0 8px 28px rgba(0,0,0,0.35)',
          zIndex: 200,
        }}
      >
        {/* 向下箭头 */}
        <div style={{
          position: 'absolute',
          bottom: -7, left: '50%',
          transform: 'translateX(-50%)',
          width: 0, height: 0,
          borderLeft: '7px solid transparent',
          borderRight: '7px solid transparent',
          borderTop: '7px solid #1c1c1e',
        }} />

        {/* B 加粗 */}
        <button style={{ ...btnStyle, fontWeight: 700, letterSpacing: 0.5, borderRight: '1px solid #3a3a3c' }} onClick={onBold}>B</button>

        {/* U 下划线 */}
        <button style={{ ...btnStyle, textDecoration: 'underline', textDecorationColor: '#8FAABC', textDecorationThickness: 1.5, borderRight: '1px solid #3a3a3c' }} onClick={onUnderline}>U</button>

        {/* ▌ 高亮 */}
        <button style={{ ...btnStyle, borderRight: '1px solid #3a3a3c' }} onClick={onHighlight}>▌</button>

        {/* 四色点 */}
        {DEFAULT_ANNOTATION_COLORS.map((c, idx) => (
          <button
            key={c.id}
            style={{
              ...btnStyle,
              borderRight: idx === DEFAULT_ANNOTATION_COLORS.length - 1 ? 'none' : '1px solid #3a3a3c',
              padding: '4px 8px',
            }}
            onClick={() => onColorChange(c.id)}
          >
            <span style={{
              width: 12, height: 12, borderRadius: '50%',
              background: c.hex, opacity: 0.9,
              display: 'inline-block',
              outline: activeColor === c.id ? `2px solid white` : 'none',
              outlineOffset: 1,
            }} />
          </button>
        ))}
      </div>
    </>
  )
}
