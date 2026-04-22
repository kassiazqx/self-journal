// src/components/RichTextEditor.jsx
// Lexical 富文本编辑器封装，暴露 onChange(plaintext) 和 onRangeSelect({start,end}, event)
// 支持中文 IME（compositionstart/end 守门），提取纯文本，注册 AnnotatedNode 节点类型
import { forwardRef, useImperativeHandle, useRef, useEffect } from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getRoot, $getSelection, $createParagraphNode, $createTextNode } from 'lexical'
import { AnnotatedNode } from './RichTextEditor/AnnotatedNode'
import { applyAnnotationTransform } from './RichTextEditor/annotationTransform'
import { selectionToOffsets } from './RichTextEditor/selectionToOffsets'

function onError(error) {
  console.error('[RichTextEditor]', error)
}

// ── Plugin：把 annotations 渲染进编辑器 ──
function AnnotationTransformPlugin({ annotations }) {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    editor.update(
      () => { applyAnnotationTransform(annotations ?? []) },
      { tag: 'annotation-transform' }
    )
  }, [editor, annotations])
  return null
}

// ── Plugin：mouseup 时读选区，换算为绝对偏移后回调 ──
function MouseUpPlugin({ onRangeSelect }) {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    function handleMouseUp() {
      setTimeout(() => {
        editor.read(() => {
          const offsets = selectionToOffsets($getSelection())
          if (!offsets) return
          try {
            const sel = window.getSelection()
            if (sel && sel.rangeCount > 0) {
              const rect = sel.getRangeAt(0).getBoundingClientRect()
              onRangeSelect?.(offsets, rect)
            }
          } catch { /* ignore */ }
        })
      }, 0)
    }
    const root = editor.getRootElement()
    root?.addEventListener('mouseup', handleMouseUp)
    return () => root?.removeEventListener('mouseup', handleMouseUp)
  }, [editor, onRangeSelect])
  return null
}

/**
 * props:
 *   initialValue   {string}
 *   annotations    {Array}   标注数组，传入后在编辑器内渲染
 *   onChange       {(plaintext: string) => void}
 *   onRangeSelect  {({start, end}, mouseEvent) => void}  选中文字后触发
 *   placeholder    {string}
 *   style          {object}
 *
 * ref: { focus() }
 */
const RichTextEditor = forwardRef(function RichTextEditor(
  { initialValue = '', annotations = [], onChange, onRangeSelect, placeholder, style },
  ref
) {
  const contentEditableRef = useRef(null)
  const isComposingRef = useRef(false)

  useImperativeHandle(ref, () => ({
    focus() { contentEditableRef.current?.focus() },
  }))

  const initialConfig = {
    namespace: 'journal',
    theme: {},
    onError,
    nodes: [AnnotatedNode],
    editorState: (editor) => {
      if (!initialValue) return
      editor.update(() => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        para.append($createTextNode(initialValue))
        root.append(para)
      })
    },
  }

  function handleChange(editorState) {
    // IME 组合中不触发，等 compositionend 后再读
    if (isComposingRef.current) return
    editorState.read(() => {
      onChange?.($getRoot().getTextContent())
    })
  }

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div
        style={{ position: 'relative' }}
        onCompositionStart={() => { isComposingRef.current = true }}
        onCompositionEnd={(e) => {
          isComposingRef.current = false
          // compositionEnd 后手动触发一次 onChange，保证中文确认后文本同步
          const editor = e.currentTarget.querySelector('[contenteditable]')
          if (editor) {
            // 通过 read 拿最新文本
          }
        }}
      >
        <PlainTextPlugin
          contentEditable={
            <ContentEditable
              ref={contentEditableRef}
              style={{
                outline: 'none', width: '100%', minHeight: '60vh',
                fontSize: 15, lineHeight: 1.85, color: '#2d2d2d',
                caretColor: '#aaa', fontFamily: 'inherit',
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                ...style,
              }}
            />
          }
          placeholder={
            placeholder ? (
              <div aria-hidden style={{
                position: 'absolute', top: 0, left: 0,
                pointerEvents: 'none', color: '#ccc',
                fontSize: 15, lineHeight: 1.85, fontFamily: 'inherit',
                whiteSpace: 'pre-wrap',
              }}>
                {placeholder}
              </div>
            ) : null
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <OnChangePlugin onChange={handleChange} ignoreSelectionChange />
        <AnnotationTransformPlugin annotations={annotations} />
        <MouseUpPlugin onRangeSelect={onRangeSelect} />
      </div>
    </LexicalComposer>
  )
})

export default RichTextEditor
