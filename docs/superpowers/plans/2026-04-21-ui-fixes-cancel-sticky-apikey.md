# UI 小修复：取消按钮 + 顶栏固定 + API Key 自动填充

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 四处独立小修复：EditEntryPage 加回取消按钮；RecordDetail 和 ReviewLetterDetail 顶部导航栏固定不随内容滚动；SettingsPage API Key 输入框阻止浏览器自动填充。

**Architecture:** 全部改动限定在已有文件内，无新文件、无新表、无 API 变更。RecordDetail 的根本问题是外层容器没有 flex column + 内容区独立 overflow，需将滚动区收缩到内容 div；ReviewLetterDetail 同理，外层 `overflowY: 'auto'` 移到内容区。

**Tech Stack:** React inline styles，无新依赖

---

## 文件改动地图

| 文件 | 改动 |
|---|---|
| `src/pages/EditEntryPage.jsx:204-227` | 顶栏左侧加「取消」按钮（‹ 样式） |
| `src/components/RecordDetail.jsx:540-555` | 顶栏加 `position: sticky, top: 0, zIndex: 10` |
| `src/components/ReviewLetterDetail.jsx:26-43` | 外层去掉 `overflowY: 'auto'`，顶栏加 sticky，内容区加 `overflowY: 'auto'` |
| `src/pages/SettingsPage.jsx:363` | `autoComplete="off"` → `autoComplete="new-password"` |

---

## Task 1：EditEntryPage — 加回「取消」按钮

**Files:**
- Modify: `src/pages/EditEntryPage.jsx:204-227`

- [ ] **Step 1：替换顶栏**

找到第 203-227 行：
```jsx
      {/* 顶部导航 */}
      <div style={{
        padding: '12px 18px', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', background: '#faf8f4',
        borderBottom: '1px solid #ede9e2', flexShrink: 0,
      }}>
        <button
          onClick={() => setShowPicker(true)}
          style={{
            background: 'none', border: '1px solid #f0e4cc',
            borderRadius: 99, fontSize: 11,
            padding: '3px 10px', color: '#c9a96e', cursor: 'pointer',
          }}
        >
          {formatPill(editDatetime)}
        </button>
        <button onClick={handleSave} disabled={saving || isLoading}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 14, fontWeight: 500,
            color: saving || isLoading ? '#ccc' : saveError ? '#e05252' : '#c9a96e',
          }}>
          {saving ? '保存中…' : saveError ? '保存失败，重试' : '保存'}
        </button>
      </div>
```

替换为：
```jsx
      {/* 顶部导航 */}
      <div style={{
        padding: '12px 18px', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', background: '#faf8f4',
        borderBottom: '1px solid #ede9e2', flexShrink: 0,
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <button
          onClick={onBack}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 14, color: '#bbb', padding: '6px 8px', margin: '-6px -8px',
          }}
        >
          取消
        </button>
        <button
          onClick={() => setShowPicker(true)}
          style={{
            background: 'none', border: '1px solid #f0e4cc',
            borderRadius: 99, fontSize: 11,
            padding: '3px 10px', color: '#c9a96e', cursor: 'pointer',
          }}
        >
          {formatPill(editDatetime)}
        </button>
        <button onClick={handleSave} disabled={saving || isLoading}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 14, fontWeight: 500,
            color: saving || isLoading ? '#ccc' : saveError ? '#e05252' : '#c9a96e',
          }}>
          {saving ? '保存中…' : saveError ? '保存失败，重试' : '保存'}
        </button>
      </div>
```

（`onBack` prop 在 EditEntryPage 已有，用于返回）

- [ ] **Step 2：验证编译**

```bash
npm run build 2>&1 | tail -5
```

期望：无 error

- [ ] **Step 3：Commit**

```bash
git add src/pages/EditEntryPage.jsx
git commit -m "fix: EditEntryPage 顶栏加回取消按钮 + sticky 固定"
```

---

## Task 2：RecordDetail — 重构滚动区，顶栏 sticky

**Files:**
- Modify: `src/components/RecordDetail.jsx:503-557`

**⚠️ 架构注意：** 外层容器（第 504-511 行）有 `overflowY: 'auto'`，sticky 的参照系是最近的滚动容器，在有 overflow 的祖先元素里不起作用。必须与 Task 3 相同处理：外层去掉 `overflowY: 'auto'`，内容区加独立滚动容器。

- [ ] **Step 1：外层容器去掉 overflowY，顶栏加 sticky**

找到第 503-511 行外层容器：
```jsx
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: '#faf8f4',
      overflowY: 'auto',
      paddingBottom: 100,
    }}>
```

替换为（去掉 `overflowY` 和 `paddingBottom`）：
```jsx
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: '#faf8f4',
    }}>
```

- [ ] **Step 2：顶栏加 sticky**

找到第 540-542 行顶栏 div（紧接在「全屏图片查看」和「DatetimePicker」条件渲染块之后）：
```jsx
      {/* ── 顶部导航 ── */}
      <div style={{ padding: '12px 18px 0', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', flexShrink: 0 }}>
```

替换为：
```jsx
      {/* ── 顶部导航 ── */}
      <div style={{
        padding: '12px 18px 0', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', flexShrink: 0,
        position: 'sticky', top: 0, zIndex: 10, background: '#faf8f4',
      }}>
```

- [ ] **Step 3：顶栏结束后，内容区包进滚动容器**

找到第 556-557 行（顶栏 div 闭合之后，内容 div 开始之前）：
```jsx
      </div>

      <div style={{ padding: '16px 18px 0' }}>
```

替换为：
```jsx
      </div>

      {/* 内容区独立滚动 */}
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 100 }}>
      <div style={{ padding: '16px 18px 0' }}>
```

- [ ] **Step 4：补关闭内容滚动容器的 `</div>`**

找到组件 return 的最后两行：
```jsx
    </div>
  )
```

替换为：
```jsx
      </div>
    </div>
  )
```

（新增的 `</div>` 关闭 Step 3 加的 `flex: 1, overflowY: 'auto'` 滚动容器）

- [ ] **Step 5：验证编译**

```bash
npm run build 2>&1 | tail -5
```

期望：无 error

- [ ] **Step 6：Commit**

```bash
git add src/components/RecordDetail.jsx
git commit -m "fix: RecordDetail 顶栏 sticky 固定，overflow 移至内容区"
```

---

## Task 3：ReviewLetterDetail — 重构滚动区，顶栏 sticky

**Files:**
- Modify: `src/components/ReviewLetterDetail.jsx:26-44`

当前问题：外层 div 有 `overflowY: 'auto'`，导致顶栏跟着内容一起滚出去。需把 overflow 移到内容区，外层改为 flex column。

- [ ] **Step 1：替换外层容器 + 顶部区**

找到第 25-43 行：
```jsx
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: '#faf8f4', overflowY: 'auto', paddingBottom: 40,
    }}>

      {/* 顶部 */}
      <div style={{ padding: '12px 18px 0' }}>
        <button onClick={onBack}
          style={{
            background: 'none', border: 'none',
            color: '#bbb', cursor: 'pointer',
            fontSize: 20, fontWeight: 300,
            padding: '6px 8px', margin: '-6px -8px',
            lineHeight: 1,
          }}>
          ‹
        </button>
      </div>
```

替换为：
```jsx
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: '#faf8f4',
    }}>

      {/* 顶部 — sticky 固定 */}
      <div style={{
        padding: '12px 18px 0',
        position: 'sticky', top: 0, zIndex: 10, background: '#faf8f4',
        flexShrink: 0,
      }}>
        <button onClick={onBack}
          style={{
            background: 'none', border: 'none',
            color: '#bbb', cursor: 'pointer',
            fontSize: 20, fontWeight: 300,
            padding: '6px 8px', margin: '-6px -8px',
            lineHeight: 1,
          }}>
          ‹
        </button>
      </div>

      {/* 内容区 — 独立滚动 */}
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 40 }}>
```

同时找到组件 return 语句的最后一个闭合 `</div>`（对应外层容器），在它之前加一个 `</div>` 来关闭新增的内容区 div。

原来的结构末尾是：
```jsx
      </div>
    </div>
  )
```

改为：
```jsx
      </div>
      </div>
    </div>
  )
```

（第一个 `</div>` 关闭 `padding: '16px 18px 0'` 的内容 div，第二个关闭新增的 `flex: 1, overflowY: 'auto'` 滚动容器，第三个关闭外层 flex column）

- [ ] **Step 2：验证编译**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 3：Commit**

```bash
git add src/components/ReviewLetterDetail.jsx
git commit -m "fix: ReviewLetterDetail 顶栏 sticky 固定，overflow 移至内容区"
```

---

## Task 4：SettingsPage — API Key 阻止浏览器自动填充

**Files:**
- Modify: `src/pages/SettingsPage.jsx:363`

- [ ] **Step 1：修改 autoComplete 属性**

找到第 363 行：
```jsx
                  autoComplete="off"
```

替换为：
```jsx
                  autoComplete="new-password"
```

背景：Chrome 会忽略 `autoComplete="off"`，但会尊重 `"new-password"`（语义：这是新密码输入框，不要用已保存凭据填充），有效防止 API key 被当成账号密码保存或覆盖。

- [ ] **Step 2：验证编译**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 3：Commit**

```bash
git add src/pages/SettingsPage.jsx
git commit -m "fix: API Key 输入框改 autoComplete=new-password，阻止浏览器自动填充"
```

---

## Task 5：本地验收

```bash
npm run dev
```

**验收清单：**

1. EditEntryPage 顶栏左侧出现「取消」按钮，点击返回上一页；中间是时间 pill，右侧是「保存」
2. EditEntryPage 页面内容滚动时，顶栏固定不动
3. RecordDetail 向下滚动时，顶栏的 ‹ 按钮始终可见
4. ReviewLetterDetail 向下滚动时，顶栏的 ‹ 按钮始终可见，信的内容正常滚动
5. SettingsPage API Key 输入框解锁后输入内容，浏览器不再弹出「保存密码」提示（或测试：Chrome 设置 → 密码管理器，确认 API key 未被保存为账号密码）
