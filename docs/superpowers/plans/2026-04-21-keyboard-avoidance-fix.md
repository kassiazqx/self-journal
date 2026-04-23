# 键盘遮挡修复：AwarenessFlow + AIConversation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 AwarenessFlow（觉察卡片页）和 AIConversation（AI 对话页）打开软键盘时，底部操作栏自动上移到键盘上方，不被遮挡。

**Architecture:** 两处文件各自独立修改，均复用 `HomePage.jsx` 已有的 `visualViewport` 方案——监听 `resize`/`scroll` 事件，计算 `keyboardOffset`，将底部栏的 `bottom` 或 `paddingBottom` 动态设置为该值。

**Tech Stack:** React useState/useEffect，Web API `window.visualViewport`

**参考：** `src/pages/HomePage.jsx:183-200`（visualViewport 监听）、`src/pages/HomePage.jsx:893-900`（bottom: keyboardOffset 用法）

---

## 文件改动地图

| 文件 | 改动 |
|---|---|
| `src/components/AwarenessFlow.jsx` | 新增 `keyboardOffset` state + visualViewport useEffect；底部栏 `bottom: 0` → `bottom: keyboardOffset` |
| `src/components/AIConversation.jsx` | 新增 `keyboardOffset` state + visualViewport useEffect；外层容器加 `paddingBottom: keyboardOffset` |

---

## Task 1：AwarenessFlow.jsx — 底部按钮随键盘上移

**Files:**
- Modify: `src/components/AwarenessFlow.jsx`

### 背景

底部操作栏（切换 AI + 下一步按钮）在第 439–449 行，用 `position: 'absolute', bottom: 0`定位在组件容器底部。键盘弹起时容器高度不变，按钮被键盘盖住。

修复方式：参考 HomePage 的 `keyboardOffset` 机制——`bottom: 0` 改为 `bottom: keyboardOffset`。

- [ ] **Step 1：在现有 state 区域（第 50–54 行附近）追加 `keyboardOffset` state**

找到：
```js
  const [aiError, setAiError] = useState('')
```

在其下方追加：
```js
  const [keyboardOffset, setKeyboardOffset] = useState(0)
```

- [ ] **Step 2：在现有 useEffect 区域后插入 visualViewport 监听**

找到第 64–66 行的 useEffect（`latestStateRef` 更新）下方的空行，插入：

```js
  // ── 键盘高度监听，防止底部按钮被软键盘遮挡 ────────────────────
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    function update() {
      const navEl = document.querySelector('nav')
      const navH = navEl ? navEl.getBoundingClientRect().height : 0
      setKeyboardOffset(Math.max(0, window.innerHeight - vv.height - navH))
    }
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])
```

- [ ] **Step 3：底部栏 `bottom: 0` 改为 `bottom: keyboardOffset`，并加 transition**

找到第 439–444 行：
```js
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        padding: '8px 18px 26px',
```

替换为：
```js
      <div style={{
        position: 'absolute',
        bottom: keyboardOffset,
        left: 0,
        right: 0,
        padding: '8px 18px 26px',
        transition: 'bottom 0.1s',
```

- [ ] **Step 4：验证编译**

```bash
npm run build 2>&1 | tail -5
```

期望：无 error

- [ ] **Step 5：Commit**

```bash
git add src/components/AwarenessFlow.jsx
git commit -m "fix: 觉察卡片页底部按钮随键盘上移（visualViewport）"
```

---

## Task 2：AIConversation.jsx — 输入栏随键盘上移

**Files:**
- Modify: `src/components/AIConversation.jsx`

### 背景

外层容器第 195 行：`<div className="flex flex-col h-full bg-[#fdfaf7]">`，输入栏（第 272–290 行）在 flex 列末尾，正常流布局。键盘弹起时 `h-full` 容器高度不变，输入栏被盖住。

修复方式：对外层容器加 `paddingBottom: keyboardOffset`，让 flex 列底部缩进，输入栏自然上移；中间消息滚动区（`flex-1 overflow-y-auto`）会自动压缩吸收空间差。

- [ ] **Step 1：找到现有 state 声明区，追加 `keyboardOffset`**

在文件中找到现有 `useState` 声明（如 `const [input, setInput]` 等）下方，追加：

```js
  const [keyboardOffset, setKeyboardOffset] = useState(0)
```

- [ ] **Step 2：在现有 useEffect 后插入 visualViewport 监听**

在文件现有 `useEffect` 区块之后插入：

```js
  // ── 键盘高度监听，防止输入栏被软键盘遮挡 ────────────────────
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    function update() {
      const navEl = document.querySelector('nav')
      const navH = navEl ? navEl.getBoundingClientRect().height : 0
      setKeyboardOffset(Math.max(0, window.innerHeight - vv.height - navH))
    }
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])
```

- [ ] **Step 3：外层容器加 `paddingBottom` 和 `transition`**

找到第 195 行：
```jsx
    <div className="flex flex-col h-full bg-[#fdfaf7]">
```

替换为：
```jsx
    <div className="flex flex-col h-full bg-[#fdfaf7]" style={{ paddingBottom: keyboardOffset, transition: 'padding-bottom 0.1s' }}>
```

- [ ] **Step 4：验证编译**

```bash
npm run build 2>&1 | tail -5
```

期望：无 error

- [ ] **Step 5：Commit**

```bash
git add src/components/AIConversation.jsx
git commit -m "fix: AI 对话页输入栏随键盘上移（visualViewport）"
```

---

## Task 3：本地验收（手机端）

```bash
npm run dev
```

**验收清单（需在手机浏览器或 PWA 里测试）：**

1. 打开觉察卡片页，点击输入框弹出键盘——「切换 AI」和「下一步」按钮应浮在键盘上方，不被遮挡
2. 收起键盘后按钮回到底部，无跳动
3. 打开 AI 对话页，点击输入框——输入栏和 Send 按钮应浮在键盘上方
4. 收起键盘后输入栏回到底部，无跳动
5. 写作首页（已有效果）不受影响
