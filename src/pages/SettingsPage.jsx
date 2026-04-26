import { useState, useEffect, useCallback } from 'react'
import { Key, Check, Loader2, LogOut, Lock, Pencil } from 'lucide-react'
import { getAISettings, saveAISettings, callAI } from '../lib/aiClient'
import { fetchAllEntries } from '../lib/journalService'
import { forceUpdateMemory } from '../lib/conversationService'
import { useAuth } from '../contexts/AuthContext'
import { generateLetterNow, saveUserLetterPrefs, getUserLetterPrefs } from '../lib/reviewLetterService'
import { db } from '../lib/db'
import {
  loadContacts, addContact, updateContact, deleteContact,
} from '../lib/contactsService'
import {
  loadCoreNeeds, addCoreNeed, updateCoreNeed, deleteCoreNeed,
} from '../lib/coreNeedsService'
import { exportDataJson, fetchImages, buildZip } from '../lib/exportService'

const PROVIDERS = [
  {
    id: 'gemini',
    name: 'Google Gemini',
    hint: 'AIza… 开头',
    free: true,
    howTo: '访问 aistudio.google.com → 左侧「API 密钥」→ 创建密钥（需要 VPN）',
  },
  {
    id: 'deepseek',
    name: 'Deepseek',
    hint: 'sk-… 开头',
    free: false,
    howTo: '访问 platform.deepseek.com → 注册 → API Keys → 创建密钥（国内可直接访问）',
  },
]

export default function SettingsPage() {
  const { user, signOut } = useAuth()
  const [settings, setSettings] = useState(() => getAISettings())
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null) // null | 'ok' | 'error'
  const [testMsg, setTestMsg] = useState('')
  const [saved, setSaved] = useState(false)
  const [keyUnlocked, setKeyUnlocked] = useState(false) // API Key 是否处于编辑模式
  const [includeImages, setIncludeImages] = useState(false)
  const [exportStatus, setExportStatus] = useState(null)
  // exportStatus: null | 'exporting' | 'fetching-images' | 'confirm-failed' | 'building' | 'done' | 'error'
  const [exportProgress, setExportProgress] = useState({ done: 0, total: 0 })
  const [failedImages, setFailedImages] = useState([])   // [{ path, reason }]
  const [pendingExport, setPendingExport] = useState(null) // { jsonString, okBlobs }，等用户决定后用
  const [updatingMemory, setUpdatingMemory] = useState(false)
  const [memoryUpdateMsg, setMemoryUpdateMsg] = useState('')
  const [letterPrefs, setLetterPrefs] = useState(null)  // null = 加载中，避免闪默认值
  const [countInput, setCountInput] = useState('10') // 独立字符串，允许输入过程中间状态
  const [generatingLetter, setGeneratingLetter] = useState(false)
  const [letterMsg, setLetterMsg] = useState('')

  // ── 内容大类标签管理 ──────────────────────────────────
  const [showTagManager, setShowTagManager] = useState(false)
  const [tagOptions, setTagOptions] = useState([])   // [{ id, option_value, sort_order }]
  const [newTagInput, setNewTagInput] = useState('')
  const [addingTag, setAddingTag] = useState(false)
  const [dragIndex, setDragIndex] = useState(null)
  const [editingTagId, setEditingTagId] = useState(null)    // 当前正在编辑的标签 id
  const [editingTagValue, setEditingTagValue] = useState('') // 编辑框当前值

  // 人物管理子页
  const [showPeoplePage, setShowPeoplePage]   = useState(false)
  const [contacts, setContacts]               = useState([])
  const [editingContactId, setEditingContactId] = useState(null)
  const [contactCanonicalDraft, setContactCanonicalDraft] = useState('')
  const [contactAliasesDraft, setContactAliasesDraft]   = useState('')
  const [contactGroupDraft, setContactGroupDraft]       = useState('')
  const [newContactCanonical, setNewContactCanonical]   = useState('')

  // core_needs 词库子页
  const [showNeedsPage, setShowNeedsPage]     = useState(false)
  const [coreNeeds, setCoreNeeds]             = useState([])
  const [editingNeedId, setEditingNeedId]     = useState(null)
  const [needDraft, setNeedDraft]             = useState('')
  const [newNeedInput, setNewNeedInput]       = useState('')

  const loadTagOptions = useCallback(async () => {
    const { data } = await db.from('user_options')
      .select('id, option_value, sort_order')
      .eq('user_id', user.id)
      .eq('field_name', 'content_category')
      .order('sort_order', { ascending: true })
    setTagOptions(data ?? [])
  }, [user])

  useEffect(() => {
    if (!user) return
    const timer = setTimeout(() => { loadTagOptions() }, 0)
    getUserLetterPrefs(user.id).then(prefs => {
      if (prefs) {
        setLetterPrefs(prefs)
        setCountInput(String(prefs.count_threshold ?? 10))
      }
    }).catch(() => {})
    return () => clearTimeout(timer)
  }, [user, loadTagOptions])

  async function loadContactsData() {
    const data = await loadContacts()
    setContacts(data)
  }

  async function loadCoreNeedsData() {
    const data = await loadCoreNeeds()
    setCoreNeeds(data)
  }

  function validateCoreNeedInput(val) {
    if (val.length > 20) return '词条不能超过 20 字'
    if (/["'\\n]/.test(val)) return '不能包含引号、反斜杠或换行符'
    return null
  }

  function validateContactInput(val) {
    if (val.length > 20) return '名称不能超过 20 字'
    if (/["'\\n]/.test(val)) return '不能包含引号、反斜杠或换行符'
    return null
  }

  // 触发浏览器下载
  function downloadFile(content, filename, mimeType) {
    // content 可以是 string 或 Blob（zip 用 Blob 直接传）
    const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleExportBackup() {
    const date = new Date().toISOString().slice(0, 10)
    setExportStatus('exporting')
    setFailedImages([])
    setPendingExport(null)

    try {
      // 1. 查询 8 张表
      const jsonString = await exportDataJson(user.id)

      if (!includeImages) {
        // 不含图片：直接下载 JSON
        downloadFile(jsonString, `self-journal-backup-${date}.json`, 'application/json')
        setExportStatus('done')
        setTimeout(() => setExportStatus(null), 3000)
        return
      }

      // 2. 收集所有图片路径（去重）
      const parsed = JSON.parse(jsonString)
      const allPaths = [...new Set(
        (parsed.tables.journal_entries ?? []).flatMap(e => e.image_urls ?? []).filter(Boolean)
      )]

      if (allPaths.length === 0) {
        // 无图片，直接打包
        setExportStatus('building')
        const zipBlob = await buildZip(jsonString, new Map())
        downloadFile(zipBlob, `self-journal-backup-${date}.zip`, 'application/zip')
        setExportStatus('done')
        setTimeout(() => setExportStatus(null), 3000)
        return
      }

      // 3. 下载图片（阶段 1）
      setExportStatus('fetching-images')
      setExportProgress({ done: 0, total: allPaths.length })
      const { ok, failed } = await fetchImages(allPaths, {
        onProgress: (done, total) => setExportProgress({ done, total }),
      })

      if (failed.size > 0) {
        // 有失败：暂停，等用户决定
        setFailedImages([...failed.entries()].map(([path, err]) => ({ path, reason: err.message })))
        setPendingExport({ jsonString, okBlobs: ok })
        setExportStatus('confirm-failed')
        return
      }

      // 4. 打包 zip（阶段 2，无失败）
      setExportStatus('building')
      const zipBlob = await buildZip(jsonString, ok)
      downloadFile(zipBlob, `self-journal-backup-${date}.zip`, 'application/zip')
      setExportStatus('done')
      setTimeout(() => setExportStatus(null), 3000)

    } catch (err) {
      console.error('[export]', err)
      setExportStatus('error')
    }
  }

  // 用户在失败弹窗选「继续导出（跳过失败图片）」
  async function handleContinueExport() {
    if (!pendingExport) return
    const date = new Date().toISOString().slice(0, 10)
    setExportStatus('building')
    setFailedImages([])
    try {
      const zipBlob = await buildZip(pendingExport.jsonString, pendingExport.okBlobs)
      downloadFile(zipBlob, `self-journal-backup-${date}.zip`, 'application/zip')
      setExportStatus('done')
      setTimeout(() => setExportStatus(null), 3000)
    } catch (err) {
      console.error('[export]', err)
      setExportStatus('error')
    } finally {
      setPendingExport(null)
    }
  }

  // 用户在失败弹窗选「取消并放弃本次导出」
  function handleCancelExport() {
    setPendingExport(null)
    setFailedImages([])
    setExportStatus(null)
  }

  async function handleForceUpdateMemory() {
    if (!settings.apiKey.trim()) {
      setMemoryUpdateMsg('请先配置 API Key')
      setTimeout(() => setMemoryUpdateMsg(''), 3000)
      return
    }
    setUpdatingMemory(true)
    setMemoryUpdateMsg('')
    try {
      // 取最近一条有对话的记录，用它来更新记忆；没有就只重置计数
      const { data } = await fetchAllEntries({ userId: user.id })
      const lastWithConvo = (data ?? []).reverse().find(e => Array.isArray(e.full_conversation) && e.full_conversation.length > 0)
      const visibleMsgs = lastWithConvo?.full_conversation?.filter(m => !m.hidden) ?? []
      const { error } = await forceUpdateMemory({ visibleMsgs })
      setMemoryUpdateMsg(error ? '更新失败，请重试' : '记忆已更新 ✓')
    } catch (e) {
      setMemoryUpdateMsg('更新失败：' + e.message)
    } finally {
      setUpdatingMemory(false)
      setTimeout(() => setMemoryUpdateMsg(''), 4000)
    }
  }

  const currentProvider = PROVIDERS.find(p => p.id === settings.provider)

  const handleSave = () => {
    saveAISettings(settings)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  // ── 内容大类标签：删除 ──────────────────────────────
  async function handleDeleteTag(id) {
    await db.from('user_options').delete().eq('id', id)
    loadTagOptions()
  }

  // ── 内容大类标签：新增 ──────────────────────────────
  async function handleAddTag() {
    const label = newTagInput.trim()
    if (!label) return
    const nextOrder = tagOptions.length
    const { data, error } = await db.from('user_options').insert({
      user_id: user.id,
      field_name: 'content_category',
      option_value: label,
      sort_order: nextOrder,
    }).select('id, option_value, sort_order').single()
    if (!error && data) {
      setTagOptions(prev => [...prev, data])
    }
    setNewTagInput('')
    setAddingTag(false)
  }

  // ── 内容大类标签：拖动排序（写回全量 sort_order）────
  async function handleDragReorder(fromIndex, toIndex) {
    if (fromIndex === toIndex) return
    const reordered = [...tagOptions]
    const [moved] = reordered.splice(fromIndex, 1)
    reordered.splice(toIndex, 0, moved)
    setTagOptions(reordered)
    await Promise.all(
      reordered.map((tag, i) =>
        db.from('user_options').update({ sort_order: i }).eq('id', tag.id)
      )
    )
  }

  function handleDragStart(e, index) {
    setDragIndex(index)
    e.dataTransfer.effectAllowed = 'move'
  }
  function handleDragOver(e, index) {
    e.preventDefault()
    if (dragIndex === null || dragIndex === index) return
    handleDragReorder(dragIndex, index)
    setDragIndex(index)
  }
  function handleDragEnd() {
    setDragIndex(null)
  }

  // ── 内容大类标签：重命名 + 批量回写历史 entry ──────────────
  async function handleRenameTag(tag) {
    const newValue = editingTagValue.trim()
    const oldValue = tag.option_value
    setEditingTagId(null)
    if (!newValue || newValue === oldValue) return

    // 1. 更新 user_options 显示名
    await db.from('user_options')
      .update({ option_value: newValue })
      .eq('id', tag.id)

    // 2. 批量回写所有历史 journal_entries（RPC 内部用 auth.uid()，无需传 user_id）
    await db.rpc('replace_category_tag', { p_old: oldValue, p_new: newValue })

    // 3. 刷新本地 state
    setTagOptions(prev =>
      prev.map(t => t.id === tag.id ? { ...t, option_value: newValue } : t)
    )
  }

  const handleTest = async () => {
    if (!settings.apiKey.trim()) return
    setTesting(true)
    setTestResult(null)
    setTestMsg('')
    // 先把当前填写的设置临时保存，供 callAI 读取
    saveAISettings(settings)
    try {
      const reply = await callAI(
        [{ role: 'user', content: '你好，请只回复"连接成功"四个字' }],
        '你是一个助手，严格按照用户要求回复，不要多余内容。'
      )
      setTestResult('ok')
      setTestMsg(`连接成功！AI 回复：「${reply.trim()}」`)
      // 测试成功时顺便正式保存
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setTestResult('error')
      setTestMsg(err.message)
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* 顶部 */}
      <div className="px-5 pt-5 pb-3">
        <h1 className="text-xl font-bold text-gray-800">设置</h1>
        <p className="text-sm text-gray-400 mt-0.5">AI 对话配置</p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 space-y-4">

        {/* AI 提供商选择 */}
        <div className="card">
          <p className="text-sm font-medium text-gray-600 mb-3">AI 提供商</p>
          <div className="space-y-2">
            {PROVIDERS.map(p => (
              <button
                key={p.id}
                onClick={() => { setSettings(s => ({ ...s, provider: p.id, apiKey: '' })); setKeyUnlocked(false) }}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-2xl border transition-all ${
                  settings.provider === p.id
                    ? 'border-primary-400 bg-primary-50'
                    : 'border-gray-200 bg-white'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                    settings.provider === p.id ? 'border-primary-500' : 'border-gray-300'
                  }`}>
                    {settings.provider === p.id && (
                      <div className="w-2 h-2 rounded-full bg-primary-500" />
                    )}
                  </div>
                  <div className="text-left">
                    <span className="text-sm font-medium text-gray-700">{p.name}</span>
                    {p.free && (
                      <span className="ml-2 text-xs px-1.5 py-0.5 bg-green-100 text-green-600 rounded-full">
                        免费
                      </span>
                    )}
                  </div>
                </div>
                <span className="text-xs text-gray-400">{p.hint}</span>
              </button>
            ))}
          </div>
        </div>

        {/* API Key 输入 */}
        <div className="card">
          <p className="text-sm font-medium text-gray-600 mb-1">
            {currentProvider?.name} API Key
          </p>
          <p className="text-xs text-gray-400 mb-3">
            仅保存在你的设备本地，不会上传到任何服务器
          </p>
          <div className="relative flex items-center gap-2">
            <div className="relative flex-1">
              <Key size={15} className="absolute left-3.5 top-3.5 text-gray-400" />
              <input
                type="text"
                value={keyUnlocked ? settings.apiKey : (settings.apiKey ? '••••••••••••••••' : '')}
                onChange={e => setSettings(s => ({ ...s, apiKey: e.target.value }))}
                placeholder={currentProvider?.hint || '请输入 API Key'}
                readOnly={!keyUnlocked}
                autoComplete="new-password"
                data-lpignore="true"
                data-form-type="other"
                className={`w-full pl-9 pr-4 py-3 bg-gray-50 border rounded-2xl text-sm text-gray-700 placeholder-gray-300 focus:outline-none transition-colors ${
                  keyUnlocked
                    ? 'border-primary-300 bg-white focus:border-primary-400 cursor-text'
                    : 'border-gray-200 cursor-not-allowed select-none'
                }`}
              />
            </div>
            {/* 锁 / 编辑 切换按钮 */}
            <button
              onClick={() => setKeyUnlocked(v => !v)}
              className={`flex-shrink-0 w-11 h-11 rounded-2xl border flex items-center justify-center transition-all active:scale-95 ${
                keyUnlocked
                  ? 'border-primary-300 bg-primary-50 text-primary-500'
                  : 'border-gray-200 bg-gray-50 text-gray-400'
              }`}
              title={keyUnlocked ? '锁定' : '编辑 API Key'}
            >
              {keyUnlocked ? <Pencil size={14} /> : <Lock size={14} />}
            </button>
          </div>

          {/* 如何获取 */}
          {currentProvider && (
            <p className="text-xs text-gray-400 mt-3 leading-relaxed">
              📌 {currentProvider.howTo}
            </p>
          )}
        </div>

        {/* 测试结果提示 */}
        {testResult && (
          <div className={`px-4 py-3 rounded-2xl text-sm fade-in ${
            testResult === 'ok'
              ? 'bg-green-50 text-green-700 border border-green-100'
              : 'bg-red-50 text-red-600 border border-red-100'
          }`}>
            {testMsg}
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex gap-3">
          <button
            onClick={handleTest}
            disabled={!settings.apiKey.trim() || testing}
            className="flex-1 py-3.5 border border-gray-200 bg-white rounded-2xl text-sm font-medium text-gray-600 flex items-center justify-center gap-2 disabled:opacity-40 active:scale-95 transition-all"
          >
            {testing
              ? <><Loader2 size={15} className="animate-spin" /> 测试中…</>
              : '测试连接'
            }
          </button>
          <button
            onClick={handleSave}
            disabled={!settings.apiKey.trim()}
            className={`flex-1 py-3.5 rounded-2xl text-sm font-medium flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-40 ${
              saved ? 'bg-green-500 text-white' : 'bg-primary-500 text-white'
            }`}
          >
            {saved ? <><Check size={15} /> 已保存</> : '保存'}
          </button>
        </div>

        {/* AI 记忆 */}
        <div className="card">
          <p className="text-sm font-medium text-gray-600 mb-1">个性化 AI 记忆</p>
          <p className="text-xs text-gray-400 mb-3">
            AI 每完成 20 次对话后自动更新一次记忆。你也可以立即手动更新。
          </p>
          {memoryUpdateMsg && (
            <div className={`mb-3 px-3 py-2 rounded-xl text-sm fade-in ${
              memoryUpdateMsg.includes('失败') || memoryUpdateMsg.includes('请先')
                ? 'bg-red-50 text-red-600 border border-red-100'
                : 'bg-green-50 text-green-700 border border-green-100'
            }`}>
              {memoryUpdateMsg}
            </div>
          )}
          <button
            onClick={handleForceUpdateMemory}
            disabled={updatingMemory}
            className="w-full py-3.5 border border-gray-200 bg-white rounded-2xl text-sm font-medium text-gray-600 flex items-center justify-center gap-2 disabled:opacity-40 active:scale-95 transition-all"
          >
            {updatingMemory
              ? <><Loader2 size={15} className="animate-spin" /> 更新中…</>
              : '立即更新记忆'
            }
          </button>
        </div>

        {/* 数据导出 */}
        <div className="card">
          <p className="text-sm font-medium text-gray-600 mb-1">数据导出</p>
          <p className="text-xs text-gray-400 mb-3">
            导出你的全部数据，仅在本机浏览器下载，不会上传到任何服务器
          </p>

          {/* 包含图片勾选 */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#555', marginBottom: 16, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={includeImages}
              onChange={e => setIncludeImages(e.target.checked)}
              disabled={exportStatus !== null}
            />
            包含图片（导出为 zip 格式，文件较大）
          </label>

          {/* 导出按钮 */}
          <button
            onClick={handleExportBackup}
            disabled={exportStatus !== null && exportStatus !== 'error'}
            style={{
              background: (exportStatus !== null && exportStatus !== 'error') ? '#e0dbd4' : '#c9a96e',
              color: 'white', border: 'none', borderRadius: 8,
              padding: '9px 20px', fontSize: 13, cursor: (exportStatus !== null && exportStatus !== 'error') ? 'not-allowed' : 'pointer',
            }}
          >
            {exportStatus === null || exportStatus === 'error' ? '导出备份' : '导出中…'}
          </button>

          {/* 进度 / 状态文字 */}
          {exportStatus === 'fetching-images' && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#999' }}>
              正在下载图片 {exportProgress.done} / {exportProgress.total}…
            </div>
          )}
          {exportStatus === 'building' && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#999' }}>正在打包…</div>
          )}
          {exportStatus === 'done' && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#6aaa6a' }}>✓ 已导出</div>
          )}
          {exportStatus === 'error' && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#e06c6c' }}>导出失败，请重试</div>
          )}

          {/* 图片失败确认 sheet */}
          {exportStatus === 'confirm-failed' && (
            <div style={{
              marginTop: 12, background: '#fff8f2', border: '1px solid #f0d9c8',
              borderRadius: 10, padding: '14px 16px',
            }}>
              <div style={{ fontSize: 13, color: '#c06040', fontWeight: 500, marginBottom: 8 }}>
                ⚠️ {failedImages.length} 张图片下载失败
              </div>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 12, maxHeight: 120, overflowY: 'auto' }}>
                {failedImages.map(({ path, reason }) => (
                  <div key={path} style={{ marginBottom: 4 }}>
                    · {path} — {reason}
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={handleContinueExport}
                  style={{
                    flex: 1, background: '#c9a96e', color: 'white', border: 'none',
                    borderRadius: 8, padding: '8px 0', fontSize: 12, cursor: 'pointer',
                  }}
                >
                  继续导出（跳过这 {failedImages.length} 张）
                </button>
                <button
                  onClick={handleCancelExport}
                  style={{
                    flex: 1, background: 'none', color: '#999', border: '1px solid #e0dbd4',
                    borderRadius: 8, padding: '8px 0', fontSize: 12, cursor: 'pointer',
                  }}
                >
                  取消并放弃本次导出
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ─── 自定义选项 ─── */}
        <div style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid #ede9e2' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#333', marginBottom: 14 }}>
            自定义选项
          </div>
          <button
            onClick={() => setShowTagManager(true)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              width: '100%', padding: '12px 16px', background: 'white',
              border: '1px solid #e0dbd4', borderRadius: 12, cursor: 'pointer',
            }}
          >
            <span style={{ fontSize: 14, color: '#333' }}>内容大类标签</span>
            <span style={{ fontSize: 12, color: '#bbb' }}>
              {tagOptions.length} 个标签 ›
            </span>
          </button>
        </div>

        {/* ─── 回顾信设置 ─── */}
        <div style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid #ede9e2' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#333', marginBottom: 14 }}>
            回顾信设置
          </div>

          {/* 触发方式 */}
          {letterPrefs === null ? (
            <div style={{ fontSize: 13, color: '#bbb', marginBottom: 14 }}>加载中…</div>
          ) : (<>
          {/* 选项 A：累积 N 条后自动生成 */}
          <label style={{
            display: 'flex', alignItems: 'center', gap: 8,
            fontSize: 14, color: '#333', marginBottom: 14, cursor: 'pointer',
          }}>
            <input
              type="radio"
              name="letterTrigger"
              checked={letterPrefs.type === 'count'}
              onChange={() => {
                const updated = { ...letterPrefs, type: 'count' }
                setLetterPrefs(updated)
                saveUserLetterPrefs(user.id, updated, () => {})
              }}
            />
            累积
            <input
              type="number"
              min={3}
              max={50}
              value={countInput}
              disabled={letterPrefs.type !== 'count'}
              onChange={e => setCountInput(e.target.value)}
              onBlur={() => {
                const n = Math.max(3, Math.min(50, parseInt(countInput) || 10))
                setCountInput(String(n))
                const updated = { ...letterPrefs, count_threshold: n }
                setLetterPrefs(updated)
                saveUserLetterPrefs(user.id, updated, () => {})
              }}
              style={{
                width: 48, textAlign: 'center', fontSize: 14,
                border: '1px solid #e0dbd4', borderRadius: 6,
                padding: '2px 4px', background: letterPrefs.type === 'count' ? 'white' : '#f5f3ef',
                color: letterPrefs.type === 'count' ? '#333' : '#bbb',
              }}
            />
            条情感记录后自动生成
          </label>

          {/* 选项 B：手动生成 */}
          <label style={{
            display: 'flex', alignItems: 'center', gap: 8,
            fontSize: 14, color: '#333', marginBottom: 14, cursor: 'pointer',
          }}>
            <input
              type="radio"
              name="letterTrigger"
              checked={letterPrefs.type === 'manual'}
              onChange={() => {
                const updated = { ...letterPrefs, type: 'manual' }
                setLetterPrefs(updated)
                saveUserLetterPrefs(user.id, updated, () => {})
              }}
            />
            手动生成（不自动触发）
          </label>
          </>)}

          {/* 立即生成按钮 */}
          <button
            onClick={async () => {
              setGeneratingLetter(true)
              setLetterMsg('')
              try {
                await generateLetterNow(user.id)
                setLetterMsg('✓ 已生成，去记录页查看')
              } catch (e) {
                if (e?.message === 'NO_ENTRIES') {
                  setLetterMsg('上次生成后暂无新记录，无法生成')
                } else {
                  setLetterMsg('生成失败，请稍后重试')
                }
              } finally {
                setGeneratingLetter(false)
              }
            }}
            disabled={generatingLetter}
            style={{
              marginTop: 4, fontSize: 13, color: '#888',
              border: '1px solid #e0dbd4', borderRadius: 8,
              padding: '8px 16px', background: 'none', cursor: 'pointer',
            }}
          >
            {generatingLetter ? '生成中…' : '立即生成一封回顾信'}
          </button>
          {letterMsg && (
            <div style={{ fontSize: 12, color: '#aaa', marginTop: 8 }}>
              {letterMsg}
            </div>
          )}
        </div>

        {/* 人物管理入口 */}
        <div className="border-t border-gray-100 pt-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">人物管理</p>
              <p className="text-xs text-gray-400 mt-0.5">管理联系人和识别关键词</p>
            </div>
            <button
              onClick={() => { loadContactsData(); setShowPeoplePage(true) }}
              className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
            >
              进入 ›
            </button>
          </div>
        </div>

        {/* 内心需求词库入口 */}
        <div className="border-t border-gray-100 pt-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">内心需求词库</p>
              <p className="text-xs text-gray-400 mt-0.5">管理 AI 提取时使用的词条</p>
            </div>
            <button
              onClick={() => { loadCoreNeedsData(); setShowNeedsPage(true) }}
              className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
            >
              进入 ›
            </button>
          </div>
        </div>

        {/* 分割线 */}
        <div className="border-t border-gray-100 pt-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">账号</p>
              <p className="text-xs text-gray-400 mt-0.5">{user?.email}</p>
            </div>
            <button
              onClick={signOut}
              className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 transition-colors"
            >
              <LogOut size={15} />
              退出登录
            </button>
          </div>
        </div>

      </div>

      {/* ─── 内容大类标签管理子页（全屏覆盖） ─── */}
      {showTagManager && (
        <div style={{
          position: 'absolute', inset: 0, background: '#f5f3ef',
          display: 'flex', flexDirection: 'column', zIndex: 50,
        }}>
          {/* 顶部 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 18px 12px', background: '#f5f3ef', borderBottom: '1px solid #ede9e2', flexShrink: 0 }}>
            <button onClick={() => setShowTagManager(false)}
              style={{ background: 'none', border: 'none', fontSize: 22, color: '#c9a96e', cursor: 'pointer', lineHeight: 1 }}>
              ‹
            </button>
            <span style={{ fontSize: 16, fontWeight: 600, color: '#333' }}>内容大类标签</span>
          </div>

          {/* 列表 */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 18px' }}>
            {tagOptions.map((tag, index) => (
              <div key={tag.id}
                draggable
                onDragStart={e => handleDragStart(e, index)}
                onDragOver={e => handleDragOver(e, index)}
                onDragEnd={handleDragEnd}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  background: 'white', borderRadius: 10, padding: '10px 14px',
                  marginBottom: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                  opacity: dragIndex === index ? 0.5 : 1,
                  cursor: 'grab',
                }}
              >
                <span style={{ fontSize: 16, color: '#ccc', cursor: 'grab', flexShrink: 0 }}>☰</span>

                {/* 标签名：正常展示 or 内联编辑输入框 */}
                {editingTagId === tag.id ? (
                  <input
                    autoFocus
                    value={editingTagValue}
                    onChange={e => setEditingTagValue(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleRenameTag(tag)
                      if (e.key === 'Escape') setEditingTagId(null)
                    }}
                    onBlur={() => handleRenameTag(tag)}
                    style={{ flex: 1, border: '1px solid #c9a96e', borderRadius: 20, padding: '3px 10px', fontSize: 13, outline: 'none', background: 'white', fontFamily: 'inherit' }}
                  />
                ) : (
                  <span style={{ flex: 1, fontSize: 13, color: '#333', padding: '3px 10px', background: '#f5f3ef', borderRadius: 20, display: 'inline-block' }}>
                    {tag.option_value}
                  </span>
                )}

                {/* ✎ 编辑按钮 */}
                <button
                  onClick={() => { setEditingTagId(tag.id); setEditingTagValue(tag.option_value) }}
                  style={{ flexShrink: 0, width: 26, height: 26, borderRadius: '50%', border: '1px solid #e0dbd4', background: 'white', color: '#c9a96e', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  ✎
                </button>

                {/* − 删除按钮 */}
                <button
                  onClick={() => handleDeleteTag(tag.id)}
                  style={{ flexShrink: 0, width: 26, height: 26, borderRadius: '50%', border: '1px solid #e0dbd4', background: 'white', color: '#e57373', fontSize: 16, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  −
                </button>
              </div>
            ))}

            {/* 内联新增输入框 */}
            {addingTag ? (
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <input
                  autoFocus
                  value={newTagInput}
                  onChange={e => setNewTagInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleAddTag() }}
                  placeholder="标签名称"
                  style={{ flex: 1, border: '1px solid #e0dbd4', borderRadius: 10, padding: '10px 14px', fontSize: 13, outline: 'none', background: 'white', fontFamily: 'inherit' }}
                />
                <button onClick={handleAddTag}
                  style={{ padding: '10px 16px', border: 'none', borderRadius: 10, background: '#c9a96e', color: 'white', fontSize: 13, cursor: 'pointer' }}>
                  完成
                </button>
              </div>
            ) : (
              <button onClick={() => setAddingTag(true)}
                style={{ width: '100%', marginTop: 4, padding: '11px', border: '1.5px dashed #e0dbd4', borderRadius: 10, background: 'none', color: '#c9a96e', fontSize: 13, cursor: 'pointer', textAlign: 'center' }}>
                + 添加新标签
              </button>
            )}

            <div style={{ marginTop: 16, fontSize: 12, color: '#bbb', textAlign: 'center', lineHeight: 1.6 }}>
              删除标签不影响已打过该标签的笔记记录
            </div>
          </div>
        </div>
      )}

      {/* ─── 人物管理子页 ─── */}
      {showPeoplePage && (
        <div style={{
          position: 'absolute', inset: 0, background: '#f5f3ef',
          display: 'flex', flexDirection: 'column', zIndex: 50,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 18px 12px', background: '#f5f3ef', borderBottom: '1px solid #ede9e2', flexShrink: 0 }}>
            <button onClick={() => { setShowPeoplePage(false); setEditingContactId(null) }}
              style={{ background: 'none', border: 'none', fontSize: 22, color: '#c9a96e', cursor: 'pointer', lineHeight: 1 }}>
              ‹
            </button>
            <span style={{ fontSize: 16, fontWeight: 600, color: '#333' }}>人物管理</span>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
            <div style={{ background: '#fff', borderRadius: 10, padding: '12px 14px', marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: '#aaa', marginBottom: 6 }}>＋ 新增人物</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={newContactCanonical}
                  onChange={e => setNewContactCanonical(e.target.value)}
                  placeholder="规范名称（最多 20 字）"
                  style={{ flex: 1, padding: '6px 10px', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 14 }}
                />
                <button
                  onClick={async () => {
                    const val = newContactCanonical.trim()
                    if (!val) return
                    const err = validateContactInput(val)
                    if (err) { alert(err); return }
                    await addContact(val)
                    setNewContactCanonical('')
                    await loadContactsData()
                  }}
                  style={{ padding: '6px 14px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}
                >
                  添加
                </button>
              </div>
              {newContactCanonical && validateContactInput(newContactCanonical) && (
                <div style={{ fontSize: 12, color: '#ef4444', marginTop: 4 }}>{validateContactInput(newContactCanonical)}</div>
              )}
            </div>
            {contacts.map(c => (
              <div key={c.id} style={{ background: '#fff', borderRadius: 10, marginBottom: 8, overflow: 'hidden' }}>
                {editingContactId === c.id ? (
                  <div style={{ padding: '12px 14px' }}>
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 11, color: '#aaa', marginBottom: 4 }}>规范名称</div>
                      <input
                        value={contactCanonicalDraft}
                        onChange={e => setContactCanonicalDraft(e.target.value)}
                        style={{ width: '100%', padding: '6px 10px', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' }}
                      />
                    </div>
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 11, color: '#aaa', marginBottom: 4 }}>识别关键词（空格分隔）</div>
                      <input
                        value={contactAliasesDraft}
                        onChange={e => setContactAliasesDraft(e.target.value)}
                        style={{ width: '100%', padding: '6px 10px', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' }}
                      />
                    </div>
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 11, color: '#aaa', marginBottom: 4 }}>分组（家人 / 伴侣 / 朋友 / 同事 / 其他）</div>
                      <input
                        value={contactGroupDraft}
                        onChange={e => setContactGroupDraft(e.target.value)}
                        placeholder="选填，如：家人"
                        style={{ width: '100%', padding: '6px 10px', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' }}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={async () => {
                          const aliases = contactAliasesDraft.split(/\s+/).map(s => s.trim()).filter(Boolean)
                          await updateContact(c.id, contactCanonicalDraft.trim(), aliases, contactGroupDraft.trim() || null)
                          await loadContactsData()
                          setEditingContactId(null)
                        }}
                        style={{ padding: '7px 16px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, cursor: 'pointer' }}
                      >
                        保存（级联替换历史）
                      </button>
                      <button
                        onClick={() => setEditingContactId(null)}
                        style={{ padding: '7px 14px', background: '#f3f4f6', color: '#374151', border: 'none', borderRadius: 7, fontSize: 13, cursor: 'pointer' }}
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', padding: '12px 14px', gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <span style={{ fontWeight: 600, fontSize: 14, color: '#333' }}>{c.canonical}</span>
                      {c.group_name && (
                        <span style={{ fontSize: 11, color: '#c9a96e', marginLeft: 6, background: '#fdf6ec', padding: '1px 6px', borderRadius: 4 }}>{c.group_name}</span>
                      )}
                      {c.aliases?.length > 0 && (
                        <span style={{ fontSize: 12, color: '#aaa', marginLeft: 8 }}>
                          别名：{c.aliases.join(' · ')}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => { setEditingContactId(c.id); setContactCanonicalDraft(c.canonical); setContactAliasesDraft((c.aliases || []).join(' ')); setContactGroupDraft(c.group_name ?? '') }}
                      style={{ fontSize: 12, color: '#6366f1', background: 'none', border: 'none', cursor: 'pointer' }}
                    >
                      编辑
                    </button>
                    <button
                      onClick={async () => {
                        if (!window.confirm(`删除「${c.canonical}」？已有记录里的标记保留不变。`)) return
                        await deleteContact(c.id)
                        await loadContactsData()
                      }}
                      style={{ fontSize: 12, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer' }}
                    >
                      删除
                    </button>
                  </div>
                )}
              </div>
            ))}

          </div>
        </div>
      )}

      {/* ─── core_needs 词库子页 ─── */}
      {showNeedsPage && (
        <div style={{
          position: 'absolute', inset: 0, background: '#f5f3ef',
          display: 'flex', flexDirection: 'column', zIndex: 50,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 18px 12px', background: '#f5f3ef', borderBottom: '1px solid #ede9e2', flexShrink: 0 }}>
            <button onClick={() => { setShowNeedsPage(false); setEditingNeedId(null) }}
              style={{ background: 'none', border: 'none', fontSize: 22, color: '#c9a96e', cursor: 'pointer', lineHeight: 1 }}>
              ‹
            </button>
            <span style={{ fontSize: 16, fontWeight: 600, color: '#333' }}>内心需求词库</span>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
            <div style={{ background: '#fff', borderRadius: 10, padding: '12px 14px', marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: '#aaa', marginBottom: 6 }}>＋ 新增词条</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={newNeedInput}
                  onChange={e => setNewNeedInput(e.target.value)}
                  placeholder="最多 20 字"
                  style={{ flex: 1, padding: '6px 10px', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 14 }}
                />
                <button
                  onClick={async () => {
                    const err = validateCoreNeedInput(newNeedInput.trim())
                    if (err || !newNeedInput.trim()) return
                    await addCoreNeed(newNeedInput.trim())
                    setNewNeedInput('')
                    await loadCoreNeedsData()
                  }}
                  style={{ padding: '6px 14px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}
                >
                  添加
                </button>
              </div>
              {newNeedInput && validateCoreNeedInput(newNeedInput) && (
                <div style={{ fontSize: 12, color: '#ef4444', marginTop: 4 }}>词条过长或含无效字符</div>
              )}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
              {coreNeeds.map(c => (
                <span
                  key={c.id}
                  onClick={() => {
                    setEditingNeedId(editingNeedId === c.id ? null : c.id)
                    setNeedDraft(c.option_value)
                  }}
                  style={{
                    padding: '6px 14px',
                    background: editingNeedId === c.id ? '#d8d0f0' : '#ede8f5',
                    color: '#7a6a9a', borderRadius: 99, fontSize: 14, cursor: 'pointer',
                  }}
                >
                  {c.option_value}
                </span>
              ))}
            </div>

            {editingNeedId && (() => {
              const validErr = needDraft ? validateCoreNeedInput(needDraft) : null
              return (
                <div style={{ background: '#fff', borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
                  <input
                    value={needDraft}
                    onChange={e => setNeedDraft(e.target.value)}
                    autoFocus
                    style={{ width: '100%', padding: '7px 10px', border: '1px solid #e5e7eb', borderRadius: 7, fontSize: 14, marginBottom: 4, boxSizing: 'border-box' }}
                  />
                  {validErr && <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 8 }}>词条过长或含无效字符</div>}
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button
                      disabled={!!validErr || !needDraft.trim()}
                      onClick={async () => {
                        await updateCoreNeed(editingNeedId, needDraft.trim())
                        setEditingNeedId(null)
                        await loadCoreNeedsData()
                      }}
                      style={{
                        padding: '7px 16px', background: '#6366f1', color: '#fff',
                        border: 'none', borderRadius: 7, fontSize: 13, cursor: 'pointer',
                        opacity: (!validErr && needDraft.trim()) ? 1 : 0.4,
                      }}
                    >
                      保存（级联替换历史）
                    </button>
                    <button
                      onClick={async () => {
                        if (!window.confirm('删除该词条？已有记录里的标记保留不变。')) return
                        await deleteCoreNeed(editingNeedId)
                        setEditingNeedId(null)
                        await loadCoreNeedsData()
                      }}
                      style={{ padding: '7px 14px', background: '#fee2e2', color: '#ef4444', border: 'none', borderRadius: 7, fontSize: 13, cursor: 'pointer' }}
                    >
                      删除词条
                    </button>
                  </div>
                </div>
              )
            })()}

          </div>
        </div>
      )}
    </div>
  )
}
