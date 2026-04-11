import { useState, useEffect } from 'react'
import { Key, Check, Loader2, LogOut, Lock, Pencil, Download } from 'lucide-react'
import { getAISettings, saveAISettings, callAI } from '../lib/aiClient'
import { fetchAllEntries } from '../lib/journalService'
import { forceUpdateMemory } from '../lib/conversationService'
import { useAuth } from '../contexts/AuthContext'
import { generateLetterNow, saveUserLetterPrefs } from '../lib/reviewLetterService'
import { updateMemory } from '../lib/memory'

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
  const [settings, setSettings] = useState({ provider: 'gemini', apiKey: '' })
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null) // null | 'ok' | 'error'
  const [testMsg, setTestMsg] = useState('')
  const [saved, setSaved] = useState(false)
  const [keyUnlocked, setKeyUnlocked] = useState(false) // API Key 是否处于编辑模式
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [updatingMemory, setUpdatingMemory] = useState(false)
  const [memoryUpdateMsg, setMemoryUpdateMsg] = useState('')
  const [letterPrefs, setLetterPrefs] = useState({
    type: 'count', count_threshold: 10, day_interval: 7, require_new_entries: true,
  })
  const [generatingLetter, setGeneratingLetter] = useState(false)
  const [letterMsg, setLetterMsg] = useState('')

  // 触发浏览器下载
  function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleExport(format) {
    setExporting(true)
    setExportError('')
    try {
      const { data, error } = await fetchAllEntries({ userId: user.id })
      if (error) throw error

      const date = new Date().toISOString().slice(0, 10)

      if (format === 'json') {
        downloadFile(
          JSON.stringify(data, null, 2),
          `self-journal-${date}.json`,
          'application/json'
        )
      } else {
        const lines = data.map(e => {
          const d = new Date(e.created_at).toLocaleString('zh-CN')
          const emotions = e.emotions?.length ? `情绪：${e.emotions.join('、')}\n` : ''
          const insight = e.reflection_insight ? `洞见：${e.reflection_insight}\n` : ''
          return `【${d}】\n${e.content}\n${emotions}${insight}`
        })
        downloadFile(
          lines.join('\n---\n\n'),
          `self-journal-${date}.txt`,
          'text/plain;charset=utf-8'
        )
      }
    } catch (err) {
      setExportError('导出失败：' + err.message)
    } finally {
      setExporting(false)
    }
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

  useEffect(() => {
    setSettings(getAISettings())
  }, [])

  const currentProvider = PROVIDERS.find(p => p.id === settings.provider)

  const handleSave = () => {
    saveAISettings(settings)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
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
                autoComplete="off"
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
            导出你的全部日记记录，仅在本机浏览器下载，不会上传到任何服务器
          </p>

          {exportError && (
            <div className="mb-3 px-3 py-2 rounded-xl text-sm bg-red-50 text-red-600 border border-red-100 fade-in">
              {exportError}
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => handleExport('json')}
              disabled={exporting}
              className="flex-1 py-3.5 border border-gray-200 bg-white rounded-2xl text-sm font-medium text-gray-600 flex items-center justify-center gap-2 disabled:opacity-40 active:scale-95 transition-all"
            >
              {exporting
                ? <><Loader2 size={15} className="animate-spin" /> 导出中…</>
                : <><Download size={15} /> 导出 JSON</>
              }
            </button>
            <button
              onClick={() => handleExport('txt')}
              disabled={exporting}
              className="flex-1 py-3.5 rounded-2xl text-sm font-medium bg-primary-500 text-white flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-40"
            >
              {exporting
                ? <><Loader2 size={15} className="animate-spin" /> 导出中…</>
                : <><Download size={15} /> 导出 TXT</>
              }
            </button>
          </div>
        </div>

        {/* ─── 回顾信设置 ─── */}
        <div style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid #ede9e2' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#333', marginBottom: 14 }}>
            回顾信设置
          </div>

          {/* 触发方式 */}
          {[
            { value: 'days',   label: `每隔 ${letterPrefs.day_interval} 天自动生成` },
            { value: 'count',  label: `累积 ${letterPrefs.count_threshold} 条情感记录后生成` },
            { value: 'manual', label: '手动生成' },
          ].map(opt => (
            <label key={opt.value} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              fontSize: 14, color: '#333', marginBottom: 12, cursor: 'pointer',
            }}>
              <input
                type="radio"
                name="letterTrigger"
                value={opt.value}
                checked={letterPrefs.type === opt.value}
                onChange={() => {
                  const updated = { ...letterPrefs, type: opt.value }
                  setLetterPrefs(updated)
                  saveUserLetterPrefs(user.id, updated, (patch) => updateMemory(user.id, patch))
                }}
              />
              {opt.label}
            </label>
          ))}

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
    </div>
  )
}
