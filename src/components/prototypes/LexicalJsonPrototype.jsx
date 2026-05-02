import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { mergeRegister } from '@lexical/utils'
import {
  $getRoot,
  $getSelection,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  COMMAND_PRIORITY_LOW,
  FORMAT_TEXT_COMMAND,
  REDO_COMMAND,
  UNDO_COMMAND,
} from 'lexical'
import { $patchStyleText } from '@lexical/selection'
import { detectPeopleFromText } from '../../lib/contactsService'
import { inferDatetime } from '../../lib/dateUtils'
import {
  extractLexicalPrototypePlainText,
  readStoredLexicalPrototypeDoc,
  writeStoredLexicalPrototypeDoc,
} from '../../lib/prototypes/lexicalPlainText'

const COLOR_OPTIONS = [
  { label: '灰蓝', value: '#61758a' },
  { label: '暖红', value: '#b45d5d' },
  { label: '青绿', value: '#4f7c72' },
  { label: '棕金', value: '#9a6b3f' },
]

const LEXICAL_THEME = {
  paragraph: 'mb-3 last:mb-0',
  text: {
    bold: 'font-semibold',
    underline: 'underline decoration-[1.5px] decoration-slate-400 underline-offset-[3px]',
    highlight: 'bg-[#f7e58d] rounded-sm px-0.5',
  },
}

function PrototypeButton({ active = false, disabled = false, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-full border px-3 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? 'border-[#c9a96e] bg-[#f8f0e3] text-[#8b6b3f]'
          : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
      }`}
    >
      {children}
    </button>
  )
}

function PrototypeMeta({ plainText, updateKind, detectedPeople, detectedDatetime, contactsStatus }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="rounded-2xl border border-[#ede9e2] bg-[#fcfbf8] p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-[0.12em] text-gray-400">
            Plain Text
          </span>
          <span className={`text-xs ${updateKind === 'style-only' ? 'text-amber-600' : 'text-green-600'}`}>
            {updateKind === 'style-only' ? '仅样式变化' : '语义变化'}
          </span>
        </div>
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-sm leading-6 text-gray-700">
          {plainText || '（当前为空）'}
        </pre>
      </div>

      <div className="rounded-2xl border border-[#ede9e2] bg-[#fcfbf8] p-4">
        <div className="mb-2 text-xs font-medium uppercase tracking-[0.12em] text-gray-400">
          Detection
        </div>
        <div className="space-y-2 text-sm text-gray-700">
          <div>
            <span className="text-gray-400">人物识别：</span>
            {contactsStatus === 'loading'
              ? '联系人词库加载中...'
              : detectedPeople.length > 0
                ? detectedPeople.join('、')
                : '无'}
          </div>
          <div>
            <span className="text-gray-400">时间推断：</span>
            {detectedDatetime
              ? detectedDatetime.toLocaleString('zh-CN', { hour12: false })
              : '无'}
          </div>
        </div>
      </div>
    </div>
  )
}

function PrototypeJsonPreview({ json }) {
  return (
    <div className="rounded-2xl border border-[#ede9e2] bg-[#fcfbf8] p-4">
      <div className="mb-2 text-xs font-medium uppercase tracking-[0.12em] text-gray-400">
        JSON Source
      </div>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs leading-5 text-gray-700">
        {json ? JSON.stringify(json, null, 2) : 'null'}
      </pre>
    </div>
  )
}

function EditorReadyPlugin({ onReady }) {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    onReady(editor)
  }, [editor, onReady])

  return null
}

function ToolbarPlugin({ savedSnapshot, onCaptureSnapshot, editorReady }) {
  const [editor] = useLexicalComposerContext()
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  useEffect(() => {
    return mergeRegister(
      editor.registerCommand(
        CAN_UNDO_COMMAND,
        (payload) => {
          setCanUndo(payload)
          return false
        },
        COMMAND_PRIORITY_LOW
      ),
      editor.registerCommand(
        CAN_REDO_COMMAND,
        (payload) => {
          setCanRedo(payload)
          return false
        },
        COMMAND_PRIORITY_LOW
      )
    )
  }, [editor])

  const patchTextStyle = useCallback((patch) => {
    editor.update(() => {
      const selection = $getSelection()
      if (selection) {
        $patchStyleText(selection, patch)
      }
    })
  }, [editor])

  const restoreSnapshot = useCallback(() => {
    if (!savedSnapshot) return
    const parsed = editor.parseEditorState(JSON.stringify(savedSnapshot))
    editor.setEditorState(parsed)
    editor.focus()
  }, [editor, savedSnapshot])

  return (
    <div className="mb-4 flex flex-wrap gap-2">
      <PrototypeButton onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold')}>
        粗体
      </PrototypeButton>
      <PrototypeButton onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'underline')}>
        下划线
      </PrototypeButton>
      <PrototypeButton onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'highlight')}>
        单一高亮
      </PrototypeButton>
      {COLOR_OPTIONS.map((option) => (
        <PrototypeButton
          key={option.value}
          onClick={() => patchTextStyle({ color: option.value })}
        >
          <span className="inline-flex items-center gap-1">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: option.value }}
            />
            {option.label}
          </span>
        </PrototypeButton>
      ))}
      <PrototypeButton onClick={() => patchTextStyle({ color: null })}>
        清除颜色
      </PrototypeButton>
      <PrototypeButton disabled={!canUndo} onClick={() => editor.dispatchCommand(UNDO_COMMAND, undefined)}>
        撤销
      </PrototypeButton>
      <PrototypeButton disabled={!canRedo} onClick={() => editor.dispatchCommand(REDO_COMMAND, undefined)}>
        重做
      </PrototypeButton>
      <PrototypeButton disabled={!editorReady} onClick={() => onCaptureSnapshot(editor.getEditorState().toJSON())}>
        保存快照
      </PrototypeButton>
      <PrototypeButton disabled={!savedSnapshot} onClick={restoreSnapshot}>
        从快照重载
      </PrototypeButton>
    </div>
  )
}

export default function LexicalJsonPrototype({ contacts = [], contactsStatus = 'idle' }) {
  const editorRef = useRef(null)
  const lastSemanticTextRef = useRef(null)
  const [initialDoc] = useState(() => readStoredLexicalPrototypeDoc())
  const [editorJson, setEditorJson] = useState(initialDoc)
  const [savedSnapshot, setSavedSnapshot] = useState(initialDoc)
  const [plainText, setPlainText] = useState('')
  const [detectedPeople, setDetectedPeople] = useState([])
  const [detectedDatetime, setDetectedDatetime] = useState(null)
  const [updateKind, setUpdateKind] = useState('semantic')
  const [editorReady, setEditorReady] = useState(false)

  const analyzeSemanticText = useCallback((text) => {
    setDetectedPeople(detectPeopleFromText(text, contacts))
    setDetectedDatetime(inferDatetime(text))
  }, [contacts])

  const syncFromEditorState = useCallback((editorState) => {
    let nextPlainText = ''

    editorState.read(() => {
      nextPlainText = extractLexicalPrototypePlainText($getRoot())
    })

    const nextJson = editorState.toJSON()
    const semanticChanged = nextPlainText !== lastSemanticTextRef.current

    setEditorJson(nextJson)
    setPlainText(nextPlainText)
    setUpdateKind(semanticChanged ? 'semantic' : 'style-only')
    writeStoredLexicalPrototypeDoc(nextJson)

    if (semanticChanged) {
      lastSemanticTextRef.current = nextPlainText
      analyzeSemanticText(nextPlainText)
    }
  }, [analyzeSemanticText])

  const handleEditorReady = useCallback((editor) => {
    editorRef.current = editor
    setEditorReady(true)
    syncFromEditorState(editor.getEditorState())
  }, [syncFromEditorState])

  useEffect(() => {
    if (lastSemanticTextRef.current === null && plainText === '') {
      analyzeSemanticText('')
      return
    }

    if (lastSemanticTextRef.current !== null) {
      analyzeSemanticText(lastSemanticTextRef.current)
    }
  }, [analyzeSemanticText, contacts, plainText])

  const initialConfig = useMemo(() => ({
    namespace: 'LexicalJsonPrototype',
    theme: LEXICAL_THEME,
    editorState: initialDoc ? JSON.stringify(initialDoc) : undefined,
    onError(error) {
      throw error
    },
  }), [initialDoc])

  return (
    <section className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold text-gray-800">原型 A: Lexical RichTextPlugin + Lexical JSON</h3>
          <span className="rounded-full bg-[#f4ead9] px-2 py-0.5 text-[11px] text-[#8b6b3f]">
            现有栈最小升级
          </span>
        </div>
        <p className="mt-1 text-sm leading-6 text-gray-500">
          当前版本重点验证三件事：所见即所得编辑、Lexical JSON 本地持久化、以及“只改样式时不重跑现有人物/时间识别”。
        </p>
      </div>

      <div className="rounded-[28px] border border-[#ede9e2] bg-white p-4 shadow-sm">
        <LexicalComposer initialConfig={initialConfig}>
          <ToolbarPlugin
            savedSnapshot={savedSnapshot}
            onCaptureSnapshot={setSavedSnapshot}
            editorReady={editorReady}
          />
          <div className="rounded-[24px] border border-[#ede9e2] bg-[#fcfbf8] px-4 py-3">
            <RichTextPlugin
              contentEditable={
                <ContentEditable
                  className="min-h-[180px] resize-none text-[15px] leading-7 text-gray-700 outline-none"
                  aria-placeholder="在这里输入原型内容"
                  placeholder=""
                  style={{ caretColor: '#aaa' }}
                />
              }
              placeholder={
                <div className="pointer-events-none absolute text-sm text-gray-300">
                  在这里写几段内容，试试加粗、高亮、下划线和颜色
                </div>
              }
              ErrorBoundary={LexicalErrorBoundary}
            />
            <HistoryPlugin />
            <OnChangePlugin
              ignoreSelectionChange
              onChange={syncFromEditorState}
            />
            <EditorReadyPlugin onReady={handleEditorReady} />
          </div>
        </LexicalComposer>
      </div>

      <PrototypeMeta
        plainText={plainText}
        updateKind={updateKind}
        detectedPeople={detectedPeople}
        detectedDatetime={detectedDatetime}
        contactsStatus={contactsStatus}
      />

      <PrototypeJsonPreview json={editorJson} />
    </section>
  )
}
