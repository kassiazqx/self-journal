# 编码经验教训（每次改代码前必读）

> 这份文档总结了深度复盘功能开发中踩过的真实 bug，每一条都有根因。改代码前读一遍，90% 的低级错误可以提前避免。

---

## 1. React 组件卸载 = 状态丢失，必须提前问"谁来保存这个状态"

**踩坑案例：** ReflectionPage 打开 AI 对话时会卸载，`currentIndex` 和 `answers` 全部丢失，返回后重置到第一张空白卡片。

**规则：**
- 任何跨页面/跨组件需要保留的状态，**在设计阶段就决定提升到哪个祖先组件**。
- 不要等到"发现丢了"再提升，代价更高。
- 判断标准：这个状态会不会因为某个用户操作导致持有它的组件卸载？如果是，就往上提。

---

## 2. React StrictMode 在开发环境会把 useEffect 跑两次

**踩坑案例：** `AIConversation` 进入页面时发起了两次 AI 请求（Gemini 免费版一分钟限额直接打满）。

**规则：**
- 凡是 useEffect 里有**副作用（API 调用、发消息、写数据库）**，必须加 ref 守卫：
  ```js
  const initDoneRef = useRef(false)
  useEffect(() => {
    if (initDoneRef.current) return
    initDoneRef.current = true
    // 真正的初始化逻辑
  }, [])
  ```
- 这不是"防止 StrictMode"，这是"副作用只做一次"的正确写法。

---

## 3. setInterval / setTimeout 里捕获的函数/变量是快照，不是最新值

**踩坑案例：** `handleError` 里设了一个 1 分钟后自动重试的 setInterval，但 `retryLastMsg` 引用的是旧的闭包版本，`msgs` 永远是空数组，导致每次都调用 `startChat()` 而不是重发消息，结果把 Gemini 每日配额全部烧光。

**规则：**
- 定时器里不要直接调用依赖 state 的函数，要么用 ref（`useRef`）持有最新值，要么不用定时器。
- 自动重试逻辑 = 高风险逻辑，要先问自己：如果这个定时器失控了，最坏会发生什么？
- 组件卸载时**必须清除**定时器（return `clearInterval`），否则定时器在后台继续运行，状态更新会打到已卸载的组件。

---

## 4. 数据库字段类型决定存储格式，存之前先查类型

**踩坑案例：** `core_needs` 在 Supabase 是 `text[]`（数组类型），但代码直接 `.update({ core_needs: value })` 传了普通字符串，Supabase 默默接受但数据错乱，没有任何报错。

**规则：**
- 存数据前，对照 DB schema 确认字段类型。
- 数组类型（`text[]`）必须传数组：`[value]` 或 `value.split('、').filter(Boolean)`。
- 不要相信"没报错就是对的"，Supabase 的类型转换有时静默失败。

---

## 5. Fire-and-forget 更新不会改变内存中的 entry 对象

**踩坑案例：** 保存 reflection answers 后，内存里的 `entry` 没有变化，下次用这个 entry 初始化新组件时拿到的是旧数据。

**规则：**
- `.update()` 只改数据库，不改 JS 内存里的对象。
- 如果后续逻辑需要用到更新后的值，必须**同时更新内存中的状态**，或者**重新从 DB fetch**。
- 流程上要问：这次更新之后，还有谁会读这个数据？他读的是内存版本还是 DB 版本？

---

## 6. 渲染条件的顺序决定"谁压着谁"

**踩坑案例：** MainLayout 先判断 `if (reflectionEntry)` 再判断 `if (aiEntry)`，导致 AI 页面永远被 ReflectionPage 压着，点 ✦ 按钮没有反应。

**规则：**
- 写多个全屏覆盖层时，画出**状态组合表格**，确认每种状态组合下展示什么：

  | reflectionEntry | aiEntry | 展示 |
  |---|---|---|
  | null | null | 主界面 |
  | 有 | null | 复盘页 |
  | 有 | 有 | AI 对话（压着复盘页） |
  | null | 有 | AI 对话 |

- 优先级高的判断**写在前面**，不要靠"感觉顺序对"。

---

## 7. 验证计划：分批验证 + 最后端到端全流程

**踩坑案例：** 多个 bug 是在"以为改好了"之后的全流程测试中才发现的，修一个地方破坏另一个地方。

**规则：**
- 每个逻辑改动完成后，先做**局部验证**（只测改动涉及的场景）。
- 所有改动完成后，做**一次完整的端到端流程**（从写日记 → 情绪标注 → 深度复盘 → AI 对话 → 返回复盘 → 保存 → 记录列表查看）。
- 不要跳过端到端，状态交互的 bug 只在完整流程下才会出现。

---

## 8. 推送时机：本地验证通过后再推，不要先推再测

**规则：**
- 顺序：实现 → 本地测试 → 用户确认 → `git push`
- 唯一例外：纯文档/注释改动，不涉及任何逻辑。
- "应该没问题"不等于"测过没问题"。

---

---

## 9. Web Crypto API 必须用可选链，不能裸调用

**踩坑案例：** `HomePage.jsx` 用 `crypto.randomUUID()` 生成 entry ID。桌面 `http://localhost` 正常，手机通过局域网 `http://192.168.x.x` 访问时抛出 TypeError，`setSaving(false)` 从未执行，按钮永远显示「…」。Vercel HTTPS 正常。

**根因：** `crypto.randomUUID()` 要求安全上下文（Secure Context）。`localhost` 被浏览器豁免，但局域网 IP 不是。

**规则：**
- 任何 `crypto.*` / `crypto.subtle.*` 调用，必须用可选链加 fallback：
  ```js
  crypto.randomUUID?.() ?? (Date.now().toString(36) + Math.random().toString(36).slice(2))
  ```
- 参考 `AwarenessFlow.jsx` 的安全写法，新增调用必须一致
- code review 不会自动发现——这类 bug 不在 diff 里，只在真机测试时暴露

---

## 10. AI 输出解析：清理正则必须删至字符串末尾，不依赖末尾锚点

**踩坑案例：** `reviewLetterService.js` 的格式C清理正则 `\[[\s\S]*"thread_name"[\s\S]*\]\s*$`，当 AI 在 `]` 后追加 ` ``` ` 时，`\]\s*$` 无法命中，JSON 原样残留在信的正文里。

**根因：** AI 输出格式不可枚举，末尾可能追加任意杂质字符。

**规则：**
- AI 输出清理正则的结尾一律用 `[\s\S]*$`，从 JSON 起点删到字符串末尾：
  ```js
  // ❌ 不安全：依赖 ] 在末尾
  .replace(/\[[\s\S]*"field"[\s\S]*\]\s*$/, '')

  // ✅ 安全：从 [ 删到末尾，无论后面跟什么
  .replace(/\[[\s\S]*"field"[\s\S]*$/, '')
  ```
- 调试日志输出**末尾**内容（JSON 在末尾），不是前500字：
  ```js
  console.warn('末尾500字:', rawOutput.slice(-500))
  ```
- 每次发现新 AI 输出格式后，立即扩展 pattern，不假设格式固定

---

*最后更新：2026-04-21*
