# 同步卡：Persistence Trust Batch A / Task1-2

**状态：** `Task1 Follow-up Replacement` + `Task2` 已完成；`Task3+` 尚未开始  
**日期：** 2026-04-28  
**commit：** 待本次提交生成  
**分支：** `dev`

---

## 本次范围

按：

- `docs/superpowers/plans/2026-04-28-persistence-trust-batch-a.md`

本次只完成：

- `Task1 Follow-up Replacement`
- `Task2: 草稿正文恢复与外部内容同步收口`

本次明确不做：

- 未保存图片跨“刷新 / 关闭后重开”恢复
- `Task3` 的 `startInAi` 语义收口
- 语音能力重设计（讯飞 / 上传录音 / 上传视频）

---

## 最终决策

### 1. AI 设置继续走 provider-aware 本地结构

- `storage.js` 保留 `ai_settings_v2`
- 结构继续是：

```js
{
  provider: 'gemini' | 'deepseek',
  providers: {
    gemini: { apiKey: '' },
    deepseek: { apiKey: '' },
  },
}
```

- 旧 `ai_settings` 只做读取兼容，不再回写旧结构

### 2. 回顾信偏好维持本地单一真源

- `letter_prefs` 继续只走 `letterPrefsStorage.js`
- 不再写入 `user_profile`
- 不再依赖 `updateMemory`

### 3. 草稿改为独立存储层 `draftStorage.js`

- 新 key：`journal_draft_v2`
- 草稿内容包括：
  - 正文
  - 模板
  - 保存时间
  - 手动时间覆盖状态
  - `dismissedPeople`
- `selectedDatetime` 读回时转回 `Date`
- `dismissedPeople` 读回时转回 `Set`

### 4. 旧草稿不迁移

- 用户已确认：旧 `journal_draft` 不做迁移
- 之前旧草稿丢失可接受

### 5. 草稿保留 24 小时失效规则

- 超过 24 小时自动清掉
- 避免很久以前的旧草稿反复弹出“继续”

### 6. 内容删空时同步清草稿

- 不再保留“空白假草稿”
- 刷新后不应该继续弹恢复横幅

### 7. 外部写入统一收口到编辑器命令式入口

- `RichTextEditor` 新增 ref 方法：`setValue(text)`
- `HomePage` 新增 `applyExternalContent(text)`
- 草稿恢复 / 浏览器语音转写 / `@` 替换 三条路径统一走这个入口

目的：

- 页面 state 里的字
- Lexical 编辑器里的字

尽量保持同一份，不再各改各的

### 8. 未保存图片跨重开恢复本次明确不做

- plan 里的旧矛盾句已改掉
- 本次只承诺正文 / 模板 / 时间 / `dismissedPeople` 恢复

---

## 实际改动文件

| 文件 | 本轮改动 |
|---|---|
| `src/lib/storage.js` | AI settings v2、provider 分槽位持久化 |
| `src/lib/storage.test.js` | provider settings 规范化 / merge 测试 |
| `src/lib/letterPrefsStorage.js` | `letter_prefs` 本地单一真源 |
| `src/lib/letterPrefsStorage.test.js` | 默认值 / 兼容 / 清脏数据测试 |
| `src/lib/reviewLetterService.js` | 回顾信偏好改为只读本地真源 |
| `src/lib/reviewLetterService.test.js` | Task1 follow-up 兼容回归 |
| `src/pages/SettingsPage.jsx` | AI 设置 / 回顾信偏好切到新契约 |
| `src/lib/draftStorage.js` | 新增草稿序列化 / 保存 / 读取 / 清理 |
| `src/lib/draftStorage.test.js` | 草稿序列化 / 24h 失效 / 坏 JSON / 清理测试 |
| `src/pages/HomePage.jsx` | 草稿改走 `draftStorage`；外部内容统一走 `applyExternalContent` |
| `src/components/RichTextEditor.jsx` | 新增 ref `setValue(text)` |
| `docs/arch-context.md` | 更新 §3 / §4 / §6 |
| `docs/superpowers/plans/2026-04-28-persistence-trust-batch-a.md` | 删掉“未保存图片也能恢复”的旧矛盾句 |

---

## 自动验证

已执行：

- `node --test src/lib/storage.test.js`
- `node --test src/lib/letterPrefsStorage.test.js`
- `node --test src/lib/reviewLetterService.test.js`
- `node --test src/lib/draftStorage.test.js`
- `npm run build`

结果：

- `draftStorage.test.js` 5/5 通过
- `build` 通过
- 构建仍有既有 warning：
  - 大 chunk 提示
  - ineffective dynamic import 提示

---

## 手工验证结果

已手测通过：

- 草稿恢复：正文 / 模板 / 时间 / `dismissedPeople`
- 内容删空后不再弹假草稿
- `@` 选人后正文与 chip 状态正常

手测发现 1 个已知问题：

- 浏览器语音输入路径里，若先手打文字再点语音，原文字可能被语音结果顶掉

当前结论：

- 这不是 Task2 主体草稿链的问题
- 根因更像浏览器语音入口本身拿了旧文本快照
- 产品方向已偏向未来做“上传录音 / 上传视频 / 再转文字”，不再继续投资当前 Web Speech API 方案

---

## 残余风险

- `Task3` 还没开始，`深入觉察` 还没做 `startInAi` 真收口
- 浏览器语音输入仍是临时能力；若暂不删除，其覆盖旧文本问题仍存在
- 若后续确定走“上传录音 / 上传视频 / 再转文字”，当前 `useSpeechRecognition.js` 大概率只保留为历史接缝，不会成为终局主链

---

## 给下个 session 的一句话

如果继续做 `Persistence Trust Batch A`：

- 代码层下一步从 `Task3` 开始
- 产品层先决定浏览器语音按钮是“隐藏”还是“直接删除”
- 不要回头把未保存图片跨重开恢复塞回 Task2
