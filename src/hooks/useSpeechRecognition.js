import { useState, useRef, useCallback } from 'react'

// 自动加标点：每句话结束后没有标点就加上句号
function addPunctuation(text) {
  if (!text) return text
  const last = text[text.length - 1]
  const hasPunct = '。！？.!?，,、…'.includes(last)
  return hasPunct ? text : text + '。'
}

/**
 * 语音输入 Hook
 * - 点击开始，持续录音
 * - 5 秒没有说话自动停止
 * - 每句话结束自动加标点
 */
export function useSpeechRecognition() {
  const [isRecording, setIsRecording] = useState(false)
  const [isSupported] = useState(
    'webkitSpeechRecognition' in window || 'SpeechRecognition' in window
  )
  const recognitionRef = useRef(null)
  const silenceTimerRef = useRef(null)

  const clearSilenceTimer = () => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }
  }

  const startRecording = useCallback((onResult, onError, onSilenceStop) => {
    if (!isSupported) {
      onError?.('您的浏览器不支持语音输入，请使用 Chrome 或 Safari')
      return
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    const recognition = new SpeechRecognition()

    recognition.lang = 'zh-CN'
    recognition.continuous = true      // 持续录音，不自动停
    recognition.interimResults = true  // 实时中间结果
    recognition.maxAlternatives = 1

    recognition.onstart = () => {
      setIsRecording(true)
      // 启动静默检测：5 秒无声音就停止
      clearSilenceTimer()
      silenceTimerRef.current = setTimeout(() => {
        recognition.stop()
        onSilenceStop?.()
      }, 5000)
    }

    recognition.onresult = (event) => {
      // 有说话 → 重置静默计时器
      clearSilenceTimer()
      silenceTimerRef.current = setTimeout(() => {
        recognition.stop()
        onSilenceStop?.()
      }, 5000)

      let newFinal = ''
      let interim = ''

      // 只处理本次事件新增的结果
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript.trim()
        if (event.results[i].isFinal) {
          newFinal += addPunctuation(text)
        } else {
          interim += text
        }
      }

      onResult?.(newFinal, interim)
    }

    recognition.onerror = (event) => {
      clearSilenceTimer()
      setIsRecording(false)
      if (event.error === 'no-speech') {
        // 静默超时，正常停止，不报错
      } else if (event.error === 'not-allowed') {
        onError?.('请允许麦克风权限后重试')
      } else if (event.error === 'network') {
        onError?.('网络错误：语音识别需要连接 Google 服务器，在国内可能受限。建议开启 VPN 后重试，或直接使用文字输入。')
      } else if (event.error !== 'aborted') {
        onError?.(`语音识别出错：${event.error}，请重试`)
      }
    }

    recognition.onend = () => {
      clearSilenceTimer()
      setIsRecording(false)
    }

    recognitionRef.current = recognition
    // 捕获 start() 可能抛出的同步错误
    try {
      recognition.start()
    } catch (err) {
      setIsRecording(false)
      clearSilenceTimer()
      onError?.(`启动录音失败：${err.message}`)
    }
  }, [isSupported])

  const stopRecording = useCallback(() => {
    clearSilenceTimer()
    if (recognitionRef.current) {
      recognitionRef.current.stop()
      recognitionRef.current = null
    }
    setIsRecording(false)
  }, [])

  return { isRecording, isSupported, startRecording, stopRecording }
}
