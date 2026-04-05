# 自我觉察日记 App · 项目记忆文件

## 项目基本信息
- **项目名**：self-journal（自我觉察日记）
- **项目路径**：/Users/kassia1/Desktop/个人/noteapp/self-journal
- **用户**：技术小白，需要详细引导，不懂代码
- **GitHub**：https://github.com/kassiazqx/self-journal

## 技术栈
- 前端：React + Vite + Tailwind CSS v3
- 数据库/Auth：Supabase
- 部署：Vercel
- 语音：Web Speech API（浏览器原生，免费）

## Supabase 信息
- Project URL：https://bmvojccasvrjzvqdrnse.supabase.co
- 地区：Tokyo
- 数据库表：journal_entries（已建）
- RLS：已启用

## 阶段一完成情况 ✅
已完成并可用：
1. 邮箱注册/登录（Supabase Auth）
2. 5种模板快捷按钮（感恩/学习/情绪/行动/随手记）
3. 点击模板显示引导提示文字
4. 文字输入框（自适应高度）
5. 语音输入（点击开始→说话→5秒静默自停，自动加标点）
6. 保存到 Supabase 数据库
7. 记录列表页（按日期分组，时间线展示，支持展开/删除）
8. PWA 配置（部署后可添加到手机主屏幕）
9. 移动端优先，暖色调（琥珀色）UI

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
    useSpeechRecognition.js  # 语音输入 Hook
  lib/
    supabase.js        # Supabase 客户端
```

## 当前部署状态
- [x] 代码推送到 GitHub
- [ ] Vercel 部署中（用户正在操作）
- 环境变量需在 Vercel 配置：
  - VITE_SUPABASE_URL=https://bmvojccasvrjzvqdrnse.supabase.co
  - VITE_SUPABASE_ANON_KEY=sb_publishable_F8GwJPooKzIKRyXw9ZOiOw_eYFOzyWA

## 阶段二待做（验收阶段一后开始）
1. Claude API 接入（用户自己填 API Key）
2. 记录保存后出现 AI 对话入口
3. AI 引导觉察对话（气泡式聊天）
4. 对话结束后自动提取结构化字段（情绪评分、事件、反应等）
5. 记录详情页展示结构化字段

## 注意事项
- 语音识别在 HTTP 下手机不可用，必须 HTTPS（即 Vercel 部署后）
- .env 文件不能提交 GitHub（已在 .gitignore 中排除）
- Vercel 部署时需手动填环境变量
