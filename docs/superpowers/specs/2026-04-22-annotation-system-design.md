# 富文本标注系统设计

**日期：** 2026-04-22
**状态：** ✅ 设计确认

---

## 一、目标

在日记详情、回顾信、脉络分析等阅读场景中，支持用户对文字进行加粗、高亮、下划线标注，提升内容可读性和个人化程度。AI 生成的内容（回顾信、脉络分析「此刻这里」）在生成时自动预标注重点，用户可在阅读时自由增改。

---

## 二、标注类型与颜色系统

### 标注类型（三种）

| 类型 | 表现 | 颜色 |
|---|---|---|
| **加粗** | font-weight: 700 | 固定黑色，无颜色选择 |
| **高亮** | SVG 手写笔刷效果，文字底层 | 活动色（四选一） |
| **下划线** | SVG 波浪线，文字正下方 | 活动色（四选一） |

### 莫兰迪四色（默认值）

| 名称 | 颜色值 | 用途 |
|---|---|---|
| 暖米 | `#C8A87A` | 默认，用于 AI 预标注高亮 |
| 藕粉 | `#C4A0A2` | — |
| 雾绿 | `#8DB0A4` | — |
| 灰蓝 | `#8FAABC` | 默认，用于 AI 预标注下划线 |

**架构注意：** 四色值从配置读取，不写死在组件里，为未来用户自定义颜色留口：

```js
// src/lib/annotationConfig.js（新建）
export const DEFAULT_ANNOTATION_COLORS = [
  { id: 'straw', label: '暖米', hex: '#C8A87A' },
  { id: 'pink',  label: '藕粉', hex: '#C4A0A2' },
  { id: 'sage',  label: '雾绿', hex: '#8DB0A4' },
  { id: 'slate', label: '灰蓝', hex: '#8FAABC' },
]
```

未来扩展：`user_preferences.annotation_colors` 字段覆盖此默认值，整个 app 主题色（背景、字体、色块）统一走同一 preference 架构。

---

## 三、用户操作

### 长按触发弹出菜单

用户长按选中文字后，在选区上方弹出自定义浮层菜单（不依赖系统原生菜单）：

```
┌─────────────────────────────────────────┐
│  B  │  U  │  ▌  │  🟤  │  🌸  │  🌿  │  🔵  │
└─────────────────────────────────────────┘
    ▼（箭头指向选中文字）
```

- **B**：加粗，点击即生效，无颜色选项
- **U**：下划线，使用当前活动色
- **▌**：高亮，使用当前活动色
- **四色点**：切换活动色，切换后立即生效于上一次操作（或下一次操作）

### 取消标注

再次长按已标注文字 → 弹出菜单出现「清除」选项，移除该处标注。

### 活动色记忆

活动色存 `localStorage`，同一用户下次打开仍保留上次选的颜色。

---

## 四、标注的适用范围

| 内容 | 用户可标注 | AI 预标注 |
|---|---|---|
| 日记原文（`journal_entries.content`） | ✅ | ❌（用户自己写的，AI 不代劳） |
| 回顾信（`review_letters.content`） | ✅ | ✅（生成时自动） |
| 脉络分析「此刻这里」（`threads.current_state`） | ✅ | ✅（生成时自动） |
| 脉络「一些碎片」（`threads.fragments`） | ❌ | ❌（碎片本身已是精华，不再标注） |
| 觉察卡片答案（`current_thought` 等字段） | Phase 2 | ❌ |

---

## 五、数据模型

### 核心设计原则

标注以 **JSON 数组** 存储，独立于文本内容字段，保持 `content` / `current_state` 等字段的纯文本，供 AI 直接读取时无需 strip 格式标记。

### 标注数据结构

```ts
type AnnotationColor = 'straw' | 'pink' | 'sage' | 'slate'
type AnnotationType = 'bold' | 'highlight' | 'underline'

interface Annotation {
  type: AnnotationType
  start: number       // 相对于纯文本的字符偏移（UTF-16 单位）
  end: number         // 不含 end
  color?: AnnotationColor  // bold 时为 undefined
}

type AnnotationList = Annotation[]
```

示例：
```json
[
  { "type": "bold",      "start": 12, "end": 18 },
  { "type": "highlight", "start": 12, "end": 18, "color": "straw" },
  { "type": "underline", "start": 45, "end": 60, "color": "slate" }
]
```

### DB 字段扩展

| 表 | 新增字段 | 类型 | 说明 |
|---|---|---|---|
| `journal_entries` | `annotations` | `jsonb` | 用户对日记原文的标注 |
| `review_letters` | `annotations` | `jsonb` | AI 预标注 + 用户追加 |
| `threads` | `current_state_annotations` | `jsonb` | AI 预标注 + 用户追加 |

> 觉察卡片字段（`current_thought` 等）的标注留待 Phase 2，届时视情况新增对应 `annotations_*` 字段或统一进 `annotations jsonb`（用 `field` 键区分）。

---

## 六、AI 预标注

### 触发时机

- **回顾信**：生成完成写入 DB 时，同步写入 `annotations` 字段
- **脉络分析**：`generateThreadAnalysis` 写入 `current_state` 时，同步写入 `current_state_annotations`

### AI 输出格式

在 prompt 末尾加指令，要求 AI 在正文后附加标注 JSON：

```
写完后，在文字末尾附上标注指令（JSON，不要解释）：
{"annotations":[{"type":"bold","start":N,"end":N},{"type":"highlight","color":"straw","start":N,"end":N}]}
规则：
- 加粗（bold）：最值得用户注意的词或短句，不超过 3 处
- 高亮（highlight，straw 色）：最想让用户停留感受的一句话，最多 1 处
- start/end 是纯文本字符偏移，从 0 开始
```

### 解析与存储

接收 AI 输出后：
1. 用正则提取末尾 `{"annotations":[...]}` JSON
2. 从正文中去掉这段 JSON
3. 验证 start/end 合法（在文本范围内、start < end）
4. 写入 DB

---

## 七、渲染方案

### 渲染组件：`AnnotatedText`

新建 `src/components/AnnotatedText.jsx`，接收 `text` 和 `annotations`，输出带标注的内联渲染。

渲染逻辑：
1. 将 `annotations` 按 `start` 排序，处理重叠（允许 bold + highlight 叠加，先画 highlight SVG，再画 bold 文字）
2. 将纯文本切分为若干片段：`[{text, annotations[]}]`
3. 每个片段：高亮/下划线用 SVG path（`preserveAspectRatio="none"` 自动拉伸），加粗用 `font-weight: 700`

### SVG 高亮效果

- 单位坐标系（0–1），`preserveAspectRatio="none"` 自动适应任意宽度
- 上下边缘：贝塞尔曲线，每 15% 一个锚点，轻微抖动
- 渐变：起止端 opacity 0.82，中段 0.40（模拟笔头停顿积墨）
- 每条轻微随机旋转 ±0.4°（组件 mount 时用 `useMemo` 生成，避免每次 render 变化）

---

## 八、编辑态交互

### `useAnnotations` Hook（新建）

`src/hooks/useAnnotations.js`，封装：
- `annotations` state
- `addAnnotation(type, color, start, end)`
- `removeAnnotation(index)`
- `activeColor` state + `setActiveColor`（持久化到 localStorage）
- `dirty`：是否有未保存的变更

### 长按事件处理

- 用 `onMouseUp` / `onTouchEnd` 捕获选区
- `window.getSelection()` 获取选中范围 → 转为相对于纯文本的 `start/end`
- 显示弹出菜单（绝对定位 div，定位到选区上方）
- 用户点击操作 → 调用 `addAnnotation`

### 保存时机

标注变更后自动 debounce 1.5 秒保存到 DB（`PATCH annotations` 字段），不需要用户手动点保存。

---

## 九、边界情况

| 情况 | 处理方式 |
|---|---|
| 用户编辑了已有标注的日记原文 | **保存编辑内容时**清空 `annotations: null`（`updateEntry` 同时写入），不在进入编辑模式时清空（防止用户点取消后标注永久丢失） |
| AI 标注的 start/end 超出文本范围 | 解析时过滤掉非法标注，不报错 |
| 多条标注重叠 | 允许；渲染时 highlight 在最下层，bold 在最上层 |
| 归档脉络的标注 | 只读展示，不可新增/修改 |

---

## 十、分期计划

**Phase 1（本 spec 范围）：**
- 日记详情页：用户手动标注 `content`
- 回顾信：AI 预标注 + 用户修改
- 脉络「此刻这里」：AI 预标注 + 用户修改
- `AnnotatedText` 组件 + `useAnnotations` hook

**Phase 2（后续独立 spec）：**
- 觉察卡片答案字段的标注
- 设置页颜色自定义（`user_preferences.annotation_colors`）
- 全 app 主题色系统（背景/字体/色块统一走 preference 架构）

---

## 十一、成功标准

1. 日记详情页长按选中文字，弹出 B / U / ▌ / 四色点菜单
2. 点加粗 → 文字变粗；点高亮 → 文字底部出现手写高亮效果；点下划线 → 文字下方出现波浪线
3. 切换颜色点 → 活动色更新，下一次操作使用新色
4. 关闭再打开页面，标注持久保留
5. 生成回顾信后打开，AI 预标注的加粗和高亮已经在信里可见
6. 在回顾信上长按，可追加自己的标注
7. AI 读取日记 `content` 字段时，拿到的是纯文本，不含任何标注标记
8. 标注的颜色值从 `annotationConfig.js` 读取，未来替换颜色只需改配置文件
