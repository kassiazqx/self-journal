# 同步卡：Persistence Trust Batch A / Task1

**状态：** 仅 Task1 已完成；Batch A 其余 Task 尚未开始  
**日期：** 2026-04-28  
**commit：** 待本次提交生成  
**分支：** `dev`

---

## 目标

按：

- `docs/superpowers/plans/2026-04-28-persistence-trust-batch-a.md`

只完成 `Task1: 收口 AI 设置与回顾信偏好持久化`，不提前进入草稿恢复、图片缓存、`RichTextEditor` 外部 value 同步，也不改既有架构方向。

---

## 最终决策

### 1. AI 设置改为 provider-aware 主结构

- `storage.js` 新增：
  - `normalizeProviderSettings(raw)`
  - `mergeProviderSettings(prev, provider, apiKey)`
- 新主 key 为 `ai_settings_v2`
- 结构统一为：

```js
{
  provider: 'gemini' | 'deepseek',
  providers: {
    gemini: { apiKey: '' },
    deepseek: { apiKey: '' },
  },
}
```

- 读取时兼容旧结构 `{ provider, apiKey }`
- 写入后删除旧 `ai_settings`，避免新旧双写漂移

### 2. `SettingsPage` 切 provider 不再互相清空 key

- 点 provider tab 时：
  - 更新当前 `provider`
  - 同时把输入框值切到 `providers[p.id].apiKey`
- 编辑 API Key 时：
  - 同步更新 `settings.apiKey`
  - 也同步更新 `settings.providers[settings.provider].apiKey`

结果：

- Gemini / Deepseek 各自保留自己的 key
- 来回切 provider、刷新页面后，不再出现“刚填好的 key 被切没了”

### 3. 回顾信偏好改为“主链稳定保存 + fallback 兜底”

- `reviewLetterService.js` 新增 `normalizeLetterPrefs(raw)`
- 规则：
  - `type === 'manual'` 保留
  - 其余一律归一到 `count`
  - 旧 `days` 自动降级为 `count`
  - `count_threshold` 默认 `10`
  - `require_new_entries` 默认 `true`

保存链：

- 主链：`updateMemory({ user_profile: { letter_prefs } })`
- fallback：`localStorage.setItem(letter_prefs_<userId>)`

读取链：

- 先读 `user_memory.user_profile.letter_prefs`
- 失败或为空再读 local fallback
- 两边都没有时回默认值

### 4. 为纯 `node --test` 回归，偏好层与生成层解耦

- `reviewLetterService.js` 的“偏好读写”继续保持同步语义不变
- 生成回顾信所需依赖改为经 `getReviewLetterDeps()` 懒取
- 目的：
  - 让 Task1 的纯函数/偏好测试可直接跑 `node --test`
  - 不要求在测试时初始化整条 Supabase / review-letter 生成链

这不是产品架构改向，只是把测试入口和重依赖解耦。

---

## 实际改动文件

| 文件 | 本轮改动 |
|---|---|
| `src/lib/storage.js` | AI settings v2、旧结构兼容、provider 分槽位持久化 |
| `src/lib/storage.test.js` | 新增 provider settings 规范化 / merge 回归测试 |
| `src/lib/reviewLetterService.js` | letter prefs normalize、主链保存 + local fallback、生成依赖懒取 |
| `src/lib/reviewLetterService.test.js` | 新增回顾信偏好 fallback 规范化测试 |
| `src/pages/SettingsPage.jsx` | provider 切换恢复各自 key；回顾信偏好改走 `updateMemory` 主链 |
| `docs/arch-context.md` | 更新 §3 真实结构与 §6 日志 |

---

## 自动验证

已执行：

- `node --test src/lib/storage.test.js`
- `node --test src/lib/reviewLetterService.test.js`
- `node --test src/lib/storage.test.js src/lib/reviewLetterService.test.js`
- `npm run build`

结果：

- 4/4 tests 通过
- `build` 通过
- 构建有非阻塞 Vite warning：
  - 大 chunk 提示（既有）
  - `reviewLetterService.js` 的 ineffective dynamic import 提示

当前判断：

- 不阻塞 Task1 交付
- 若后续 Batch A / review-letter 层继续改动，可再评估是否把这层测试兼容方案进一步收口

---

## 手工验证结果

- 2026-04-28 用户手测通过：Gemini 填 key 后切到 Deepseek 再切回，Gemini key 仍在
- 2026-04-28 用户手测通过：Deepseek 填 key 后来回切换，两家 key 各自保留
- 2026-04-28 用户手测通过：刷新页面后，当前 provider 与对应 key 恢复正常
- 2026-04-28 用户手测通过：回顾信设置切“手动生成”或修改条数后，刷新不跳回旧值

---

## 残余风险

- Batch A 只完成了 Task1；草稿正文/图片恢复、`RichTextEditor` 外部 value 同步、`startInAi` 语义收口都还没开始
- `reviewLetterService.js` 为测试兼容引入了依赖懒取；运行正确，但构建会提示 ineffective dynamic import，后续如继续改这层可再顺手收口

---

## 给下个 session 的一句话

如果继续做 `Persistence Trust Batch A`，下一步直接从 plan 的 `Task2` 开始，不要回头重做 Task1，也不要把 provider key 持久化重新改回单一 `apiKey` 结构。
