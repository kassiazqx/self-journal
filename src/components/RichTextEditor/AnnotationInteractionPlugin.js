import { useEffect, useRef } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getNodeByKey,
  $getSelection,
  CLICK_COMMAND,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  SELECTION_CHANGE_COMMAND,
} from 'lexical'
import { AnnotatedNode } from './AnnotatedNode'
import { webSelectionUiPort } from './platformPorts'
import { createAnnotatedNodeSnapshot, createSelectionSnapshot } from './selectionSnapshot'

function normalizeInteractionSource(pointerType) {
  return pointerType === 'touch' ? 'touch' : 'mouse'
}

/**
 * 标注交互统一收口在 editor 层。
 * 这里负责三件事：
 * 1. 选区来源分流（mouse / touch / selectionchange）
 * 2. 编辑态已标注文本点击 delegation
 * 3. 输出稳定 SelectionSnapshot，页面层只消费结果
 */
export default function AnnotationInteractionPlugin({
  onSelectionSnapshot,
  onAnnotationSnapshot,
  isComposingRef,
  selectionUiPort = webSelectionUiPort,
  enableTouchSelection = false,
}) {
  const [editor] = useLexicalComposerContext()
  const selectionTimerRef = useRef(null)
  const lastInteractionSourceRef = useRef('mouse')

  useEffect(() => () => clearTimeout(selectionTimerRef.current), [])

  useEffect(() => {
    if (!enableTouchSelection || !onSelectionSnapshot) return undefined

    function handlePointerDown(event) {
      lastInteractionSourceRef.current = normalizeInteractionSource(event.pointerType)
    }

    function handleTouchStart() {
      lastInteractionSourceRef.current = 'touch'
    }

    return editor.registerRootListener((nextRoot, prevRoot) => {
      if (prevRoot) {
        prevRoot.removeEventListener('pointerdown', handlePointerDown)
        prevRoot.removeEventListener('touchstart', handleTouchStart)
      }

      if (nextRoot) {
        nextRoot.addEventListener('pointerdown', handlePointerDown)
        nextRoot.addEventListener('touchstart', handleTouchStart, { passive: true })
      }
    })
  }, [editor, enableTouchSelection, onSelectionSnapshot])

  useEffect(() => {
    if (!enableTouchSelection || !onSelectionSnapshot) return undefined

    return editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        if (isComposingRef?.current) return false
        if (lastInteractionSourceRef.current !== 'touch') return false

        clearTimeout(selectionTimerRef.current)
        selectionTimerRef.current = setTimeout(() => {
          const domSelection = selectionUiPort.getSelection()
          if (!domSelection || domSelection.rangeCount === 0) return

          const range = domSelection.getRangeAt(0)
          const rect = selectionUiPort.cloneRectFromRange(range)

          editor.read(() => {
            const snapshot = createSelectionSnapshot({
              selection: $getSelection(),
              source: 'touch',
              rect,
              suppressNativeSelection: false,
              preserveDomSelection: true,
            })
            if (snapshot) onSelectionSnapshot(snapshot)
          })
        }, 300)

        return false
      },
      COMMAND_PRIORITY_LOW
    )
  }, [editor, enableTouchSelection, onSelectionSnapshot, isComposingRef, selectionUiPort])

  useEffect(() => {
    if (!onAnnotationSnapshot) return undefined

    return editor.registerCommand(
      CLICK_COMMAND,
      (event) => {
        if (isComposingRef?.current) return false
        if (!(event.target instanceof Node)) return false

        let snapshot = null
        editor.read(() => {
          const element = event.target.nodeType === Node.ELEMENT_NODE
            ? event.target
            : event.target.parentElement
          const annotationElement = element?.closest?.('[data-annotation-node-key]')
          const nodeKey = annotationElement?.dataset?.annotationNodeKey
          if (!nodeKey) return

          const lexicalNode = $getNodeByKey(nodeKey)
          if (!(lexicalNode instanceof AnnotatedNode)) return

          const domElement =
            editor.getElementByKey(lexicalNode.getKey()) ??
            annotationElement

          snapshot = createAnnotatedNodeSnapshot({
            node: lexicalNode,
            rect: selectionUiPort.cloneRectFromElement(domElement),
            suppressNativeSelection: false,
          })
        })

        if (!snapshot) return false

        event.preventDefault()
        event.stopPropagation()
        onAnnotationSnapshot(snapshot)
        return true
      },
      COMMAND_PRIORITY_HIGH
    )
  }, [editor, onAnnotationSnapshot, isComposingRef, selectionUiPort])

  return null
}
