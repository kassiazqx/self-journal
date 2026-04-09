# Self-Journal 阶段二重设计方案（开发版）

> 这份文档是给开发者的详细蓝图。假设读者对产品有基本了解，但不一定理解每个设计决策背后的原因。每个章节都包含"要做什么"和"为什么这么做"，以及足够的细节让开发者不需要猜测。

---

## 0. 阅读指南

读这份文档的正确顺序：

1. **先读第一章**（产品定位），理解方向不走偏
2. **再读第三章**（文件清单），知道哪些动哪些不动
3. **再读第四章**（数据库变更），数据库要先于代码改
4. **按第十六章的开发步骤顺序推进**，不要跳步

每个开发步骤结束后，对照**第十八章（验收标准）**的对应条目自测，通过后再进下一步。

---

## 一、产品定位

### 核心方向（不能偏离的）

这个 App 叫"觉察日记"，**觉察 = 先看见，再理解**。不是分析工具，不是 AI 聊天室。

用户写下内容 → 被温和地引导看清楚自己 → 数据在后台默默沉淀 → 随着时间积累成洞察。

这个顺序决定了几乎所有的设计选择：

| 现在的问题 | 新的方向 |
|---|---|
| 写完被推进 AI 对话框 | 写完先给自己觉察，AI 是可选的 |
| 情绪标签是"打标"流程 | 情绪提取在后台，用户看不到过程 |
| 多个页面感觉像不同产品 | 全程同一种写作/回答界面 |
| 写一次就结束了 | 可以随时继续，也有周期回望 |

### 三层内容结构

用户感知到的只有"写"和"看"，底下分三层：

```
用户感知层
  └── 写 (Write Tab)
  └── 看 (Records Tab)

数据层
  ├── 事件流：journal_entries    每次写的原始内容 + 提取字段
  ├── 对话层：conversations      每次写作的完整问答流
  └── 回顾层：review_letters     定期的跨条目阶段性回望
```

### 四个主 Tab

```
写   记录   洞察   设置
✏️    📋     📊    ⚙️
```

写 Tab = 首页（默认），其余三个 Tab 负责回看和配置。

---

## 二、当前代码架构（读懂才能改）

### 现有文件全览

```
src/
├── main.jsx                    入口，不改
├── App.jsx                     路由，不改
├── index.css                   全局样式，不改
│
├── contexts/
│   └── AuthContext.jsx         登录状态，不改
│
├── hooks/
│   └── useSpeechRecognition.js 语音输入，不改
│
├── lib/
│   ├── supabase.js             DB客户端，不改
│   ├── aiClient.js             AI调用层，不改
│   ├── memory.js               AI跨对话记忆，不改
│   ├── journalService.js       DB CRUD，不改
│   ├── storage.js              localStorage工具，不改
│   ├── contentAnalysis.js      本地内容深度分析，小改
│   ├── keywordDetection.js     本地关键词检测，不改
│   ├── reflectionQuestions.js  现有觉察问题库，废弃（被新组件替代）
│   ├── templates.js            模板配置，改
│   ├── conversationService.js  保存对话+提取，改
│   └── prompts.js              AI系统提示词+问题库，改
│
├── pages/
│   ├── AuthPage.jsx            登录注册，不改
│   ├── HomePage.jsx            首页写作，完全重写
│   ├── RecordsPage.jsx         记录列表，改
│   ├── SettingsPage.jsx        设置，小改
│   ├── TaggingPage.jsx         情绪标注，删除（流程取消）
│   └── ReflectionPage.jsx      深度复盘，删除（被新流程替代）
│
└── components/
    ├── MainLayout.jsx           导航+状态管理，改
    ├── AIConversation.jsx       AI对话，完全重写
    └── RecordDetail.jsx         记录详情，改
```

---

## 三、本次改动全景

### 新建文件

| 文件路径 | 用途 |
|---|---|
| `src/components/AwarenessFlow.jsx` | 单屏专注觉察流（本地问题+AI接手，统一UI） |
| `src/lib/emotionMap.js` | 情绪词库 + 描述层→基础层本地映射 |
| `src/lib/reviewLetterService.js` | 回顾信触发判断 + 生成逻辑 |
| `src/components/ReviewLetterDetail.jsx` | 回顾信详情页 |
| `src/pages/InsightsPage.jsx` | 洞察 Tab 主页面 |

### 完全重写文件

| 文件路径 | 原因 |
|---|---|
| `src/pages/HomePage.jsx` | 写作页 UI 完全不同，保留部分业务逻辑 |
| `src/components/AIConversation.jsx` | 从聊天气泡改为单屏写作流 |

### 局部修改文件

| 文件路径 | 修改内容 |
|---|---|
| `src/lib/templates.js` | 更新模板定义、新增颜色值 |
| `src/lib/conversationService.js` | 存到 conversations 表；提取 emotion_display |
| `src/lib/prompts.js` | 新增回顾信生成 prompt；更新提取 prompt 加 emotion_display |
| `src/lib/contentAnalysis.js` | 新增 `getAwarenessStartTier()` 函数 |
| `src/components/MainLayout.jsx` | 新增洞察 Tab；移除 TaggingPage/ReflectionPage 调用；新增 AwarenessFlow 状态 |
| `src/pages/RecordsPage.jsx` | 卡片信息重排；穿插回顾信入口 |
| `src/components/RecordDetail.jsx` | 紧凑布局；关联信息改小标签；浮动按钮 |
| `src/pages/SettingsPage.jsx` | 新增回顾信触发偏好设置 |

### 删除文件

| 文件路径 | 原因 |
|---|---|
| `src/pages/TaggingPage.jsx` | 情绪标注流程取消，提取改后台静默 |
| `src/pages/ReflectionPage.jsx` | 复盘卡片流程被 AwarenessFlow 统一替代 |

> ⚠️ **删除前检查**：确认 MainLayout.jsx 里所有对 TaggingPage 和 ReflectionPage 的 import 和引用已清除，否则会报错。

---

## 四、数据库变更

> **必须先做这一章，再动代码。** 所有 SQL 在 Supabase SQL Editor 里执行。

### 4.1 新建 conversations 表

```sql
CREATE TABLE IF NOT EXISTS conversations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES auth.users NOT NULL,
  entry_id    uuid REFERENCES journal_entries(id) ON DELETE CASCADE,
  letter_id   uuid REFERENCES review_letters(id) ON DELETE SET NULL,
  context_type text NOT NULL CHECK (context_type IN ('entry', 'letter')),
  messages    jsonb NOT NULL DEFAULT '[]',
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_conversations_policy"
  ON conversations FOR ALL
  USING (auth.uid() = user_id);
```

`messages` 字段格式（每条消息是一个对象）：
```json
[
  { "role": "user",      "content": "今天地铁里很烦躁...",   "timestamp": "2026-04-09T09:41:00Z", "source": "raw" },
  { "role": "local",     "content": "这个感觉在身体哪里？",  "timestamp": "2026-04-09T09:42:00Z", "source": "local_question" },
  { "role": "user",      "content": "胸口有点紧...",         "timestamp": "2026-04-09T09:43:00Z", "source": "local_answer" },
  { "role": "assistant", "content": "你说\"还没到平和\"...", "timestamp": "2026-04-09T09:44:00Z", "source": "ai_question" },
  { "role": "user",      "content": "说服自己的成分多些",    "timestamp": "2026-04-09T09:45:00Z", "source": "ai_answer" }
]
```

`source` 字段枚举：`raw`（初始写作）、`local_question`、`local_answer`、`ai_question`、`ai_answer`

`context_type` 说明：
- `'entry'`：围绕某条日记的对话
- `'letter'`：围绕某封回顾信的回应对话

### 4.2 新建 review_letters 表

> ⚠️ `conversations` 表里有 `letter_id` 引用 `review_letters(id)`，所以 `review_letters` 必须先于 `conversations` 建表，或者分两步：先建不含外键的 conversations，再建 review_letters，再 ALTER TABLE conversations ADD CONSTRAINT ... 。最简单的做法：下面两段 SQL 按顺序执行。

```sql
-- 先建 review_letters（无依赖）
CREATE TABLE IF NOT EXISTS review_letters (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES auth.users NOT NULL,
  entry_ids    uuid[] NOT NULL DEFAULT '{}',
  content      text NOT NULL,
  insights     jsonb DEFAULT '{}',
  trigger_type text CHECK (trigger_type IN ('7days', '10entries', 'manual')),
  period_start timestamptz,
  period_end   timestamptz,
  is_read      boolean DEFAULT false,
  user_response text,
  created_at   timestamptz DEFAULT now()
);

ALTER TABLE review_letters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_review_letters_policy"
  ON review_letters FOR ALL
  USING (auth.uid() = user_id);
```

`insights` 字段格式：
```json
{
  "recurring_emotions": ["焦虑", "压抑"],
  "recurring_people":   ["妈妈", "小宝"],
  "core_needs":         ["被理解", "安全感"],
  "patterns":           ["遇到边界被踩时倾向于先压着，之后积压爆发"],
  "growth_notes":       ["这段时间开始主动觉察身体信号，有进步"]
}
```

### 4.3 给 journal_entries 增列

```sql
-- 情绪描述层（AI生成的丰富表达，用于展示）
ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS emotion_display text[] DEFAULT '{}';

-- 基础层映射置信度（0.0-1.0，低于0.7时在详情页提示）
ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS emotion_confidence float DEFAULT null;
```

> 说明：`emotions` 字段继续存在，作为基础层（40词标准词库的映射结果）。新增 `emotion_display` 作为描述层（更丰富自然的表达）。两者都由 AI 提取，但用途不同：`emotion_display` 用于展示，`emotions` 用于统计聚合。

### 4.4 执行顺序

1. 执行 review_letters 建表 SQL
2. 执行 conversations 建表 SQL（letter_id 外键依赖 review_letters）
3. 执行 journal_entries 增列 SQL
4. 在 Supabase Table Editor 里确认三个操作都成功（看到表/列出现了）

---

## 五、情绪词库（基础层，固定 42 词）

这 42 个词是统计口径，不随用户输入自动扩展。保存在新文件 `src/lib/emotionMap.js` 里。

### 词库分组

**负面情绪（22词）**
```
难过  愤怒  委屈  焦虑  羞愧  无力
害怕  孤独  绝望  沮丧  厌烦  烦躁
压抑  紧张  失落  嫉妒  内疚  抗拒
疲惫  麻木  不甘  崩溃
```

**正面情绪（12词）**
```
轻松  满足  感激  开心  平静  期待
温暖  喜悦  自豪  踏实  安心  充实
```

**混合/中性情绪（8词）**
```
迷茫  矛盾  好奇  纠结  释然  依恋  敏感  复杂
```

### 本地映射规则

映射逻辑：AI 提取 `emotion_display`（自然语言），系统本地映射到 `emotions`（基础层）。

```js
// src/lib/emotionMap.js

// 基础层词库（42词，完整列表）
export const EMOTION_BASE = [
  // 负面
  '难过','愤怒','委屈','焦虑','羞愧','无力','害怕','孤独','绝望','沮丧',
  '厌烦','烦躁','压抑','紧张','失落','嫉妒','内疚','抗拒','疲惫','麻木',
  '不甘','崩溃',
  // 正面
  '轻松','满足','感激','开心','平静','期待','温暖','喜悦','自豪','踏实',
  '安心','充实',
  // 混合
  '迷茫','矛盾','好奇','纠结','释然','依恋','敏感','复杂',
]

// 近义词映射表（描述层词 → 基础层词，按相似度排列）
const SYNONYM_MAP = {
  '难受':   '难过',  '伤心':   '难过',  '悲伤':   '难过',  '心疼':   '难过',
  '生气':   '愤怒',  '气愤':   '愤怒',  '愤恨':   '愤怒',  '恼火':   '愤怒',
  '委屈':   '委屈',  '心酸':   '委屈',  '不公':   '委屈',
  '担心':   '焦虑',  '不安':   '焦虑',  '忧虑':   '焦虑',  '惶恐':   '焦虑',
  '害羞':   '羞愧',  '难堪':   '羞愧',  '自责':   '羞愧',  '惭愧':   '羞愧',
  '无奈':   '无力',  '力不从心':'无力', '无法改变':'无力',
  '恐惧':   '害怕',  '慌':     '害怕',  '惊慌':   '害怕',  '害怕':   '害怕',
  '寂寞':   '孤独',  '孤立':   '孤独',  '被忽视': '孤独',
  '沮丧':   '沮丧',  '消沉':   '沮丧',  '意志消沉':'沮丧',
  '烦':     '烦躁',  '心烦':   '烦躁',  '焦躁':   '烦躁',
  '郁闷':   '压抑',  '憋屈':   '压抑',  '憋':     '压抑',
  '紧绷':   '紧张',  '绷':     '紧张',
  '失意':   '失落',  '沮丧':   '失落',
  '羡慕':   '嫉妒',
  '愧疚':   '内疚',  '后悔':   '内疚',
  '排斥':   '抗拒',  '不想':   '抗拒',
  '累':     '疲惫',  '精疲力竭':'疲惫', '筋疲力尽':'疲惫',
  '麻木':   '麻木',  '木木的': '麻木',  '没感觉': '麻木',
  '不服气': '不甘',  '心有不甘':'不甘',
  '崩了':   '崩溃',  '撑不住': '崩溃',  '绝望':   '崩溃',
  '开心':   '开心',  '快乐':   '开心',  '高兴':   '开心',
  '轻松':   '轻松',  '放松':   '轻松',
  '满足':   '满足',  '知足':   '满足',
  '感恩':   '感激',  '谢谢':   '感激',
  '安静':   '平静',  '内心平静':'平静', '淡然':   '平静',
  '好期待': '期待',  '兴奋':   '期待',  '期盼':   '期待',
  '被爱':   '温暖',  '被关心': '温暖',  '暖':     '温暖',
  '欣喜':   '喜悦',  '快乐':   '喜悦',
  '骄傲':   '自豪',
  '稳':     '踏实',  '安稳':   '踏实',
  '充实':   '充实',  '有意义': '充实',
  '迷失':   '迷茫',  '方向感': '迷茫',
  '纠结':   '纠结',  '左右为难':'纠结',
  '想通了': '释然',  '放下了': '释然',
  '好奇':   '好奇',  '感兴趣': '好奇',
}

/**
 * 把描述层的单个情绪词映射到基础层
 * @param {string} displayWord - AI生成的描述层词
 * @returns {{ baseWord: string|null, confidence: number }}
 *   confidence: 1.0=精确匹配基础词, 0.85=近义词映射, 0=未找到
 */
export function mapToBase(displayWord) {
  if (!displayWord) return { baseWord: null, confidence: 0 }

  // 1. 直接在基础层词库里
  if (EMOTION_BASE.includes(displayWord)) {
    return { baseWord: displayWord, confidence: 1.0 }
  }

  // 2. 近义词映射
  const mapped = SYNONYM_MAP[displayWord]
  if (mapped) {
    return { baseWord: mapped, confidence: 0.85 }
  }

  // 3. 包含关系（如"克制后的难受"包含"难受"）
  for (const base of EMOTION_BASE) {
    if (displayWord.includes(base)) {
      return { baseWord: base, confidence: 0.75 }
    }
  }

  // 4. 未找到
  return { baseWord: null, confidence: 0 }
}

/**
 * 把描述层数组整体映射到基础层
 * @param {string[]} displayWords
 * @returns {{ baseWords: string[], minConfidence: number }}
 */
export function mapDisplayToBase(displayWords = []) {
  if (!displayWords.length) return { baseWords: [], minConfidence: 1.0 }

  const results = displayWords.map(w => mapToBase(w))
  const baseWords = [...new Set(results.map(r => r.baseWord).filter(Boolean))]
  const minConfidence = results.length
    ? Math.min(...results.map(r => r.confidence))
    : 1.0

  return { baseWords, minConfidence }
}
```

### 低置信度的处理规则

- `minConfidence >= 0.75`：正常显示，不提示
- `minConfidence < 0.75` 且 `> 0`：在详情页情绪标签旁显示小灰字"基础标签待确认"，用户可点击手动选择
- `minConfidence === 0`（完全没映射到）：基础层留空，详情页显示"未分类"灰色标签，不影响保存

---

## 六、模板系统重设计

### 新模板配置

重写 `src/lib/templates.js`：

```js
// src/lib/templates.js

export const TEMPLATES = [
  {
    id: 'awareness',
    label: '觉察',
    color: '#c9a96e',           // 低饱和暖金，用于标签高亮、引导线、引导文字
    guide: '发生了什么 → 感受到什么 → 身体感觉',
    awarenessStart: 'emotion',  // 点✓后觉察流从情绪层开始
  },
  {
    id: 'gratitude',
    label: '感恩',
    color: '#7cb9a8',
    guide: '今天 3 件值得感恩的事 → 为什么 → 谁让我感到温暖',
    awarenessStart: 'gratitude', // 觉察流跳到感恩专属问题
  },
  {
    id: 'learning',
    label: '学习',
    color: '#8aabcc',
    guide: '学到了什么 → 为什么重要 → 想如何实践',
    awarenessStart: 'learning',
  },
  {
    id: 'freewrite',
    label: '随记',
    color: '#aaa',
    guide: '随手记下来',
    awarenessStart: null,        // 随记不进入觉察流，直接保存
  },
  {
    id: 'action',
    label: '行动',
    color: '#b8a88a',
    guide: '做了什么 → 感受如何 → 下次想怎么做',
    awarenessStart: 'action',
  },
]

export const TEMPLATE_BY_ID = Object.fromEntries(TEMPLATES.map(t => [t.id, t]))
export const DEFAULT_TEMPLATE = TEMPLATE_BY_ID['awareness']
```

> **注意**：原模板 ID 已变更（`emotion` → `awareness`，`free` → `freewrite`）。历史数据的 `template_type` 字段会出现旧 ID。需要在读取时做兼容：

```js
// 兼容旧 template_type 的映射（在需要读模板的地方使用）
const LEGACY_ID_MAP = {
  'emotion':    'awareness',
  'free':       'freewrite',
  'gratitude':  'gratitude',
  'learning':   'learning',
  'action':     'action',
}
export function resolveTemplate(id) {
  const resolved = LEGACY_ID_MAP[id] || id
  return TEMPLATE_BY_ID[resolved] || DEFAULT_TEMPLATE
}
```

---

## 七、写作页精确视觉规格

### 7.1 整体结构（从上到下）

```
┌──────────────────────────────────┐
│  9:41                    ▲▲▲ 🔋  │  ← 状态栏（系统原生，不用自己画）
├──────────────────────────────────┤
│  觉察  感恩  学习  随记  行动     │  ← 模板标签栏
│  ─────                           │  ← 引导词行（细竖线 + 文字）
├──────────────────────────────────┤
│                                  │
│  用户输入区域（占满剩余屏幕）      │
│                                  │
│  ▌（光标）                        │
│                                  │
│                                  │
├──────────────────────────────────┤
│  ✦ 深入觉察          ✓          │  ← 底部渐变浮动栏
└──────────────────────────────────┘
```

### 7.2 颜色值（精确，不要随意改动）

```css
/* 页面背景 */
--bg-screen:      #faf8f4;   /* 写作区背景，米白色 */
--bg-app:         #e5e1d8;   /* App 壳背景 */

/* 正文 */
--text-body:      #2d2d2d;   /* 正文文字 */
--text-placeholder: #d5d0c8; /* placeholder 文字 */
--cursor:         #aaa;      /* 光标颜色，不要用模板色 */

/* 模板标签 - 默认态 */
--tab-inactive:   #ccc;

/* 模板标签 - 激活态（各模板不同） */
--tab-awareness:  #c9a96e;   /* 觉察，暖金 */
--tab-gratitude:  #7cb9a8;   /* 感恩，绿 */
--tab-learning:   #8aabcc;   /* 学习，蓝 */
--tab-freewrite:  #aaa;      /* 随记，灰 */
--tab-action:     #b8a88a;   /* 行动，暖棕 */

/* 引导词竖线和文字用同一个模板色，opacity 0.5 */

/* 底部按钮 */
--btn-ai-bg:      #f0ece4;
--btn-ai-border:  #ddd8cf;
--btn-ai-icon:    #b8a88a;
--btn-done-bg:    #2d2928;
--btn-done-text:  #ffffff;
```

### 7.3 模板标签栏 CSS 规格

```css
.template-bar {
  display: flex;
  gap: 2px;
  align-items: center;
  padding: 10px 18px 0;
}

.template-tab {
  font-size: 11px;
  font-weight: 400;
  color: #ccc;             /* 默认灰色 */
  padding: 3px 7px;
  border-radius: 5px;
  white-space: nowrap;
  letter-spacing: 0.1px;
  cursor: pointer;
  /* 不要加 border、background、box-shadow */
}

.template-tab.active {
  font-weight: 500;
  /* color 由 JS 根据当前模板设置，见模板配置里的 color 字段 */
}
```

### 7.4 引导词行 CSS 规格

```css
.guide-wrap {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 18px 0;
}

.guide-line {
  width: 1.5px;
  border-radius: 1px;
  flex-shrink: 0;
  align-self: stretch;
  min-height: 16px;
  margin-top: 2px;
  opacity: 0.5;
  /* background-color 由 JS 设置为当前模板的 color */
}

.guide-text {
  font-size: 12px;
  line-height: 1.65;
  font-weight: 400;       /* 不加粗 */
  letter-spacing: 0.1px;
  /* color 由 JS 设置为当前模板的 color */
}
```

### 7.5 输入区 CSS 规格

```css
.input-area {
  flex: 1;
  padding: 14px 18px 80px;  /* 下留80px给底部按钮 */
  /* 这里用 textarea 或 contenteditable div */
}

/* 如果用 textarea */
.input-area textarea {
  width: 100%;
  height: 100%;
  border: none;
  outline: none;
  background: transparent;
  resize: none;
  font-size: 15px;
  line-height: 1.85;
  color: #2d2d2d;
  font-family: inherit;
  caret-color: #aaa;        /* 光标颜色，重要！ */
}

.input-area textarea::placeholder {
  color: #d5d0c8;
}
```

> **caret-color** 是控制浏览器原生光标颜色的 CSS 属性，设成 `#aaa` 即可，不需要用 JS 模拟光标。

### 7.6 底部栏 CSS 规格

```css
.bottom-bar {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 8px 18px 22px;   /* 下留 22px iOS 安全区 */
  background: linear-gradient(transparent, #faf8f4 38%);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

/* AI 按钮区域 */
.ai-wrap {
  display: flex;
  align-items: center;
  gap: 5px;
}

.ai-btn {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: #f0ece4;
  border: 1px solid #ddd8cf;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: #b8a88a;
}

.ai-label {
  font-size: 10px;
  color: #ccc;
}

/* 完成按钮 */
.done-btn {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: #2d2928;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: white;
  box-shadow: 0 2px 10px rgba(0,0,0,0.18);
}
```

### 7.7 模板切换行为（重要）

```
用户点击模板标签 → 只做以下事情：
  1. 更新当前激活模板的视觉（标签颜色、引导词颜色、竖线颜色）
  2. 更新引导词文字内容
  3. 记录当前 entry 的 template 字段（不入库，只在内存）

绝对不做：
  - 不清空输入框内容
  - 不重置任何已写的文字
  - 不跳转页面
  - 不做弹出框
```

---

## 八、单屏专注觉察流（AwarenessFlow）

这是本次改动最核心的新组件，路径：`src/components/AwarenessFlow.jsx`。

### 8.1 触发时机

两个入口：

1. **首页写完后点 ✓**：只有写了文字才可以点；模板是 `freewrite`（随记）直接保存，不进觉察流
2. **记录详情页点 ✦ 深度觉察**：带着已有 entry 和历史 conversation 进入

### 8.2 界面结构（单屏）

```
┌──────────────────────────────────┐
│  ← 返回        保存并退出         │  ← 顶部小导航（12px，灰色）
├──────────────────────────────────┤
│                                  │
│  [前一个问题和答案的淡色摘要]     │  ← 可选，仅显示上一轮的关键词（非必须）
│                                  │
│  当前问题文字                     │  ← 15px，#333，font-weight 500
│                                  │
├──────────────────────────────────┤
│                                  │
│  [用户答案输入区]                 │
│  ▌                               │
│                                  │
│                                  │
├──────────────────────────────────┤
│  ✦ 深入觉察          继续 →      │  ← 底部，继续=回答完这一问
└──────────────────────────────────┘
```

**关键要求：**
- 这个界面背景也是 `#faf8f4`，与写作页视觉连续，不要换成不同颜色或风格
- 问题文字区域不要用气泡、卡片、彩色背景——就是普通文字，比正文稍重（font-weight 500）
- 屏幕切换（从一个问题到下一个问题）用整屏渐变：`opacity 0 → 1`，时长约 300ms

### 8.3 本地觉察问题定义

把原有 `reflectionQuestions.js` 的逻辑搬到 `AwarenessFlow.jsx` 里（或单独抽成 `lib/awarenessQuestions.js`）。问题分层，按内容深度动态选起点。

**问题层级（从表层到深层）：**

```js
export const AWARENESS_QUESTIONS = [
  // 层级 1：事件/情境（最表层，只在内容还没描述清楚时才问）
  {
    id: 'context',
    tier: 1,
    text: '能多说一点当时的情况吗？',
    alts: ['当时发生了什么？', '事情是在什么情况下发生的？'],
    showWhen: 'always',
    field: null,  // 不写入独立字段，并入原文
  },

  // 层级 2：情绪感受
  {
    id: 'primary_emotion',
    tier: 2,
    text: '当时你是什么感觉？',
    alts: ['你注意到自己有什么情绪？', '你心里是什么滋味？'],
    showWhen: 'always',
    field: 'emotion_display',  // 写入这个字段（描述层）
  },

  // 层级 3：身体感受（只在有明显负面情绪词时才问）
  {
    id: 'body',
    tier: 3,
    text: '这个感觉在身体哪里？',
    alts: ['是什么质地——紧、沉、热还是别的？', '现在坐着，身体哪里是紧的？'],
    showWhen: 'negative',  // 只有情绪是负面时才出现
    field: 'body_sensations',
  },

  // 层级 3：当下念头
  {
    id: 'thought',
    tier: 3,
    text: '当时你脑子里第一个念头是什么？',
    alts: ['那个时刻最先冒出来的词是什么？', '你当时对自己说了什么？'],
    showWhen: 'always',
    field: 'current_thought',
  },

  // 层级 4：核心需求
  {
    id: 'need',
    tier: 4,
    text: '在这件事上，你真正需要的是什么？',
    alts: ['这件事触动了你的什么——被理解、安全感，还是别的？', '什么对你来说最重要？'],
    showWhen: 'always',
    field: 'core_needs',
  },

  // 层级 5：认知/洞见（较深，不是每次都要问到）
  {
    id: 'insight',
    tier: 5,
    text: '写完这些，有什么是刚才才意识到的吗？',
    alts: ['如果给今天的自己说一句话，会是什么？', '有没有哪句话，说出来之后觉得「对，就是这个」？'],
    showWhen: 'always',
    field: 'reflection_insight',
  },
]
```

### 8.4 根据内容深度决定起点

`contentAnalysis.js` 里新增 `getAwarenessStartTier(text)` 函数：

```js
// 在 contentAnalysis.js 里新增

/**
 * 根据文本复杂度，返回觉察流应该从哪一层开始
 * @param {string} text - 用户原始写作内容
 * @returns {number} tier - 1,2,3,4,5
 */
export function getAwarenessStartTier(text) {
  if (!text || text.trim().length < 30) return 1  // 太短，从头开始

  const { score } = analyzeContent(text)

  // 内容已经写到了较深处，才跳起点
  // 关键词检测：如果已经写了感受/情绪类词，跳过 tier 1
  const hasEmotionWords = [...STRONG_NEGATIVE, ...POSITIVE].some(w => text.includes(w))
  // 如果写了身体/需求关键词，跳得更靠后
  const hasBodyWords = ['身体', '胸口', '肚子', '喉咙', '头疼', '心跳', '紧', '沉'].some(w => text.includes(w))
  const hasNeedWords = ['需要', '想要', '希望', '重要', '被理解', '安全'].some(w => text.includes(w))

  if (hasBodyWords || hasNeedWords) return 3  // 已写到深层，从 tier 3 开始
  if (hasEmotionWords || score >= 2) return 2  // 有情绪词，从 tier 2 开始
  return 1  // 其他情况从头开始
}
```

### 8.5 本地觉察流逻辑（状态机）

```
[进入AwarenessFlow]
  ↓
  计算 startTier = getAwarenessStartTier(rawContent)
  过滤问题列表：只保留 tier >= startTier 的问题
  如果内容无负面情绪词，过滤掉 showWhen === 'negative' 的问题
  ↓
  显示第一个问题（单屏）
  ↓
  用户填写答案 → 点"继续"
  ↓
  渐变过渡到下一个问题（opacity fade，300ms）
  ↓
  ...循环直到所有问题都问完
  ↓
  最后一问答完 → 自动进入保存流程

任意时刻：
  - 点"保存并退出" → 保存当前已答内容，退出
  - 点"✦ 深入觉察" → AI 接手，进入 AI 模式（见第九章）
  - 点"← 返回" → 回到写作页（内容保留在 localStorage）
```

### 8.6 AwarenessFlow 的 Props 和状态

```jsx
// AwarenessFlow.jsx Props
// entry: { id, content, template, user_id }  已插入DB的entry对象
// onComplete: (conversationMessages) => void  全部完成时回调
// onExit: () => void                          用户主动退出时回调

// 内部状态
const [questions, setQuestions] = useState([])   // 过滤后的问题列表
const [currentIdx, setCurrentIdx] = useState(0)  // 当前问题索引
const [answers, setAnswers] = useState({})        // { questionId: answerText }
const [mode, setMode] = useState('local')         // 'local' | 'ai'
const [aiMessages, setAiMessages] = useState([])  // AI模式的消息历史
const [isTransitioning, setIsTransitioning] = useState(false) // 渐变动画中
```

---

## 九、AI 接手流

### 9.1 触发方式

用户在觉察流任意时刻点击"✦ 深入觉察"按钮。

**点击后做什么：**
1. `mode` 从 `'local'` 切换到 `'ai'`
2. 把已有的原始写作 + 已回答的问题和答案，组装成上下文传给 AI
3. 调用 AI，让 AI 生成下一个问题
4. 显示 AI 的问题（UI 和本地问题完全一样，只在问题文字前加极小的 ✦ 标记，灰色，不显眼）

**不做什么：**
- 不弹出选择框
- 不切换成聊天气泡界面
- 不用不同颜色的背景区分 AI 和本地问题

### 9.2 传给 AI 的上下文格式

```js
function buildAIContext(rawContent, answers, previousAiMessages) {
  const answered = Object.entries(answers)
    .map(([id, ans]) => {
      const q = AWARENESS_QUESTIONS.find(q => q.id === id)
      return `问：${q?.text}\n答：${ans}`
    })
    .join('\n\n')

  return `用户刚才写道：\n${rawContent}\n\n` +
    (answered ? `已经聊到的部分：\n${answered}\n\n` : '') +
    `请从问题库中选择下一个最合适的问题，或者根据对话自然提问。只返回问题本身，不要加任何前缀或解释。`
}
```

### 9.3 AI 模式下的系统 prompt

AI 接手后使用与当前 `prompts.js` 基本一致的系统 prompt，但需要新增一条指令：

```
【单屏模式特别说明】
当前是单屏专注模式，每次只问一个问题。只返回问题本身，不要加"我注意到你..."等共情前缀，不要解释为什么问这个问题。直接给出问题。
```

### 9.4 AI 返回后的处理

AI 返回的内容就是下一个问题文字，直接显示在屏幕上。

界面上的 ✦ 标记：
```jsx
<div className="question-area">
  {mode === 'ai' && (
    <span style={{ fontSize: '10px', color: '#ccc', marginRight: '4px' }}>✦</span>
  )}
  <span style={{ fontSize: '15px', fontWeight: 500, color: '#333' }}>
    {currentQuestion}
  </span>
</div>
```

### 9.5 AI 加载状态

AI 思考时，问题区域显示 loading 状态：
- 三个小灰点，淡入淡出动画
- 不用"AI正在思考..."这类文字，太工程感

```css
.loading-dots span {
  display: inline-block;
  width: 5px; height: 5px;
  border-radius: 50%;
  background: #ccc;
  margin: 0 2px;
  animation: blink 1.2s step-end infinite;
}
.loading-dots span:nth-child(2) { animation-delay: 0.2s; }
.loading-dots span:nth-child(3) { animation-delay: 0.4s; }
```

---

## 十、记录保存与后台处理

### 10.1 保存时机和流程

```
用户在任意阶段决定退出（完成所有问题 / 点保存并退出 / 关掉页面）
  ↓
Step 1：把完整对话组装成 messages 数组（见 §4.1 格式）
  ↓
Step 2：更新 journal_entries：
  - content（原始写作，已在写作页点✓时写入）
  - template（模板类型）
  - 其他基础字段
  ↓
Step 3：插入 conversations 表：
  - entry_id = 当前 entry 的 id
  - context_type = 'entry'
  - messages = 完整对话
  ↓
Step 4（后台，不等待）：
  调用 AI 静默提取字段
  ↓
Step 5（后台，不等待）：
  本地映射 emotion_display → emotions（基础层）+ emotion_confidence
  写回 journal_entries
  ↓
返回记录列表页（Step 4、5 在后台继续跑）
```

### 10.2 写作页点 ✓ 时的处理

写作页的 ✓ 按钮做两件事：

```js
async function handleDone() {
  // 1. 立即插入 entry（拿到 id）
  const { data: entry, error } = await insertEntry({
    user_id: user.id,
    content: rawContent,
    template_type: currentTemplate.id,
    created_at: new Date().toISOString(),
  })
  if (error) { /* 显示错误 toast，不跳转 */ return }

  // 2. 随记模板：直接保存，不进觉察流
  if (currentTemplate.id === 'freewrite') {
    // 不需要觉察，直接后台提取
    _backgroundExtract(entry)
    navigate to records
    return
  }

  // 3. 其他模板：进入觉察流
  push({ type: 'awareness', entry })
}
```

### 10.3 后台提取函数（conversationService.js 更新）

提取 prompt 需要新增对 `emotion_display` 的要求：

```
提取 emotion_display: 用自然语言描述用户的情绪，可以比单个词更丰富，
如"克制后的难受"、"想守住边界"、"说服自己的平静"。最多3个词组，每个词组不超过8字。
```

提取后，在 `conversationService.js` 的 `_backgroundProcess` 里新增：

```js
// 提取完成后，本地映射情绪到基础层
import { mapDisplayToBase } from './emotionMap'
if (extraction.emotion_display?.length) {
  const { baseWords, minConfidence } = mapDisplayToBase(extraction.emotion_display)
  await updateEntry({
    id: entry.id,
    userId: entry.user_id,
    fields: {
      emotion_display: extraction.emotion_display,
      emotions: baseWords,              // 基础层，用于统计
      emotion_confidence: minConfidence,
    }
  })
}
```

### 10.4 崩溃恢复（localStorage）

写作过程中，每隔 3 秒自动把当前写作内容存 localStorage：

```js
// key 格式
const DRAFT_KEY = 'journal_draft'

// 存储内容
{
  content: "当前写作文字",
  template: "awareness",
  savedAt: "2026-04-09T09:41:00Z"
}
```

进入写作页时，检查是否有未完成的草稿：
- 有草稿且距现在不超过 24 小时：弹轻提示"你有一条未完成的记录，要继续写吗？"
- 用户点"继续"：恢复内容
- 用户点"新建"：清除草稿，开始新写作
- 保存成功后：清除草稿

---

## 十一、记录列表页（RecordsPage）

### 11.1 页面结构

```
┌──────────────────────────────────┐
│  [回顾信提示横幅，有新信时才显示] │  ← 可选区域，无新信时不占位
├──────────────────────────────────┤
│  4月9日 周三                     │  ← 日期分组标题（小灰字）
│  ┌─────────────────────────────┐ │
│  │ 觉察  9:41                  │ │  ← 单条记录卡片
│  │ 今天地铁里很烦躁……           │ │
│  │ 难受 · 压抑                  │ │  ← 情绪标签（描述层）
│  └─────────────────────────────┘ │
│  ┌─────────────────────────────┐ │
│  │ 感恩  21:30                 │ │
│  │ 和小宝聊了很久……             │ │
│  │ 温暖 · 满足                  │ │
│  └─────────────────────────────┘ │
│                                  │
│  4月8日 周二                     │
│  ┌─────────────────────────────┐ │
│  │ ✉ 回顾信                    │ │  ← 回顾信穿插在列表里
│  │ 这周你反复出现了……           │ │
│  │ 3月30日 - 4月7日             │ │
│  └─────────────────────────────┘ │
└──────────────────────────────────┘
```

### 11.2 单条记录卡片内容

| 元素 | 来源字段 | 样式 |
|---|---|---|
| 模板标签（觉察/感恩/学习/随记/行动） | `template_type` | 10px，模板色，左上角 |
| 时间 | `created_at` | 10px，灰色，右上角 |
| 内容首句（最多2行） | `content` 截取前60字 | 13px，#555，正常字重 |
| 情绪标签 | `emotion_display`（优先）或 `emotions` | 10px，胶囊样式，灰底 |

情绪标签显示规则：
- 最多显示 3 个
- 超过 3 个用「…」省略
- `emotion_display` 有值优先显示描述层，没有则显示基础层

### 11.3 回顾信卡片（穿插在列表里）

回顾信不单独一个页面，穿插在时间流里对应的日期位置。

```
┌─────────────────────────────────┐
│ ✉ 回顾信  · 未读 ●              │  ← 未读时有小圆点
│ 这段时间你反复在说「压抑」……     │  ← content 前 50 字
│ 涵盖 3月30日 - 4月7日，8条记录  │  ← period 信息
└─────────────────────────────────┘
```

卡片放在 `period_end` 对应日期的分组里。

### 11.4 顶部回顾信横幅（有未读新信时）

```
┌──────────────────────────────────┐
│  ✉ 你有一封新的回顾信  查看 →    │  ← 整行可点击
└──────────────────────────────────┘
```

- 只在有 `is_read = false` 的最新回顾信时显示
- 点击跳转到回顾信详情页
- 读完后（`is_read` 更新为 true）横幅消失

### 11.5 RecordsPage 的数据查询

```js
// 同时查两张表，在前端合并后按日期排序
const [entries, letters] = await Promise.all([
  supabase.from('journal_entries')
    .select('id, content, template_type, created_at, emotion_display, emotions, emotion_confidence')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50),

  supabase.from('review_letters')
    .select('id, content, period_start, period_end, is_read, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20),
])

// 合并成统一数组，加 _type 字段区分
const combined = [
  ...entries.data.map(e => ({ ...e, _type: 'entry' })),
  ...letters.data.map(l => ({ ...l, _type: 'letter' })),
].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
```

---

## 十二、记录详情页（RecordDetail）

### 12.1 页面结构（从上到下）

```
┌──────────────────────────────────┐
│  ← 返回                          │
├──────────────────────────────────┤
│  觉察  ·  4月9日 09:41           │  ← 模板名 + 时间（12px，灰色）
│                                  │
│  [情绪标签区]                    │
│  克制后的难受  压抑  焦虑         │  ← 描述层优先，胶囊，可点击编辑
│                                  │
│  [核心字段区，紧凑排列]           │
│  核心需求  被理解、安全感         │
│  认知      这个标准有点高         │
│  身体感受  胸口紧                 │
│  洞见      说服自己的成分多       │
│                                  │
│  关联  [回顾信 ↗]  [#烦躁 ↗]    │  ← 小标签，可点击跳转
│                                  │
│  ── 原始记录流 ──                 │
│                                  │
│  今天地铁里人很多……（原始写作）   │  ← 14px，#2d2d2d
│                                  │
│  这个感觉在身体哪里？（引导问题） │  ← 12px，#aaa
│  胸口有点紧（用户回答）           │  ← 14px，#2d2d2d
│                                  │
│  你说"还没到平和"……（AI问题）    │  ← 12px，#aaa，前面加 ✦
│  说服自己的成分多一些（用户回答） │
│                                  │
└──────────────────────────────────┘
          ┌──────────────┐
          │ ✦ 深度觉察   │   ← 浮动在底部，始终可见
          └──────────────┘
```

### 12.2 情绪标签的显示与编辑

**显示：**
- 优先显示 `emotion_display`（描述层）
- 如果 `emotion_confidence < 0.75`，在情绪标签区最后加一个灰色小字「基础标签待确认」
- 情绪标签做成胶囊（pill），背景 `#f0ece4`，文字 `#8a7a6a`

**编辑（点击情绪标签区域）：**
- 弹出轻量底部抽屉，里面是当前描述层词列表
- 每个词可以删除，也可以输入新词
- 保存时：本地重新映射 `emotion_display → emotions + emotion_confidence`，写回 DB
- **编辑时不再调 AI**，只用本地映射

### 12.3 核心字段区（紧凑排列）

每行格式：`[字段名，10px，#aaa]  [字段内容，13px，#333]`

```
核心需求  被理解、有安全感
认知      这个标准有点高
身体感受  胸口紧、呼吸浅
洞见      说服自己的成分多
```

- 字段为空时，整行隐藏（不显示空占位）
- 字段内容可以点击进入编辑模式（inline 编辑，onBlur 自动保存）
- **字段编辑只更新该字段，不触发任何 AI 调用**

### 12.4 关联区（小标签）

```jsx
// 关联到的回顾信
{entry.letter_ids?.map(lid => (
  <button key={lid} onClick={() => openLetter(lid)}>
    ✉ 回顾信 ↗
  </button>
))}

// 关联到的分类标签
{entry.category_tags?.map(tag => (
  <button key={tag} onClick={() => filterByTag(tag)}>
    #{tag} ↗
  </button>
))}
```

标签样式：`border-radius: 4px; border: 1px solid #e0dbd4; font-size: 10px; padding: 2px 6px; color: #888`

### 12.5 原始记录流的渲染

从 `conversations` 表读取该 entry 对应的 messages，按 `timestamp` 顺序渲染：

```jsx
messages.forEach(msg => {
  if (msg.source === 'raw') {
    // 原始写作：正常正文样式，14px，#2d2d2d
  } else if (msg.role === 'local' || msg.role === 'assistant') {
    // 问题：12px，#aaa，assistant 前加 ✦
  } else if (msg.role === 'user' && msg.source !== 'raw') {
    // 用户的觉察回答：14px，#2d2d2d，上方有灰色分隔线
  }
})
```

### 12.6 浮动按钮

```css
.float-btn {
  position: fixed;
  bottom: 32px;
  left: 50%;
  transform: translateX(-50%);
  background: #2d2928;
  color: white;
  border-radius: 20px;
  padding: 10px 20px;
  font-size: 13px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.2);
}
```

点击后：带着 entry 和已有 conversation 进入 `AwarenessFlow`（AI 模式直接启动）。

---

## 十三、回顾信（Review Letters）

### 13.1 触发逻辑（reviewLetterService.js）

每次用户完成一次写作保存后，后台检查是否需要生成回顾信：

```js
// src/lib/reviewLetterService.js

export async function checkAndGenerateLetter(userId) {
  // 读取用户设置（触发偏好）
  const prefs = await getUserLetterPrefs(userId)
  // prefs: { triggerType: '7days' | '10entries' | 'manual', dayInterval: 7, entryThreshold: 10 }

  if (prefs.triggerType === 'manual') return  // 手动触发，不自动生成

  // 查最新一封回顾信
  const { data: lastLetter } = await supabase
    .from('review_letters')
    .select('created_at, period_end')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  const lastLetterDate = lastLetter?.created_at ? new Date(lastLetter.created_at) : null
  const daysSinceLast = lastLetterDate
    ? (Date.now() - lastLetterDate.getTime()) / (1000 * 60 * 60 * 24)
    : Infinity

  // 查上次回顾信之后的新 entry 数量（有情绪类内容的）
  const { count: newEntryCount } = await supabase
    .from('journal_entries')
    .select('id', { count: 'exact' })
    .eq('user_id', userId)
    .gt('created_at', lastLetter?.period_end ?? '1970-01-01')
    .in('template_type', ['awareness', 'emotion', 'gratitude'])  // 只统计情感类

  const shouldGenerate =
    (prefs.triggerType === '7days' && daysSinceLast >= prefs.dayInterval) ||
    (prefs.triggerType === '10entries' && newEntryCount >= prefs.entryThreshold)

  if (shouldGenerate) {
    await generateReviewLetter(userId, lastLetter?.period_end)
  }
}
```

### 13.2 生成回顾信（AI 调用）

```js
async function generateReviewLetter(userId, periodStart) {
  const periodEnd = new Date().toISOString()

  // 读取这段时间的 entries（最多20条，避免超 token）
  const { data: entries } = await supabase
    .from('journal_entries')
    .select('content, emotions, emotion_display, core_needs, created_at')
    .eq('user_id', userId)
    .gt('created_at', periodStart ?? '1970-01-01')
    .lte('created_at', periodEnd)
    .order('created_at', { ascending: true })
    .limit(20)

  // 组装 prompt
  const content = entries.map((e, i) =>
    `[第${i+1}条，${e.created_at.slice(0,10)}]\n${e.content}`
  ).join('\n\n---\n\n')

  const prompt = getReviewLetterPrompt(content)  // 见 prompts.js

  const rawLetter = await callAI(
    [{ role: 'user', content: prompt }],
    '你是用户的内心陪伴者，写一封温和的回顾信，不评判，不说教，帮助用户看见自己。',
    { maxTokens: 1000 }
  )

  // 提取 insights（从同一次 AI 返回中解析，或单独调用）
  // 简单方案：回顾信末尾让 AI 附上结构化 insights JSON
  const insightsMatch = rawLetter.match(/```json([\s\S]*?)```/)
  const insights = insightsMatch ? JSON.parse(insightsMatch[1]) : {}
  const letterContent = rawLetter.replace(/```json[\s\S]*?```/, '').trim()

  await supabase.from('review_letters').insert({
    user_id: userId,
    entry_ids: entries.map(e => e.id),
    content: letterContent,
    insights,
    trigger_type: prefs.triggerType,
    period_start: periodStart ?? entries[0]?.created_at,
    period_end: periodEnd,
    is_read: false,
  })
}
```

### 13.3 回顾信 prompt（加入 prompts.js）

```
你会收到用户这段时间写的日记条目。请写一封温暖的回顾信，语气像一位长期陪伴的朋友。

要求：
- 不评判，不说教，不鼓励"你下次应该..."
- 帮助用户看见反复出现的情绪和模式
- 用具体细节（用户自己写的词和场景），而不是泛泛而谈
- 结尾留一个轻柔的问题或邀请，用户可以选择回应也可以不回应
- 长度：300-500字

写完信之后，在信的最后附上以下JSON（不要解释，直接输出）：
```json
{
  "recurring_emotions": [...],
  "recurring_people": [...],
  "core_needs": [...],
  "patterns": [...],
  "growth_notes": [...]
}
```
```

### 13.4 回顾信详情页（ReviewLetterDetail.jsx）

结构：
```
← 返回

✉ 回顾信
3月30日 - 4月7日 · 8条记录

[信的正文]

关联记录：[#1 ↗] [#2 ↗] [#3 ↗]   ← 可点进对应详情页

──────────
你的回应：

[输入框，placeholder: 看完这封信，你有什么想说的……]

                          [保存回应]
```

用户写的回应保存在 `review_letters.user_response` 字段（text 类型）。
回应也可以进入 AwarenessFlow（点 ✦ 深入觉察），此时 `context_type = 'letter'`。

### 13.5 已读状态

进入回顾信详情页后，自动把 `is_read` 更新为 `true`：
```js
useEffect(() => {
  if (letter && !letter.is_read) {
    supabase.from('review_letters')
      .update({ is_read: true })
      .eq('id', letter.id)
  }
}, [letter])
```

---

## 十四、洞察页（InsightsPage）

### 14.1 页面结构（第一阶段，不做过度设计）

```
洞察

[最新回顾信预览卡片，如果有]

── 最近 30 天 ──

心情曲线
  [折线图，x轴=日期，y轴=overall_state_score 1-10]

情绪频率
  焦虑 ████████ 12次
  难过 █████    7次
  满足 ████     5次

标签统计
  #地铁  8次   #妈妈  5次   #工作  4次

核心需求分布
  被理解  ████████ 14次
  安全感  █████    8次
```

### 14.2 数据查询

```js
// 心情曲线数据
const { data: moodData } = await supabase
  .from('journal_entries')
  .select('created_at, overall_state_score')
  .eq('user_id', user.id)
  .not('overall_state_score', 'is', null)
  .gte('created_at', thirtyDaysAgo)
  .order('created_at', { ascending: true })

// 情绪频率（基础层，用 emotions 字段统计）
const { data: emotionData } = await supabase
  .from('journal_entries')
  .select('emotions')
  .eq('user_id', user.id)
  .gte('created_at', thirtyDaysAgo)
// 前端展开数组并计数

// 核心需求（合并 journal_entries + review_letters 的 insights）
const [entryNeeds, letterInsights] = await Promise.all([
  supabase.from('journal_entries')
    .select('core_needs')
    .eq('user_id', user.id)
    .gte('created_at', thirtyDaysAgo),
  supabase.from('review_letters')
    .select('insights')
    .eq('user_id', user.id)
    .gte('created_at', thirtyDaysAgo)
])
// 合并两个来源的 core_needs，前端计数
```

### 14.3 第一阶段不做的事

- 不做按标签过滤的脉络视图（Phase 2）
- 不做 AI 生成叙事段落（Phase 2）
- 不做运动/习惯目标追踪（Phase 2）
- 图表用轻量库（recharts 或手写 SVG），不引入大型图表库

---

## 十五、设置页改动（SettingsPage）

现有设置页保留不变，只新增一个「回顾信」区块：

```
── 回顾信设置 ──

触发方式
  ○ 每隔 7 天自动生成
  ○ 累积 10 条情感记录后生成
  ○ 手动生成

[立即生成一封回顾信]    ← 按钮，点击触发 generateReviewLetter()
```

触发偏好存在 Supabase `user_memory` 表的 `user_profile` JSONB 里（避免新建表），key 为 `letter_prefs`：

```json
{
  "letter_prefs": {
    "triggerType": "7days",
    "dayInterval": 7,
    "entryThreshold": 10
  }
}
```

读写用现有的 `memory.js` 里的 `getMemory` / `updateMemory`。

---

## 十六、分步开发顺序

> 每一步完成后，必须通过本步的验收条件，再开始下一步。步骤之间有依赖，不能乱序。

---

### Step 1：数据库变更

**做什么：** 执行第四章的三段 SQL。

**验收：**
- [ ] Supabase Table Editor 里能看到 `conversations` 表（含 messages、context_type 等字段）
- [ ] 能看到 `review_letters` 表
- [ ] `journal_entries` 里能看到 `emotion_display` 和 `emotion_confidence` 两列
- [ ] 两张新表的 RLS 已启用（Table Editor → Authentication → Policies 里能看到）

---

### Step 2：新建 emotionMap.js

**做什么：** 按第五章创建 `src/lib/emotionMap.js`，包含词库和映射函数。

**验收：**
- [ ] 在浏览器 console 里跑 `import { mapDisplayToBase } from './lib/emotionMap'`，能正常导入
- [ ] `mapDisplayToBase(['克制后的难受', '轻松'])` 返回 `{ baseWords: ['难过', '轻松'], minConfidence: 0.75 }`
- [ ] `mapDisplayToBase([])` 返回 `{ baseWords: [], minConfidence: 1.0 }`（不报错）

---

### Step 3：更新模板配置（templates.js）

**做什么：** 按第六章重写 `src/lib/templates.js`，包含新 ID、颜色、兼容旧 ID 的 `resolveTemplate()`。

**验收：**
- [ ] `TEMPLATE_BY_ID['awareness']` 返回正确的觉察模板对象
- [ ] `resolveTemplate('emotion')` 返回 awareness 模板（旧 ID 兼容）
- [ ] `resolveTemplate('free')` 返回 freewrite 模板
- [ ] `resolveTemplate('nonexistent')` 返回 DEFAULT_TEMPLATE，不报错

---

### Step 4：重写写作页（HomePage.jsx）

**做什么：** 按第七章完全重写首页，新的写作页 UI，不含任何原有的模板卡片 UI。

**验收（视觉）：**
- [ ] 顶部是 5 个模板横排小灰字
- [ ] 点击「觉察」，标签变 `#c9a96e`，下方出现引导词和细竖线（同色）
- [ ] 点击「随记」，标签变 `#aaa`，引导词变「随手记下来」
- [ ] 输入框光标颜色是灰色（不是彩色）
- [ ] 底部左下角有 ✦ 深入觉察，右下角有 ✓ 按钮
- [ ] 切换模板不清空已输入的文字

**验收（功能）：**
- [ ] 写了文字后点 ✓，entry 成功插入 `journal_entries`（Supabase 可以查到）
- [ ] 随记模板点 ✓ 不进入觉察流，直接返回记录列表
- [ ] 草稿在 3 秒内写入 localStorage，关掉页面重新打开有恢复提示

---

### Step 5：新建 AwarenessFlow.jsx（本地觉察流部分）

**做什么：** 创建 `src/components/AwarenessFlow.jsx`，先只实现本地问题流，不含 AI 接手。

**验收：**
- [ ] 写了觉察类内容后点 ✓，进入单屏问题界面
- [ ] 问题文字是 15px、font-weight 500、`#333`
- [ ] 点「继续」有渐变过渡（不是生硬跳切）
- [ ] 内容深度深时（已经写了情绪词），第一个问题不是「能多说一点当时情况吗」
- [ ] 内容有负面情绪词时，问题列表里有「身体感觉」问题
- [ ] 点「保存并退出」，会话保存到 `conversations` 表，返回列表页

---

### Step 6：AwarenessFlow AI 接手

**做什么：** 在 Step 5 的基础上，实现「✦ 深入觉察」按钮，切换到 AI 模式。

**验收：**
- [ ] 点 ✦ 深入觉察，无弹出框，直接切换到 AI 生成问题
- [ ] AI 问题前有小 ✦ 标记（灰色，10px，不显眼）
- [ ] AI 加载时显示三点动画（不是文字 loading）
- [ ] AI 问题出错时，显示「重试」按钮（不是白屏）
- [ ] AI 接手后界面风格和本地流一致（不变成聊天气泡）

---

### Step 7：更新 conversationService.js

**做什么：** 按第十章，更新保存逻辑：存 conversations 表、提取 emotion_display、本地映射基础层。

**验收：**
- [ ] 完成写作流后，`conversations` 表里能查到对应记录，messages 字段有完整问答
- [ ] `journal_entries` 里的 `emotion_display` 有 AI 提取的描述层词汇
- [ ] `emotions` 字段有本地映射后的基础层词汇
- [ ] `emotion_confidence` 字段有 0.0-1.0 的值
- [ ] 提取失败时不影响用户（静默失败，console.error 即可）

---

### Step 8：更新 MainLayout.jsx

**做什么：** 移除 TaggingPage 和 ReflectionPage 的引用；新增洞察 Tab；整合 AwarenessFlow 进导航栈。

**验收：**
- [ ] 底部导航有 4 个 Tab：写、记录、洞察、设置（图标可暂用占位符）
- [ ] 删除 TaggingPage、ReflectionPage 的 import，`npm run build` 无报错
- [ ] 写作完成后能正确进入 AwarenessFlow，完成后能回到记录列表
- [ ] 详情页的 ✦ 深度觉察按钮能再次进入 AwarenessFlow（带历史上下文）

---

### Step 9：更新 RecordsPage.jsx

**做什么：** 按第十一章，更新卡片内容，加入回顾信穿插显示。

**验收：**
- [ ] 列表卡片显示：模板名、时间、内容首句、情绪标签
- [ ] 情绪标签优先显示 emotion_display，没有时显示 emotions
- [ ] 有 review_letters 记录时，穿插在对应日期位置
- [ ] 有未读回顾信时顶部有横幅提示

---

### Step 10：更新 RecordDetail.jsx

**做什么：** 按第十二章，改为紧凑布局，关联改小标签，加浮动按钮，显示完整问答流。

**验收：**
- [ ] 情绪标签区可点击编辑（不调 AI，只本地映射）
- [ ] 核心字段紧凑单行展示，空字段隐藏
- [ ] 有内容时原始记录流正确渲染（原文 + 问题 + 回答）
- [ ] 浮动 ✦ 按钮始终可见，点击进入 AwarenessFlow（AI 直接模式）
- [ ] `emotion_confidence < 0.75` 时情绪区显示「基础标签待确认」

---

### Step 11：新建回顾信功能

**做什么：** 新建 `reviewLetterService.js` 和 `ReviewLetterDetail.jsx`，更新 prompts.js 加入回顾信 prompt，设置页加触发偏好。

**验收：**
- [ ] 设置页能看到「回顾信设置」区块，可以切换触发方式
- [ ] 点「立即生成」能触发生成，生成完成后在记录列表能看到新的回顾信卡片
- [ ] 回顾信详情页正确显示信的内容和关联记录
- [ ] 进入详情页后 `is_read` 自动变为 true，横幅消失
- [ ] 用户可以在信下写回应并保存

---

### Step 12：新建洞察页

**做什么：** 新建 `InsightsPage.jsx`，读取第十四章描述的数据，显示基础统计图表。

**验收：**
- [ ] 心情曲线有数据时正确显示折线（无数据时显示空状态提示）
- [ ] 情绪频率柱状/条状展示，按频次排序
- [ ] 核心需求合并了 entries 和 letters 两个来源的数据
- [ ] 有未读回顾信时，页面顶部有预览卡片

---

## 十七、严格边界（禁止事项）

以下是**绝对不能做**的事。每次实现功能前，对照检查一遍。

### 🚫 交互边界

| 禁止行为 | 正确做法 |
|---|---|
| 切换模板时清空输入框内容 | 只切换标签颜色和引导词，内容不动 |
| 用左右滑动切换觉察问题 | 用整屏渐变替换（opacity fade），不用滑动 |
| 下滑触发"下一题" | 下滑仅用于查看历史，不作为导航手势 |
| 点 ✦ 时弹出选择框 | 点击直接进入 AI 模式，无选择步骤 |
| 用聊天气泡 UI 显示觉察问答 | 统一用单屏写作界面，无气泡 |
| AI 问题和本地问题用不同背景色区分 | 只用极小的 ✦ 标记区分，背景统一 |

### 🚫 数据边界

| 禁止行为 | 正确做法 |
|---|---|
| 把回顾信的 insights 写回单条 entry | insights 留在 `review_letters.insights` JSONB 里 |
| 用户编辑情绪词时调用 AI | 只用本地 `mapDisplayToBase()` 映射 |
| 把任意描述词自动加入基础层词库 | 基础层 42 词固定，不自动扩展 |
| 提取失败时用 alert 或 modal 打断用户 | 静默失败，console.error，可加底部 toast |
| 在每次保存时都调 AI | 只在用户退出写作流后才触发后台提取 |

### 🚫 架构边界

| 禁止行为 | 正确做法 |
|---|---|
| 在页面组件里直接调 supabase | 通过 journalService / conversationService 等 lib 层调用 |
| 在 UI 组件里写 AI prompt | prompt 统一在 prompts.js 维护 |
| 把 AI 流程逻辑写在 JSX 文件里 | AI 调用逻辑放 lib 层，组件只传参调用 |
| 本次实现 threads/事件线系统 | 明确 Phase 2，本次不做 |
| 本次实现复杂洞察图表动画 | 静态图表够用，不引入大型动画库 |

### 🚫 删除文件的前置条件

删 `TaggingPage.jsx` 和 `ReflectionPage.jsx` 之前，必须确认：
1. `MainLayout.jsx` 里没有 import 这两个文件
2. `MainLayout.jsx` 里没有任何地方 push `{ type: 'tagging' }` 或 `{ type: 'reflection' }`
3. `npm run build` 通过，再删文件

---

## 十八、最终验收标准

所有 Step 完成后，做一次完整的端到端验收。以下每一条都必须亲自操作验证，不接受「应该能过」。

### 写作体验

- [ ] 打开 App，第一眼是写作页，不是聊天框、不是模板选择弹窗
- [ ] 可以直接在空白区域输入文字，没有任何额外步骤
- [ ] 模板标签轻量横排，切换时不清空内容
- [ ] 引导词细竖线颜色与当前模板颜色匹配，文字不加粗
- [ ] 光标颜色是灰色（`#aaa`），不是彩色

### 觉察流体验

- [ ] 写了内容点 ✓ 后进入觉察流，第一个问题符合内容深度（不重复问已写清楚的内容）
- [ ] 负面情绪内容出现「身体感觉」问题，轻松内容不出现
- [ ] 每个问题全屏展示，点继续有渐变过渡
- [ ] 任意时刻可以「保存并退出」，数据不丢失
- [ ] 随记模板不进入觉察流，直接保存

### AI 接手体验

- [ ] 点 ✦ 深入觉察，直接出现 AI 问题（无弹出框、无选择步骤）
- [ ] AI 问题界面和本地问题界面视觉一致
- [ ] AI 问题有 ✦ 标记，灰色，不显眼
- [ ] AI 失败时有重试入口，不白屏

### 记录回看

- [ ] 记录列表显示情绪标签（描述层优先）
- [ ] 有回顾信时穿插在对应日期，未读时有提示
- [ ] 详情页核心字段单行紧凑，空字段不占位
- [ ] 详情页原始记录流完整还原问答顺序
- [ ] `emotion_confidence < 0.75` 时有轻提示，不打断流程
- [ ] 浮动 ✦ 按钮始终可见，点击可继续觉察

### 数据正确性

- [ ] 完成写作后，`journal_entries` 里的 `emotion_display` 有值
- [ ] `emotions`（基础层）有经过映射的标准词
- [ ] `conversations` 表里有完整 messages 数组
- [ ] 回顾信生成后，`review_letters` 表里有对应记录，`entry_ids` 正确关联

### 不该出现的事

- [ ] 写作过程中没有任何 AI 调用发生（写完才后台提取）
- [ ] 编辑情绪词没有触发 AI 调用
- [ ] 切换模板没有清空内容
- [ ] 不存在 TaggingPage、ReflectionPage 的任何痕迹（代码和 UI）
```
