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
```
src/
  App.jsx / main.jsx / index.css
  contexts/
    AuthContext.jsx          # 登录状态管理
  components/
    MainLayout.jsx           # 底部导航 + AI对话全屏覆盖
    AIConversation.jsx       # AI对话主界面
    RecordDetail.jsx         # 记录详情页
  pages/
    AuthPage.jsx             # 登录/注册
    HomePage.jsx             # 首页（写日记）
    RecordsPage.jsx          # 记录列表
    SettingsPage.jsx         # 设置页
  hooks/
    useSpeechRecognition.js  # 语音输入
  lib/
    supabase.js              # Supabase 客户端
    aiClient.js              # AI调用层（Gemini/Deepseek，支持 maxTokens 参数）
    prompts.js               # 系统提示词 + 问题库（硬编码，不存DB）
    memory.js                # AI记忆读写（Supabase user_memory）
    localDB.js               # ⚠️ 孤儿文件，已被 memory.js 替代，待删除
```

## 关键架构决策（已确定，不要轻易改动）
- AI记忆存 Supabase（多端同步）→ memory.js
- 对话缓存用 localStorage（防刷新丢失）→ AIConversation.jsx
- 问题库硬编码在 prompts.js（不存DB，更新靠 git push）
- APK 用 Capacitor 套壳（功能完成后再做，现有代码零修改）
- 暂不做离线写日记（复杂度高，需求不确定）
- AI 提取字段：对话结束后静默提取，不展示审阅步骤

## 待处理清单
- [ ] 静默提取失败时给用户简短反馈
- [ ] Cloudflare Pages 部署（国内访问无需 VPN）
- [ ] 安卓语音输入（接入讯飞 API）
- [ ] 设置页加"清空记忆"按钮
- [ ] UI 整体重设计（用户有意向重新设计交互布局）
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
- **大改动开始前必须打 checkpoint**：`git tag checkpoint-<功能名>-<日期>`，AI 大幅重构前先执行
- 上线流程：dev 开发完成 → 用户确认 → `git checkout main && git merge dev && git push && git checkout dev`（触发 Vercel 自动部署）
- **用户说「帮我上线」= 执行上面这四条命令**，不需要解释，直接执行

## 🔄 Multi-Session 协作规范
- **完整规范**：见 `docs/session-protocol.md`
- **架构上下文**：见 `docs/arch-context.md`（所有 session 冷启动必读）
- **产品变更 → 同步卡 → 代码 Task 0 确认 → 继续**
- 代码 session 发现偏差时：停下来报告，不自行修复，等用户确认
- **每个 plan 对应一个新对话框**：一个 spec/plan 的所有 Task 在同一个代码 session 里跑完，下一个 plan 再开新的，保持每个功能批次的上下文干净
- **每个 plan 全部 Task 完成后必须跑 code-reviewer**：用 superpowers:requesting-code-review skill 审查整个 plan 的改动，发现问题当场修，确认没问题再上线
- **代码 session 开始时加一句**：「完成所有 Task 后，主动用 superpowers:requesting-code-review 做代码审查」

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
- 每次改完：git add → git commit（在 dev 分支）→ 用户确认上线后 merge main → git push → Vercel 自动部署
- Gemini 免费版：1500次/天，模型 gemini-flash-latest
- Supabase maxOutputTokens：对话用450，提取用1200，记忆更新用600

## 📋 待处理清单
- [ ] 新建 `docs/UI_GUIDELINES.md`（主色/圆角/字号/间距设计规范，UI 设计完成后再做）
- [ ] 静默提取失败时给用户简短反馈
- [ ] Cloudflare Pages 部署（国内访问无需 VPN）
- [ ] 安卓语音输入（接入讯飞 API）
- [ ] 设置页加"清空记忆"按钮
- [ ] Capacitor APK 打包
