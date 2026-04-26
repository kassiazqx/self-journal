# 自我觉察日记 App · 项目记忆文件

## 项目基本信息
- **项目名**：self-journal（自我觉察日记）
- **项目路径**：/Users/kassia1/Desktop/个人/noteapp/self-journal
- **用户**：技术小白，需要详细引导，不懂代码
- **GitHub**：https://github.com/kassiazqx/self-journal
- **线上网址**：https://self-journal-kassia.vercel.app
- ⚠️ 当前线上为阶段一，阶段二代码已提交本地 git，需 push 才上线

## 技术栈
- 前端：React + Vite + Tailwind CSS v3
- 数据库/Auth：Supabase（Tokyo 地区）
- AI：Google Gemini（gemini-2.5-flash-lite）/ Deepseek（可切换）
- 部署：Vercel（推送 main 分支自动部署）
- 语音：Web Speech API（桌面 Chrome 可用，安卓暂不可用）
- 未来：Capacitor 打包 Android APK（功能稳定后）

## Supabase 信息
- Project URL：https://bmvojccasvrjzvqdrnse.supabase.co
- 地区：Tokyo
- 数据库表：
  - `journal_entries`：日记条目 + ~35个AI提取字段 + full_conversation JSONB
  - `user_options`：用户自定义下拉选项
  - `user_memory`：AI跨对话记忆（每用户一行，rolling_summary + user_profile）
- RLS：全部已启用
- ⚠️ 免费版超过 1 周无活动会暂停，登录控制台点 Restore 恢复

## 阶段一完成 ✅
1. 邮箱注册/登录（Supabase Auth）
2. 5种模板快捷按钮（感恩/学习/情绪/行动/随手记）+ 引导文字
3. 文字输入框（自适应高度）
4. 语音输入（桌面 Chrome 正常；安卓暂不可用）
5. 保存到 Supabase
6. 记录列表页（按日期分组，可删除）
7. PWA + Vercel 部署

## 阶段二完成 ✅
1. 设置页（SettingsPage.jsx）—— AI 提供商切换 + API Key 管理 + 测试连接
2. AI 对话界面（AIConversation.jsx）
   - 新写日记后自动进入对话
   - 旧日记可从详情页点按钮进入对话
   - 对话存 localStorage（key: chat_session_{entry.id}），刷新可恢复
   - 点"完成"→ 静默提取14个字段 + 保存到 Supabase + 更新记忆
3. AI 问题库（prompts.js）
   - 按字段分组的预设问题（背景/情绪/身体/念头/需求/认知/洞见等）
   - AI 从库中选最合适的问题，不自行生成
   - 含提问时机原则（4条：情绪优先/跟着用户走/结尾才总结/危机优先）
4. AI 跨对话记忆（memory.js → Supabase user_memory）
   - rolling_summary：历史对话压缩摘要（每次对话后更新）
   - user_profile：用户画像（跨对话积累）
   - 多端同步，不受清缓存影响
5. 记录详情页（RecordDetail.jsx）—— 展示所有提取字段 + 对话记录

## 当前文件结构
> ⚠️ 以下为简要说明，完整真实结构见 `docs/arch-context.md §3`（由代码 session 维护）

```
src/
  contexts/        # React Context（登录状态等）
  components/      # 跨页面复用的 UI 组件（MainLayout、RecordDetail 等）
  pages/           # 页面级组件，每个 Tab / 路由对应一个文件
  hooks/           # 自定义 React hooks
  lib/             # 业务逻辑、数据访问、AI 调用（不含 UI）
docs/              # 所有文档（arch-context、spec、plan、sync-card）
```

**目录边界规则（AI 必须遵守）：**
- `lib/` 只放业务逻辑和数据访问，**不得有任何 JSX / UI 代码**
- `pages/` 只放页面入口组件，**不得直接 import supabase**（必须通过 lib/ 层）
- `components/` 放可复用 UI 组件，单次使用的局部组件写在对应 page 文件里即可
- **不得在 src/ 根目录直接建 .jsx/.js 文件**（除 App.jsx / main.jsx）
- **新建文件前先确认是否可以放进现有文件**，避免文件碎片化

## 关键架构决策（已确定，不要轻易改动）
- AI记忆存 Supabase（多端同步）→ memory.js
- 对话缓存用 localStorage（防刷新丢失）→ AIConversation.jsx
- 问题库硬编码在 prompts.js（不存DB，更新靠 git push）
- APK 用 Capacitor 套壳（功能完成后再做，现有代码零修改）
- 暂不做离线写日记（复杂度高，需求不确定）
- AI 提取字段：对话结束后静默提取，不展示审阅步骤

## 📋 待处理清单
- [ ] 新建 `docs/UI_GUIDELINES.md`（主色/圆角/字号/间距，UI 统一设计完成后做）
- [ ] `lib/` 内部按职责建子文件夹（data/ / ai/ / utils/），改完所有 import 路径——等项目稳定或下次大重构时顺手做
- [ ] 静默提取失败时给用户简短反馈
- [ ] Cloudflare Pages 部署（国内访问无需 VPN）
- [ ] 安卓语音输入（接入讯飞 API）
- [ ] 设置页加"清空记忆"按钮
- [ ] Capacitor APK 打包

## ⚠️ 工作规范（重要）
- **改代码前必须先读 `docs/coding-lessons.md`**，对照 8 条规则检查方案
- **改代码前必须先读 `docs/arch-context.md` §2**，确认架构决策不冲突
- **有 spec 文档的功能模块，改代码前必须先读对应 spec 的相关章节**
- **改代码前必须先讨论方案，不直接动手**
- 流程：superpowers:brainstorming 讨论 → 用户确认 → 执行
- 大改动用 Agent 后台跑，小修改直接用 Edit 工具
- 写大文件用 Write 工具直接写，不要交给 Agent（会 504 超时）

## 🌿 分支管理规范
- **所有开发在 `dev` 分支进行**，`main` 只接受发布合并，不直接在 main 上改代码
- **禁止直接在 `main` 上提交任何代码或文档改动**；所有变更先落 `dev`
- **当前阶段默认流程：先在 `dev` 连续 commit，确认“没问题”后，再从 `dev` merge 到 `main`**
- **大改动开始前必须打 checkpoint**：`git tag checkpoint-<功能名>-<日期>`，AI 大幅重构前先执行
- 上线流程：dev 开发完成 → 用户确认 → `git checkout main && git merge dev && git push && git checkout dev`（触发 Vercel 自动部署）
- **用户说「帮我上线」= 执行上面这四条命令**，不需要解释，直接执行

## 🔄 Multi-Session 协作规范

### 三种 Session 的职责、输入、输出

#### 产品 Session
**职责：** 需求采访、设计决策、文档编写

**必读文件：**
- CLAUDE.md（项目规范和协作流程）
- docs/arch-context.md §1（产品目标和当前阶段）
- docs/session-protocol.md（多 session 协作规范）

**产出物：**
- `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`（详细 spec）
- `docs/superpowers/plans/YYYY-MM-DD-<topic>.md`（实施 plan）
- `docs/sync-cards/YYYY-MM-DD-<topic>.md`（决策汇总）
- 更新 arch-context.md §1 和 §6

**何时换新 session：**
- 完成一个完整功能批次（1-3 个相关功能）
- 讨论超过 2 小时
- 已写 3+ 个 spec 文档

**不做：** 不写代码、不改代码、不做架构审查

---

#### 架构 Session
**职责：** 兼容性审查、风险识别、文档更新

**必读文件：**
- CLAUDE.md（项目规范）
- docs/arch-context.md（架构约束和已知风险）
- docs/sync-cards/YYYY-MM-DD-<topic>.md（本轮决策）
- docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md（详细 spec）
- docs/superpowers/plans/YYYY-MM-DD-<topic>.md（实施 plan）

**产出物：**
- 审查报告（通过/有风险/需调整）
- 新增风险条目到 arch-context.md §4
- 更新 arch-context.md §6 日志

**何时换新 session：**
- 审查完成后立即关掉（不需要保持活跃）
- 可以在同一个 session 里审查多个功能

**不做：** 不写代码、不改 spec、不做代码审查

---

#### 代码 Session
**职责：** 按 plan 实施、代码审查、上线部署

**必读文件：**
- CLAUDE.md（项目规范和协作流程）
- docs/arch-context.md（架构约束和当前代码状态）
- docs/sync-cards/YYYY-MM-DD-<topic>.md（本轮所有决策）
- docs/superpowers/plans/YYYY-MM-DD-<topic>.md（实施 plan）

**产出物：**
- 按 plan Task 顺序完成代码实施
- 每个 plan 完成后跑 superpowers:requesting-code-review
- 更新 docs/arch-context.md §3（代码 session 维护的区块）
- 更新 arch-context.md §6 日志

**何时换新 session：**
- 每个 plan 对应一个新 session（不跨 plan）
- plan 完成 + code-reviewer 通过后关掉

**约束：**
- 所有开发在 dev 分支
- 禁止直接在 main 上改动；main 只接受来自 dev 的确认后合并
- 每个 commit 要清晰（一个 Task 一个 commit）
- 改代码前读 docs/coding-lessons.md 的 8 条规则
- 有 spec 的功能必须先读对应 spec 章节

**上线指令：** 用户说「帮我上线」= 执行 `git checkout main && git merge dev && git push && git checkout dev`

---

### 流程总结

```
产品 session：采访 → spec → plan → 同步卡 → 提交 dev 分支
    ↓
架构 session：读同步卡和 spec → 审查 → 报告
    ↓
代码 session：读同步卡和 plan → 实施 → code-reviewer → 上线
```

**产品变更 → 同步卡 → 代码 Task 0 确认 → 继续**

代码 session 发现偏差时：停下来报告，不自行修复，等用户确认

## 🚦 Git 提交强制流程（每个节点都必须走完）

```
改代码
  ↓
npm run build   ← AI 执行，确认无编译错误
  ↓
npm run dev     ← AI 启动，列出【需要手动验证的操作清单】
  ↓
用户本地点一遍  ← 用户确认"没问题"
  ↓
git commit      ← 才可以提交
  ↓
用户确认要上线  ← 才可以 git push
```

**AI 不得在用户确认前自行 commit。**
**每次完成一个 Step，AI 必须明确列出要验证的操作点，等用户回复"没问题"后再提交。**
**`npm run build` 通过 ≠ 可以 commit，build 只检查编译，不检查运行时行为。**

## 注意事项
- .env 文件不能提交 GitHub（已在 .gitignore）
- Vercel 环境变量已配置完毕
- 每次改完：git add → git commit（在 dev 分支）→ 用户确认“没问题”后继续在 dev 累积或整理提交 → 用户确认上线后 merge main → git push → Vercel 自动部署
- 不允许跳过 dev 直接在 main 上提交修复
- Gemini 免费版：1500次/天，模型 gemini-flash-latest
- Supabase maxOutputTokens：对话用450，提取用1200，记忆更新用600

## 📋 待处理清单
- [ ] 新建 `docs/UI_GUIDELINES.md`（主色/圆角/字号/间距设计规范，UI 设计完成后再做）
- [ ] 静默提取失败时给用户简短反馈
- [ ] Cloudflare Pages 部署（国内访问无需 VPN）
- [ ] 安卓语音输入（接入讯飞 API）
- [ ] 设置页加"清空记忆"按钮
- [ ] Capacitor APK 打包


---

<!-- cc-starter section -->
# CLAUDE.md - self-journal

## Project Overview
**Project:** self-journal
**Description:** self-journal all
**Languages:** JavaScript
**Frameworks:** React, Tailwind CSS, Supabase

---

## Quick Reference

### Token-Saving Scripts
```bash
node scripts/stats/vibe-code.cjs help       # Code analysis (save ~90% tokens)
node scripts/stats/vibe-code.cjs types <f>   # Extract types/interfaces
node scripts/stats/vibe-code.cjs tree [dir]  # Clean directory tree
node scripts/stats/vibe-code.cjs imports <f> # Show imports
node scripts/stats/vibe-code.cjs functions <f> # Function signatures
```

### Project Statistics
```bash
node scripts/stats/cocomo.cjs                # Project cost estimation
node scripts/stats/project-report.cjs        # HTML statistics report
node scripts/stats/vibe-stats.cjs report     # Token savings report
```

### Rules
See `.claude/rules/` for working rules:
- `01-general.md` — Task tracking, planning, verification
- `02-code-standards.md` — Code quality, security, testing
- `03-dev-ops.md` — Git, environment, deployment
- `04-token-efficiency.md` — **MANDATORY:** Use Vibe-Code Scripts before reading files

### Memory System
Persistent memory across sessions in `.claude/memory/`.
Index: `.claude/memory/MEMORY.md`

---

*Generated by [cc-starter](https://www.npmjs.com/package/cc-starter)*
