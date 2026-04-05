# 自我觉察日记 App · 项目记忆文件

## 项目基本信息
- **项目名**：self-journal（自我觉察日记）
- **项目路径**：/Users/kassia1/Desktop/个人/noteapp/self-journal
- **用户**：技术小白，需要详细引导，不懂代码
- **GitHub**：https://github.com/kassiazqx/self-journal
- **线上网址**：https://self-journal-kassia.vercel.app

## 技术栈
- 前端：React + Vite + Tailwind CSS v3
- 数据库/Auth：Supabase
- 部署：Vercel（已上线）
- 语音：Web Speech API（桌面 Chrome 可用，安卓待解决）

## Supabase 信息
- Project URL：https://bmvojccasvrjzvqdrnse.supabase.co
- 地区：Tokyo
- 数据库表：journal_entries（已建）
- RLS：已启用
- ⚠️ 免费版项目超过 1 周无活动会暂停，登录 Supabase 控制台点 Restore 恢复

## 阶段一完成情况 ✅
1. 邮箱注册/登录（Supabase Auth）
2. 5种模板快捷按钮（感恩/学习/情绪/行动/随手记）+ 引导提示文字
3. 文字输入框（自适应高度）
4. 语音输入（桌面 Chrome 正常；安卓因 Google 服务问题暂不可用，待后续接入讯飞）
5. 保存到 Supabase 数据库
6. 记录列表页（按日期分组，展开/删除）
7. PWA + Vercel 部署完成

## 待解决问题
- 安卓手机语音识别不可用（Web Speech API 需访问 Google 服务器，国内受限）
- 解决方案：后续接入讯飞语音 API（每用户自己填 API Key，500次/天免费）

## 项目文件结构
```
src/
  App.jsx              # 主入口，登录状态路由
  main.jsx
  index.css            # 全局样式（Tailwind）
  App.css              # 已清空
  contexts/
    AuthContext.jsx    # 用户登录状态管理
  components/
    MainLayout.jsx     # 底部导航 + 页面切换
  pages/
    AuthPage.jsx       # 登录/注册页
    HomePage.jsx       # 首页（输入记录）
    RecordsPage.jsx    # 记录列表页
  hooks/
    useSpeechRecognition.js  # 语音输入 Hook（含5秒静默自停、自动加标点）
  lib/
    supabase.js        # Supabase 客户端
```

## 阶段二待做
1. Claude API 接入（设置页让用户填自己的 API Key，存本地）
2. 记录保存后显示 AI 对话入口
3. AI 引导觉察对话（气泡式聊天）
4. 对话结束后自动提取结构化字段（情绪评分、事件、反应等）
5. 记录详情页展示结构化字段

## 注意事项
- .env 文件不能提交 GitHub（已在 .gitignore 排除）
- Vercel 环境变量已配置完毕
- 每次改完代码：git add . && git commit -m "说明" && git push，Vercel 自动部署
