export default function EntryStatusFallback({
  status,
  onBack,
  onRetry,
  loadingText = '加载中…',
  missingText = '记录已删除或不存在',
  errorText = '加载失败，可返回或重试',
}) {
  const message =
    status === 'missing' ? missingText
      : status === 'error' ? errorText
        : loadingText

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#faf8f4',
      padding: '24px',
    }}>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        textAlign: 'center',
        maxWidth: 280,
      }}>
        <div style={{ color: '#999', fontSize: 14, lineHeight: 1.6 }}>
          {message}
        </div>

        {status !== 'loading' && (
          <div style={{ display: 'flex', gap: 10 }}>
            {typeof onBack === 'function' && (
              <button
                onClick={onBack}
                style={{
                  border: '1px solid #e0dbd4',
                  background: 'white',
                  color: '#777',
                  borderRadius: 999,
                  padding: '8px 14px',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                返回
              </button>
            )}

            {status === 'error' && typeof onRetry === 'function' && (
              <button
                onClick={onRetry}
                style={{
                  border: 'none',
                  background: '#d7c2a7',
                  color: 'white',
                  borderRadius: 999,
                  padding: '8px 14px',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                重试
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

