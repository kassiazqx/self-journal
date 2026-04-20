# 同步卡：UI 小批次优化

> **状态：⏳ 待实现**
> 三个独立改动，可按顺序各自提交。

---

## 涉及文件

| 文件 | 改动 |
|---|---|
| `src/pages/RecordsPage.jsx` | 回顾信改为顶部固定卡片入口 |
| `src/pages/HomePage.jsx` | 键盘弹起时底部栏自动贴键盘 |
| `src/components/RecordDetail.jsx` | 编辑入口从 header 移到原始记录流 ✎ |

---

## Task 1：RecordsPage — 回顾信改为顶部固定卡片

### 目标效果

- 时间流里**不再**渲染 `LetterCard`（信不出现在日记时间流中）
- 顶部固定一张卡片，**始终显示**：
  - 有信时：最新一封的内容节选（50字）+ 期间 + 条数 + 未读气泡
  - 无信时：提示文字，不可点击
- 点击卡片 → `onOpenLetterList(allLetters)`（已有接线，不需要新建页面）
- 同时**删除**现有的「未读回顾信横幅」（第540-556行），功能已被固定卡片覆盖

### 改动细节

**Step 1：删除时间流中的 LetterCard 渲染**

找到 `displayItems` 的构建逻辑（第209-220行附近），把 `allLetters.map(l => ({ ...l, _type: 'letter', ... }))` 这一行移除，让 `displayItems` 只包含 journal_entries。

同时在渲染 `displayItems` 的地方，把 `_type === 'letter'` 的分支删除（即删除 `<LetterCard>` 的渲染入口）。

**Step 2：删除未读横幅（第540-556行）**

删除 `{latestUnreadLetter && (...)}` 整段。

**Step 3：在滚动容器顶部加固定卡片**

在 `{/* 按日期分组的时间流 */}` 之前插入：

```jsx
{/* 回顾信固定入口卡片 */}
<div style={{ padding: '12px 16px 0' }}>
  {allLetters.length > 0 ? (
    <div
      onClick={() => onOpenLetterList(allLetters)}
      style={{
        background: '#fffdf8',
        border: '1px solid #f0e8d4',
        borderLeft: '3px solid #c9a96e',
        borderRadius: 12, padding: '12px 14px',
        marginBottom: 8, cursor: 'pointer',
        position: 'relative',
      }}
    >
      {/* 未读气泡 */}
      {allLetters.some(l => !l.is_read) && (
        <span style={{
          position: 'absolute', top: 10, right: 12,
          background: '#c9a96e', color: 'white',
          borderRadius: 10, fontSize: 10,
          padding: '1px 7px', fontWeight: 500,
        }}>
          {allLetters.filter(l => !l.is_read).length} 封未读
        </span>
      )}
      {/* 标题行 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
        <span style={{ fontSize: 12 }}>✉</span>
        <span style={{ fontSize: 11, color: '#c9a96e', fontWeight: 500 }}>回顾信</span>
        <span style={{ fontSize: 10, color: '#bbb', marginLeft: 2 }}>
          共 {allLetters.length} 封
        </span>
      </div>
      {/* 最新一封节选 */}
      <div style={{
        fontSize: 13, color: '#555', lineHeight: 1.6, marginBottom: 4,
        display: '-webkit-box', WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical', overflow: 'hidden',
      }}>
        {(allLetters[0]?.content ?? '').slice(0, 60)}
      </div>
      {/* 期间 */}
      <div style={{ fontSize: 10, color: '#bbb' }}>
        {new Date(allLetters[0]?.period_start).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}
        {' - '}
        {new Date(allLetters[0]?.period_end).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}
        {' · '}{allLetters[0]?.entry_ids?.length ?? 0} 条记录
      </div>
    </div>
  ) : (
    /* 无信时空状态 */
    <div style={{
      background: '#faf8f4', border: '1px dashed #e8e2d8',
      borderRadius: 12, padding: '12px 14px',
      marginBottom: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
        <span style={{ fontSize: 12 }}>✉</span>
        <span style={{ fontSize: 11, color: '#bbb', fontWeight: 500 }}>回顾信</span>
      </div>
      <div style={{ fontSize: 12, color: '#ccc', lineHeight: 1.6 }}>
        记录满 10 篇后自动生成第一封回顾信
      </div>
    </div>
  )}
</div>
```

**注意**：`allLetters` 已按 `period_end` 降序排列（最新在前），`allLetters[0]` 就是最新一封。`onOpenLetterList` 需要从 props 接入——检查 `RecordsPage` 的 props 中是否已有此项；若没有，需在 MainLayout 里补传。

---

## Task 2：HomePage — 键盘弹起时底部栏贴键盘

### 目标效果

写作页键盘弹起时，底部操作栏（相机 / 深度觉察 / ✓）始终贴在键盘上方，不被遮挡。键盘收起时归零。

### 改动细节

**Step 1：新增 state 和 effect**

在 `HomePage` 函数体顶部加：

```js
const [keyboardOffset, setKeyboardOffset] = useState(0)
const vvRef = useRef(null)

useEffect(() => {
  const vv = window.visualViewport
  if (!vv) return
  vvRef.current = vv

  function update() {
    const offset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
    setKeyboardOffset(offset)
  }

  vv.addEventListener('resize', update)
  vv.addEventListener('scroll', update)
  return () => {
    vv.removeEventListener('resize', update)
    vv.removeEventListener('scroll', update)
  }
}, [])
```

**Step 2：底部栏加 paddingBottom**

找到底部操作栏的外层容器（包含相机图标、深度觉察、✓ 的 div），加一行：

```jsx
style={{
  // 现有样式保持不变，新增：
  paddingBottom: keyboardOffset,
  transition: 'padding-bottom 0.1s',
}}
```

`transition` 让高度变化有轻微缓动，不会跳变。

---

## Task 3：RecordDetail — 编辑入口移到原始记录流 ✎

### 目标效果

- 删除 header 右侧「编辑」文字按钮
- 在「── 原始记录流 ──」标题行右侧加金色 ✎，点击进入 EditEntryPage

### 改动细节

**Step 1：删除 header 编辑按钮（第536-545行）**

```jsx
// 删除整段
{onEdit && (
  <button onClick={() => onEdit(entry)} style={...}>
    编辑
  </button>
)}
```

**Step 2：原始记录流标题行加 ✎**

```jsx
// 改前
<div style={{
  fontSize: 11, color: '#ccc', marginBottom: 14,
  textAlign: 'center', letterSpacing: '0.5px',
}}>
  ── 原始记录流 ──
</div>

// 改后
<div style={{
  fontSize: 11, color: '#ccc', marginBottom: 14,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  gap: 8, letterSpacing: '0.5px',
}}>
  ── 原始记录流 ──
  {onEdit && (
    <span
      onClick={() => onEdit(entry)}
      style={{ cursor: 'pointer', fontSize: 14, color: '#c9a96e', lineHeight: 1 }}
    >
      ✎
    </span>
  )}
</div>
```

---

## 验收清单

**Task 1：**
1. 记录列表顶部始终有回顾信卡片（有信/无信两种状态均正确显示）
2. 时间流里不再出现信卡片
3. 有未读信时卡片显示「N 封未读」气泡
4. 点击卡片跳转到回顾信列表页
5. 无信时卡片不可点击，显示引导文字

**Task 2：**
1. 写作页键盘弹起时底部栏贴在键盘上方
2. 键盘收起时底部栏归位，无跳变
3. 不影响无键盘时（桌面 / iPad）的布局

**Task 3：**
1. RecordDetail header 右侧「编辑」按钮消失
2. 「── 原始记录流 ──」右侧出现金色 ✎
3. 点击 ✎ 正确进入 EditEntryPage
