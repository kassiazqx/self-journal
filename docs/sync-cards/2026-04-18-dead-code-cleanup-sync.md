# 同步卡：死代码清理

> - 来源：架构审计（2026-04-18）+ 产品确认
> - 执行方：代码 session
> - 状态：✅ 已完成（2026-04-18，commit 260a5ab + 6905e6c）

---

## 执行清单

全部改完后统一 `npm run build` 通过，一个 commit 提交。

### 1. 删除 `src/lib/keywordDetection.js`（整个文件）

原有三个函数（`detectEmotions` / `detectCategories` / `detectPeople`）已被以下方案全量替代：

| 函数 | 替代方案 |
|---|---|
| `detectEmotions` | AI 提取（`conversationService` → `getExtractionPrompt`） |
| `detectCategories` | 用户手动标签 + AI 提取 |
| `detectPeople` | `contactsService.detectPeopleFromText()`（基于用户个人联系人库） |

**同步清理：** `contactsService.js` 顶部有一条孤立的 `import ... from './keywordDetection'`，一并删除。

---

### 2. 删除 `src/lib/contentAnalysis.js` 中的 `getAwarenessStartTier()`

该函数原用于根据文本内容动态决定觉察流起点。现在起点由 `templates.js` 的 `awarenessStart` 字段静态决定，函数完全未被调用。

**操作：** 先检查 `contentAnalysis.js` 是否还有其他被使用的导出——
- 如果 `getAwarenessStartTier` 是文件里唯一的函数：**删除整个文件**
- 如果还有其他被调用的函数：只删 `getAwarenessStartTier` 这一个函数

**⚠️ 执行结果：跳过。** 发现活跃调用方 `awarenessFlowState.js:93`（`import { getAwarenessStartTier }` 在第 1 行，调用在第 93 行），函数保留，未删除。同步卡原描述「函数完全未被调用」有误。

---

### 3. 删除 `src/lib/memory.js` 中三个未使用的快捷方法

```js
// 以下三个函数无任何调用方，直接删除
export function setRollingSummary() { ... }
export function setUserProfile() { ... }
export function clearMemory() { ... }
```

外部调用统一走 `updateMemory()`，这三个是没有意义的空包装。

---

### 4. `src/lib/templates.js` — 去掉两个常量的 `export`

```js
// 改前
export const TEMPLATE_BY_ID = { ... }
export const DEFAULT_TEMPLATE = 'awareness'

// 改后（去掉 export，逻辑保留，仅供文件内部 resolveTemplate() 使用）
const TEMPLATE_BY_ID = { ... }
const DEFAULT_TEMPLATE = 'awareness'
```

**⚠️ 执行结果：部分完成。** `TEMPLATE_BY_ID` export 已删除（无外部调用方）。`DEFAULT_TEMPLATE` export 必须保留：`HomePage.jsx` 第 21 行有 `import { DEFAULT_TEMPLATE } from '../lib/templates'`，同步卡原描述「两个都去掉」有误。

---

### 5. `src/lib/emotionMap.js` — 去掉 `mapToBase` 的 `export`

```js
// 改前
export function mapToBase(displayWord) { ... }

// 改后（去掉 export，仅供文件内部 mapDisplayToBase() 使用）
function mapToBase(displayWord) { ... }
```

---

### 6. `CLAUDE.md` — 清理已完成的待处理项

`待处理清单` 里有一条 `[ ] 删除 localDB.js（孤儿文件）`，该文件在 2026-04-11 阶段二实现时已删除（见 `arch-context.md §4.4`）。

将该行改为 `[x]` 或直接删除这一行。

---

## 验收

- `npm run build` 无报错
- 搜索 `keywordDetection` 在 src/ 下零命中
- 搜索 `getAwarenessStartTier` 在 src/ 下零命中
- 搜索 `setRollingSummary\|setUserProfile\|clearMemory` 在 src/ 下零命中（memory.js 内部定义也消失）
