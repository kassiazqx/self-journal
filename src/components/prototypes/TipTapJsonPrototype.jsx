import { useCallback, useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Highlight from '@tiptap/extension-highlight'
import Color from '@tiptap/extension-color'
import Underline from '@tiptap/extension-underline'
import { TextStyle } from '@tiptap/extension-text-style'
import { detectPeopleFromText } from '../../lib/contactsService'
import { inferDatetime } from '../../lib/dateUtils'
import {
  extractTiptapPrototypePlainText,
  readStoredTiptapPrototypeDoc,
  TIPTAP_JSON_PROTOTYPE_DEFAULT_DOC,
  writeStoredTiptapPrototypeDoc,
} from '../../lib/prototypes/tiptapPlainText'

const COLOR_OPTIONS = [
  { label: '灰蓝', value: '#61758a' },
  { label: '暖红', value: '#b45d5d' },
  { label: '青绿', value: '#4f7c72' },
  { label: '棕金', value: '#9a6b3f' },
]

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

export default function TipTapJsonPrototype({ contacts = [], contactsStatus = 'idle' }) {
  const contactsRef = useRef(contacts)
  const lastSemanticTextRef = useRef(null)
  const [initialDoc] = useState(() => readStoredTiptapPrototypeDoc() ?? TIPTAP_JSON_PROTOTYPE_DEFAULT_DOC)
  const [editorJson, setEditorJson] = useState(initialDoc)
  const [savedSnapshot, setSavedSnapshot] = useState(initialDoc)
  const [plainText, setPlainText] = useState('')
  const [detectedPeople, setDetectedPeople] = useState([])
  const [detectedDatetime, setDetectedDatetime] = useState(null)
  const [updateKind, setUpdateKind] = useState('semantic')

  useEffect(() => {
    contactsRef.current = contacts
    const text = lastSemanticTextRef.current ?? plainText
    setDetectedPeople(detectPeopleFromText(text, contacts))
  }, [contacts, plainText])

  const syncFromEditor = useCallback((editor) => {
    const nextJson = editor.getJSON()
    const nextPlainText = extractTiptapPrototypePlainText(editor)
    const semanticChanged = nextPlainText !== lastSemanticTextRef.current

    setEditorJson(nextJson)
    setPlainText(nextPlainText)
    setUpdateKind(semanticChanged ? 'semantic' : 'style-only')
    writeStoredTiptapPrototypeDoc(nextJson)

    if (semanticChanged) {
      lastSemanticTextRef.current = nextPlainText
      setDetectedPeople(detectPeopleFromText(nextPlainText, contactsRef.current))
      setDetectedDatetime(inferDatetime(nextPlainText))
    }
  }, [])

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ underline: false }),
      Underline,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: false }),
    ],
    content: initialDoc,
    editorProps: {
      attributes: {
        class: 'min-h-[180px] text-[15px] leading-7 text-gray-700 outline-none [&_mark]:rounded-sm [&_mark]:bg-[#f7e58d] [&_mark]:px-0.5 [&_p]:mb-3 [&_p:last-child]:mb-0 [&_u]:decoration-[1.5px] [&_u]:decoration-slate-400 [&_u]:underline-offset-[3px]',
      },
    },
    onCreate({ editor }) {
      syncFromEditor(editor)
    },
    onUpdate({ editor }) {
      syncFromEditor(editor)
    },
  }, [])

  return (
    <section className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold text-gray-800">原型 B: TipTap + TipTap JSON</h3>
          <span className="rounded-full bg-[#e9f3ef] px-2 py-0.5 text-[11px] text-[#4f7c72]">
            官方扩展更完整
          </span>
        </div>
        <p className="mt-1 text-sm leading-6 text-gray-500">
          这个版本重点验证同一套交互在 TipTap 下的手感，尤其是颜色、高亮、回填 JSON 后的稳定性，以及中文输入时的整体顺滑度。
        </p>
      </div>

      <div className="rounded-[28px] border border-[#ede9e2] bg-white p-4 shadow-sm">
        <div className="mb-4 flex flex-wrap gap-2">
          <PrototypeButton active={editor?.isActive('bold')} disabled={!editor} onClick={() => editor?.chain().focus().toggleBold().run()}>
            粗体
          </PrototypeButton>
          <PrototypeButton active={editor?.isActive('underline')} disabled={!editor} onClick={() => editor?.chain().focus().toggleUnderline().run()}>
            下划线
          </PrototypeButton>
          <PrototypeButton active={editor?.isActive('highlight')} disabled={!editor} onClick={() => editor?.chain().focus().toggleHighlight().run()}>
            单一高亮
          </PrototypeButton>
          {COLOR_OPTIONS.map((option) => (
            <PrototypeButton
              key={option.value}
              active={editor?.isActive('textStyle', { color: option.value })}
              disabled={!editor}
              onClick={() => editor?.chain().focus().setColor(option.value).run()}
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
          <PrototypeButton disabled={!editor} onClick={() => editor?.chain().focus().unsetColor().run()}>
            清除颜色
          </PrototypeButton>
          <PrototypeButton disabled={!editor?.can().undo()} onClick={() => editor?.chain().focus().undo().run()}>
            撤销
          </PrototypeButton>
          <PrototypeButton disabled={!editor?.can().redo()} onClick={() => editor?.chain().focus().redo().run()}>
            重做
          </PrototypeButton>
          <PrototypeButton disabled={!editor} onClick={() => editor && setSavedSnapshot(editor.getJSON())}>
            保存快照
          </PrototypeButton>
          <PrototypeButton disabled={!editor || !savedSnapshot} onClick={() => editor?.commands.setContent(savedSnapshot)}>
            从快照重载
          </PrototypeButton>
        </div>

        <div className="relative rounded-[24px] border border-[#ede9e2] bg-[#fcfbf8] px-4 py-3">
          {editor?.isEmpty && (
            <div className="pointer-events-none absolute left-4 top-3 text-sm text-gray-300">
              在这里写几段内容，试试加粗、高亮、下划线和颜色
            </div>
          )}
          <EditorContent editor={editor} />
        </div>
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
