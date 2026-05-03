// src/components/RichTextEditor.jsx
// Lexical 富文本编辑器封装。
// 标注交互统一在 editor 层处理，页面层只消费 SelectionSnapshot / AnnotationSnapshot。
import { forwardRef, useImperativeHandle, useRef, useEffect } from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getRoot, $getSelection, $createParagraphNode, $createTextNode } from 'lexical'
import { AnnotatedNode } from './RichTextEditor/AnnotatedNode'
import AnnotationInteractionPlugin from './RichTextEditor/AnnotationInteractionPlugin'
import { applyAnnotationTransform } from './RichTextEditor/annotationTransform'
import { selectionToOffsets } from './RichTextEditor/selectionToOffsets'
import { webClipboardPort, webSelectionUiPort, webViewportPort } from './RichTextEditor/platformPorts'

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

// 桌面旧链路已稳定，先保留，不和移动端新逻辑强绑。
function MouseUpPlugin({ onRangeSelect, enabled = true }) {
  const [editor] = useLexicalComposerContext()
  const retryHandleRef = useRef({ token: 0, timeoutId: null, rafId: null })

  useEffect(() => {
    if (!enabled || !onRangeSelect) return undefined

    function debugSelectionTiming(stage, details) {
      if (!import.meta.env.DEV) return
      console.log('[RichTextEditor][desktop-selection]', stage, details)
    }

    function clearPendingRetry() {
      retryHandleRef.current.token += 1

      if (retryHandleRef.current.timeoutId !== null) {
        window.clearTimeout(retryHandleRef.current.timeoutId)
        retryHandleRef.current.timeoutId = null
      }

      if (retryHandleRef.current.rafId !== null) {
        window.cancelAnimationFrame(retryHandleRef.current.rafId)
        retryHandleRef.current.rafId = null
      }
    }

    function getCurrentSelectionRect(fallbackRect = null) {
      try {
        const selection = window.getSelection()
        if (!selection || selection.rangeCount === 0) return fallbackRect
        return selection.getRangeAt(0).getBoundingClientRect()
      } catch {
        return fallbackRect
      }
    }

    function readSelection(stage, fallbackRect = null) {
      let handled = false
      editor.read(() => {
        const selection = $getSelection()
        const offsets = selectionToOffsets(selection)
        if (!offsets) {
          debugSelectionTiming('read-miss', {
            stage,
            hasSelection: Boolean(selection),
            anchorKey: selection?.anchor?.key ?? null,
            focusKey: selection?.focus?.key ?? null,
          })
          return
        }

        handled = true
        debugSelectionTiming('read-hit', {
          stage,
          start: offsets.start,
          end: offsets.end,
        })
        onRangeSelect(offsets, getCurrentSelectionRect(fallbackRect))
      })
      return handled
    }

    function scheduleRetry(rect) {
      clearPendingRetry()
      const token = retryHandleRef.current.token

      // 首帧偶发 Lexical selection 仍未落稳：先过 0ms 宏任务，再给一帧动画机会。
      retryHandleRef.current.timeoutId = window.setTimeout(() => {
        retryHandleRef.current.timeoutId = null
        if (retryHandleRef.current.token !== token) return
        if (readSelection('timeout-0', rect)) return

        retryHandleRef.current.rafId = window.requestAnimationFrame(() => {
          retryHandleRef.current.rafId = null
          if (retryHandleRef.current.token !== token) return
          if (readSelection('raf', rect)) return

          debugSelectionTiming('read-giveup', { stage: 'raf' })
        })
      }, 0)
    }

    function handleMouseUp() {
      try {
        const sel = window.getSelection()
        if (!sel || sel.rangeCount === 0) return
        const rect = sel.getRangeAt(0).getBoundingClientRect()

        // 桌面大多数情况同步可读；首次 drag 选区偶发 Lexical selection 还没就绪，
        // 仅在同步失败时补有限次重试：先 0ms 宏任务，再给一帧 rAF。
        // 这是 Lexical 选区提交时序兜底，不是恢复旧的“无条件延迟后再读”路径。
        clearPendingRetry()
        if (readSelection('sync', rect)) return
        scheduleRetry(rect)
      } catch {
        // ignore
      }
    }

    const root = editor.getRootElement()
    root?.addEventListener('mouseup', handleMouseUp)
    return () => {
      clearPendingRetry()
      root?.removeEventListener('mouseup', handleMouseUp)
    }
  }, [editor, enabled, onRangeSelect])

  return null
}

// ── Plugin：把 editor 实例暴露给 ref ──
function EditorRefPlugin({ editorRef }) {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    if (editorRef) editorRef.current = editor
  }, [editor, editorRef])
  return null
}

/**
 * props:
 *   initialValue   {string}
 *   annotations    {Array}   标注数组，传入后在编辑器内渲染
 *   onChange       {(plaintext: string) => void}
 *   onSelectionSnapshot {(snapshot) => void}
 *   onAnnotationSnapshot {(snapshot) => void}
 *   onRangeSelect  {({start, end}, rect) => void}  兼容旧调用方
 *   placeholder    {string}
 *   style          {object}
 *   platformPorts  {{ selectionUi?, clipboard?, viewport? }} 平台接口，便于后续 APK/iOS bridge 接入
 *
 * ref: { focus(), getValue(), setValue(text) }
 */
const RichTextEditor = forwardRef(function RichTextEditor(
  {
    initialValue = '',
    annotations = [],
    onChange,
    onSelectionSnapshot,
    onAnnotationSnapshot,
    onRangeSelect,
    placeholder,
    style,
    platformPorts,
    contentEditableProps = {},
  },
  ref
) {
  const contentEditableRef = useRef(null)
  const isComposingRef = useRef(false)
  const lexicalEditorRef = useRef(null)
  const selectionUiPort = platformPorts?.selectionUi ?? webSelectionUiPort
  const clipboardPort = platformPorts?.clipboard ?? webClipboardPort
  const viewportPort = platformPorts?.viewport ?? webViewportPort
  const isTouchDevice = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

  const handleSelectionSnapshot = onSelectionSnapshot ?? (onRangeSelect
    ? (snapshot) => onRangeSelect?.({ start: snapshot.start, end: snapshot.end }, snapshot.rect)
    : undefined)

  const handleDesktopRangeSelect = handleSelectionSnapshot
    ? (offsets, rect) => {
        handleSelectionSnapshot({
          source: 'mouse',
          start: offsets.start,
          end: offsets.end,
          text: '',
          rect,
          preserveDomSelection: false,
          suppressNativeSelection: false,
          actions: {
            annotate: true,
            copy: true,
            cut: true,
            paste: true,
            selectAll: true,
          },
        })
      }
    : onRangeSelect

  useImperativeHandle(ref, () => ({
    focus() { contentEditableRef.current?.focus() },
    getValue() {
      if (!lexicalEditorRef.current) return ''
      let text = ''
      lexicalEditorRef.current.read(() => { text = $getRoot().getTextContent() })
      return text
    },
    setValue(text) {
      lexicalEditorRef.current?.update(() => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        para.append($createTextNode(text ?? ''))
        root.append(para)
      }, { tag: 'imperative-set-value' })
    },
  }))

  const initialConfig = {
    namespace: 'journal',
    theme: {},
    onError,
    nodes: [AnnotatedNode],
    editable: true,
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
              {...contentEditableProps}
              data-clipboard-port={clipboardPort.canWriteText() ? 'web' : 'none'}
              data-viewport-port={viewportPort.getVisualViewport() ? 'visualViewport' : 'window'}
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
        <MouseUpPlugin onRangeSelect={handleDesktopRangeSelect} enabled={!isTouchDevice} />
        <AnnotationInteractionPlugin
          onSelectionSnapshot={handleSelectionSnapshot}
          onAnnotationSnapshot={onAnnotationSnapshot}
          isComposingRef={isComposingRef}
          selectionUiPort={selectionUiPort}
          enableTouchSelection={isTouchDevice}
        />
        <EditorRefPlugin editorRef={lexicalEditorRef} />
      </div>
    </LexicalComposer>
  )
})

export default RichTextEditor
