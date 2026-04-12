// src/pages/ReviewLetterListPage.jsx
// 回顾信列表页（从洞察页入口，独立页面，不占 Tab）

function formatDate(isoStr) {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  return d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
}

export default function ReviewLetterListPage({ letters = [], onBack, onOpenLetter }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%',
      background: '#f5f3ef', overflowY: 'auto' }}>

      {/* 顶部导航 */}
      <div style={{ padding: '12px 18px', display: 'flex', alignItems: 'center',
        background: '#faf8f4', borderBottom: '1px solid #ede9e2', flexShrink: 0 }}>
        <button onClick={onBack}
          style={{ background: 'none', border: 'none', color: '#bbb',
            cursor: 'pointer', fontSize: 14, marginRight: 12 }}>
          ← 返回
        </button>
        <span style={{ fontSize: 15, fontWeight: 600, color: '#333' }}>回顾信</span>
      </div>

      {/* 列表 */}
      <div style={{ padding: '16px 18px', flex: 1 }}>
        {letters.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#ccc', fontSize: 14, paddingTop: 60 }}>
            暂无回顾信
          </div>
        ) : letters.map(letter => (
          <div key={letter.id}
            onClick={() => onOpenLetter(letter)}
            style={{
              background: 'white', borderRadius: 12, padding: '14px 16px',
              marginBottom: 12, cursor: 'pointer',
              boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
              borderLeft: letter.is_read ? 'none' : '3px solid #c9a96e',
            }}>
            <div style={{ display: 'flex', alignItems: 'center',
              justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: '#888' }}>
                {formatDate(letter.created_at)}
                {letter.entry_ids?.length ? ` · ${letter.entry_ids.length}条记录` : ''}
              </span>
              {!letter.is_read && (
                <span style={{ width: 7, height: 7, borderRadius: '50%',
                  background: '#c9a96e', display: 'inline-block' }} />
              )}
            </div>
            <div style={{
              fontSize: 13, color: '#555', lineHeight: 1.65,
              display: '-webkit-box', WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}>
              {letter.content}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
