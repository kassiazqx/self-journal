# 同步卡：浏览器实时语音入口移除

**状态：** 已完成  
**日期：** 2026-04-28  
**commit：** 待本次提交生成  
**分支：** `dev`

---

## 为什么删

- 用户手测发现：先手打再点语音时，原文字可能被顶掉
- 产品方向已明确偏向：
  - 上传录音
  - 上传视频
  - 再转文字
- 因此当前 Web Speech API 方案不再继续保留

---

## 本次决策

- 直接删除现有浏览器实时语音功能
- 不做“先隐藏、以后可能再开”
- 未来若做讯飞 / 上传录音 / 上传视频 / 再转文字，重新建媒体上传与转写链路

---

## 实际改动

| 文件 | 改动 |
|---|---|
| `src/pages/HomePage.jsx` | 删除麦克风按钮、语音状态、Web Speech API 调用链 |
| `src/hooks/useSpeechRecognition.js` | 删除文件 |
| `src/index.css` | 删除 `recording-pulse` 动画样式 |
| `docs/arch-context.md` | 更新真实结构、未来路线、同步日志 |

---

## 验证

已执行：

- `npm run build`

结果：

- build 通过
- 保留既有 Vite warning（大 chunk / ineffective dynamic import）

---

## 给下个 session 的一句话

如果后续做语音/视频相关功能，不要恢复旧浏览器语音按钮；直接按“媒体上传 + 转写服务”新链路设计。
