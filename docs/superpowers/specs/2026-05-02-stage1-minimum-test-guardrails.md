# Stage 1 Spec: Minimum Test Guardrails

> 对应总纲：`docs/superpowers/plans/2026-05-02-stabilization-program.md` §Stage 1  
> 本文档只定义 Stage 1 最小测试护栏的目标、范围、工具、数据策略和通过标准，不展开具体实现步骤。

## 目标

Stage 1 的目标不是把项目一次性“测全”，而是先补上最小但足够值钱的自动验证护栏，避免后续架构梳理、状态流整理、持久化收口和高风险 bugfix 过程中，把核心用户主链改炸却没有第一时间发现。

这个目标直接承接总纲 `§Stage 1 — Minimum Test Guardrails` 的要求：

- 保留现有 `build` / `lint` / `node --test`
- 新增最小 smoke / e2e 主链测试
- 明确测试运行方式、测试数据策略、通过标准
- 以“至少 3-5 条核心用户主链可以自动验证”为 Stage 1 exit condition

结合当前代码结构，Stage 1 护栏优先覆盖以下高风险区域：

- `HomePage` 写作保存入口
- `MainLayout` 页面切换和导航栈
- `AwarenessFlow` 本地觉察 / AI 觉察切换与前进后退
- `RecordsPage` 列表刷新和回看
- `SettingsPage` 本地设置持久化
- `ensureDefaultUserData()` 新用户默认数据 bootstrap

## Non-goals

Stage 1 明确不追求以下内容：

- 不追求全站功能全覆盖
- 不追求所有设置项都进入浏览器自动化
- 不追求所有 AI 输出质量都自动验证
- 不追求 Threads / Review Letter / 导出备份 / 图片上传 / 原型页一次性全部纳入
- 不追求视觉回归测试、像素对比、样式细节断言
- 不追求多浏览器矩阵覆盖；第一批只要求一个稳定浏览器通路
- 不追求 Capacitor / APK 端测试；Stage 1 只覆盖当前浏览器运行形态
- 不以 CI 接入完成为 Stage 1 前置条件；当前仓库尚无现成 CI workflow
- 不替代现有 `node --test`；页面流程测试是补上“主链护栏”，不是推翻现有单测

## 核心主链清单

Stage 1 建议把主链拆成两层：

- `Minimum gate`：Stage 1 必须自动验证通过的硬门槛主链
- `Stage 1 target batch`：本轮 Stage 1 默认就要一起落地的高价值追加主链

其中：

- `Minimum gate = 5 条`，用于对齐总纲 `§Stage 1` 的最低退出门槛
- `Stage 1 target batch = 2 条`，用于贴合当前项目真实高频手测风险

也就是说，**总纲最低门槛仍然是 5 条，但本轮 Stage 1 默认实现目标是 9 条全部落地。**

### Minimum gate（Stage 1 硬门槛）

#### 1. 新建日记 -> 保存 -> RecordsPage 出现新记录

**选择理由：**

- 这是最基础也最值钱的“写进去、看得到”主链
- 直接覆盖 `HomePage -> createEntry -> MainLayout -> RecordsPage`
- 能第一时间发现保存失败、列表未刷新、导航跳错、缓存未更新等问题

#### 2. 新建日记 -> 默认进入本地觉察卡起始模式

**选择理由：**

- 当前项目的“写后继续觉察”不是普通详情页跳转，而是关键产品主线
- 必须单独保护“本地觉察入口”，不能和 AI 入口混成一条
- 直接覆盖 `MainLayout.handleHomeSaved()` 对默认 `startMode` 的处理

#### 3. 新建日记 -> 点 `✦` -> 正确进入 AI 觉察起始模式

**选择理由：**

- 这条和上一条是两个不同状态入口，风险点不同
- 最近项目内已经出现过“入口模式 / 覆盖层优先级 / 页面状态判断顺序”相关 bug
- 需要确保“用户主动走 AI 入口”时，不会误进本地觉察或落回普通保存链

#### 4. 编辑已有记录 -> 保存 -> 返回后显示新内容，不闪旧

**选择理由：**

- 这是当前项目里非常典型的高风险链：数据库改了，但内存对象、缓存、列表或详情页仍是旧值
- 直接覆盖 `RecordDetail / EditEntryPage / entryRepository / store cache`
- 很适合防“修一处、旧值闪回另一处”的回归

#### 5. 新用户首次登录 -> 默认数据 bootstrap 成功

**选择理由：**

- 这是启动阶段最关键的初始化链，不该只靠函数级单测
- 风险涉及 `MainLayout` 启动期、副作用只跑一次、DB 唯一约束、旧用户与新用户分流
- 如果这条坏掉，新用户后续很多页面都会连锁异常

### Stage 1 target batch（本轮默认追加目标）

#### 6. 觉察流前进 / 后退 / 模式切换后，当前进度和输入不丢

建议至少覆盖一个稳定代表场景，例如：

- 进入本地觉察卡
- 输入回答
- 前进一张
- 后退回上一张
- 已输入内容仍在

或：

- 从本地觉察切到 AI 觉察
- 再返回
- 当前 entry、当前流程状态不乱、不跳错入口

**选择理由：**

- 这是目前最容易依赖手工回归的真实痛点之一
- 直接对应历史踩坑：组件卸载导致状态丢失、覆盖层优先级错误、前进后退链路不一致
- 它比很多“普通设置项是否保存”更贴近当前高频回归风险

#### 7. 代表性设置项修改 -> 刷新后仍保留

Stage 1 不建议把所有设置项都塞进 e2e，而是选 `1-2` 条最能代表真实风险的设置持久化链。优先候选：

- AI provider / API Key 设置
- 回顾信偏好设置

**选择理由：**

- `SettingsPage` 风险不在“设置很多”，而在“本地存储读写路径是否稳定”
- 代表性设置测通后，可以为同类 localStorage/未来 Preferences 存储迁移提供护栏
- 不必为了 Stage 1 一次性覆盖导出、拖拽排序、原型区等非主线能力

## 工具选型

### 现状约束

当前 `package.json` 里已经有：

- `build`: `vite build`
- `lint`: `eslint .`
- 一批 `node --test` 兼容的现有测试文件

当前 **没有**：

- `Playwright`
- `Vitest`
- `Jest`
- `Testing Library`
- `Cypress`
- CI workflow

因此 Stage 1 的原则应是：**保留现有检查层，只补一层最小浏览器流程测试，不顺手引入第二套、第三套测试框架。**

### 推荐工具：Playwright

Stage 1 推荐新增的唯一浏览器级测试工具是：

- `@playwright/test`

#### 为什么是 Playwright

Playwright 可以理解成：

- 打开真实浏览器
- 自动登录
- 自动点击、输入、刷新、前进后退
- 最后自动检查页面有没有出现我们要的结果

它适合当前项目，不是因为“流行”，而是因为它刚好能覆盖 Stage 1 最需要的能力：

- 浏览器真实页面流程
- localStorage 持久化验证
- 页面跳转和覆盖层验证
- 刷新后状态验证
- 网络请求拦截（可用来 stub AI）

#### Stage 1 对 Playwright 的使用边界

Stage 1 里 Playwright 的职责是：

- 测页面流程级集成测试
- 测 smoke 回归主链

Stage 1 里 Playwright **不负责**：

- 替代现有 `node --test`
- 测所有纯函数和小工具
- 测 AI 文案质量
- 测样式细节

#### 为什么不是其他工具

- 不是 `Vitest` / `Jest`：它们更适合补组件/函数测试，不解决“真实浏览器主链护栏缺失”这个核心问题
- 不是 `Testing Library`：会额外引入一套组件测试设施，但 Stage 1 当前更缺的是页面流程测试，不是更多组件级断言
- 不是 `Cypress`：同类能力可做，但当前没有现成依赖积累；Playwright 在“拦截网络 + 稳定跑 smoke + 无头跑”上更适合这次最小设施目标

### 浏览器范围

Stage 1 第一批建议只要求：

- `Chromium`

原因：

- 更省维护
- 更快建立护栏
- 当前目标是守住主链，不是浏览器兼容性专项

## 测试数据策略

Stage 1 推荐采用 **混合策略**，而不是“全真”或“全 mock”。

### 1. Supabase：真实测试项目

页面流程测试默认连接：

- **独立 Supabase 测试项目**
- **专用测试账号**
- **仓库内可追踪的 schema migration 基线**

Stage 1 默认要求以下流程走 **真实 Supabase 测试项目**：

- 新建日记 -> 保存 -> `RecordsPage` 出现新记录
- 编辑已有记录 -> 保存 -> 返回后显示新内容，不闪旧
- 新用户首次登录 -> 默认数据 bootstrap 成功
- 觉察流前进 / 后退 / 模式切换后，状态保存与恢复正确

其中前两条验证真实插入 / 更新 / 回读，第三条验证真实初始化链，第四条验证 `conversations` 等持久化状态链。

这套策略的好处是：

- 不污染正式数据
- 可以真实验证 Auth、RLS、插入、更新、列表查询、初始化 bootstrap
- 对“新用户首次登录”这类强依赖数据库状态的链路更可信
- 测试库 schema 不再依赖手工 dump/import 才能同步，后续 schema 演进更不容易漂移

因为用户当前有空闲免费名额，这条路线默认 **不要求额外付费**。

### 1.1 Schema sync baseline：从当前状态起正规化

Stage 1 额外补一层最小数据库工程护栏：

- **从当前生产/主开发状态生成一份 schema migration 基线**
- **从这份基线开始，后续测试库 schema 用仓库内 migration 同步**
- **目标是测试库 schema 可以用一条命令重建/同步**

这层护栏的职责非常克制，只解决一件事：

- 不再依赖每次手工 dump/import 才能让测试库跟上当前 schema

它**不负责**：

- 不补齐过去每一次历史迁移
- 不顺手建设 CI/CD pipeline
- 不顺手接管 fixture/reset/auth-state
- 不把当前 Stage 1 变成完整数据库基础设施重构

选择“从当前状态起建立基线”，而不是“回溯全部历史”，原因是：

- 当前最重要的是让测试库和当前真实 schema 稳定对齐
- 回溯旧历史成本高、收益低、容易把 Stage 1 主线拖住
- 从现在开始正规化，已经足够支撑后续 Stage 1 剩余任务和 Stage 2/3/6 的 schema 演进

### 2. AI 提供商：mock / stub，不打真实模型

Stage 1 不建议让 Playwright 在自动化里直接调用真实 Gemini / Deepseek。原因：

- 真实 AI 响应不稳定
- 会产生 token 成本
- 响应文案变化会让测试脆弱
- Stage 1 关注的是“入口和流程是否正确”，不是“模型回答得好不好”

因此与 AI 相关的页面流程测试，建议：

- **保留真实 Supabase**
- **拦截外部 AI HTTP 请求，返回固定测试响应**

这样可以稳定验证：

- AI 觉察入口是否真的触发了 AI 请求
- AI 觉察入口是否正确切入 AI 模式
- 切模式、前进后退、保存本地状态是否正常

而不会把护栏建立在真实大模型输出上。

### 3. Fixture：固定初始数据

为保证每次跑测试都从同一个起点开始，Stage 1 需要固定 fixture 数据，至少包括：

- 测试账号
- 默认 `user_options`
- 默认 `user_contacts`
- 1-2 条用于编辑场景的现成记录
- 需要时的固定 `letter_prefs`

这些 fixture 不是为了“造很多假数据”，而是为了让每次测试面对同一套最小可重复初始状态。

### 4. Reset：每次运行前清回基线

“可重复”真正依赖的不是 fixture 本身，而是 **reset 流程**。

Stage 1 应要求每次测试运行前，先把测试账号的数据清回基线。至少包括：

- 清空该测试账号名下的业务数据
- 清空测试运行所用浏览器上下文中的测试残留状态，并按用例需要重建登录态
- 重新写入测试所需最小 fixture

### 5. Schema migration baseline：成功标准

Stage 1 补入 migration baseline 后，额外成功标准是：

- 仓库内存在 Supabase CLI 可识别的 `supabase/` 结构
- 当前业务 schema 已固化为一份“从现在开始”的基线 migration
- 新测试库 schema 不再依赖手工网页导入 SQL；执行者按文档运行一条命令即可同步
- 同步后的测试库仍能跑通 Task 3 的 reset/auth-state 工具

这里的“一条命令”是指：

- 执行者不需要再手工导出旧库、清洗 SQL、粘贴到 SQL Editor
- 后续 schema 变更只需追加 migration，并把测试库同步到最新状态

对“新用户首次登录 bootstrap”场景，应单独准备一个“空白测试用户”基线，确保：

- 数据库侧没有默认数据残留
- 本地 seed marker 不残留

这样这条测试才能真的验证“首次启动时会不会自动补种子”，而不是测到一个已经初始化过的半成品状态。

### 5. 不推荐的策略

Stage 1 不推荐以下做法：

- 直接在正式 Supabase 项目上跑 e2e
- 所有链路都完全 mock
- 使用真实 AI 输出作为断言依据
- 不做 reset，只靠“测试账号大概是干净的”

## 测试命令

### 现有保留命令

这层继续保留：

- `npm run lint`
- `npm run build`
- `node --test`

Stage 1 不应把这一层丢掉。

### 建议新增命令

Stage 1 implementation 应补上以下命令契约：

```bash
npm run test:unit
npm run test:e2e
npm run test:smoke
npm run test:guardrails
```

推荐语义如下：

```bash
# 继续跑现有 node 原生测试
npm run test:unit
# => node --test

# 跑完整第一批页面流程测试
npm run test:e2e
# => playwright test

# 只跑最关键 smoke 主链（Minimum gate 5 条，或实现时确定的最小子集）
npm run test:smoke
# => playwright test --grep @smoke

# 一次性跑最小护栏全集
npm run test:guardrails
# => npm run lint && npm run build && npm run test:unit && npm run test:smoke
```

### 本地运行方式

本地日常使用建议：

```bash
# 改主链前后先跑最小护栏
npm run test:guardrails

# 需要看完整页面流程时
npm run test:e2e
```

对于只改纯函数或底层工具的改动，至少仍应保留：

```bash
npm run lint
npm run build
npm run test:unit
```

### CI 运行方式

当前仓库没有现成 CI workflow，因此 Stage 1 spec 只定义 **CI-ready 命令合同**，不把“CI 已接入”作为退出前提。

如果后续接入 GitHub Actions 或其他 CI，建议直接复用同一套命令：

```bash
npm ci
npm run lint
npm run build
npm run test:unit
npm run test:smoke
```

原因：

- `smoke` 比全量 `e2e` 更适合每次提交都跑
- 本地和 CI 用同一套命令，排查成本最低
- Stage 1 目标是先建立护栏，不是先把 CI 设计复杂化

## 通过标准

Stage 1 的通过标准必须直接服从总纲 `§Stage 1` 的 exit condition，不额外发明新的通过门槛。

因此 Stage 1 的正式通过标准定义为：

### 必须满足

#### 1. 现有基础检查仍保留可运行

至少仍能运行：

- `lint`
- `build`
- `node --test`

#### 2. 至少 3-5 条核心用户主链可以自动验证

这条是总纲硬要求。结合本 spec，推荐落地为：

- `Minimum gate` 中至少 5 条主链进入自动验证

即至少包括：

- 新建日记保存并在记录页出现
- 默认进入本地觉察卡起始模式
- `✦` 进入 AI 觉察起始模式
- 编辑已有记录保存后不闪旧
- 新用户首次登录 bootstrap 成功

同时，本轮 Stage 1 的默认实现目标是把 `Stage 1 target batch` 的 2 条也一并落地，并保留全量里的 baseline 用例，因此**本轮推荐完成面是 9 条，而不是停在 5 条**。

#### 3. 自动验证可重复

同一套测试在相同基线下重复运行时，结果应稳定一致；不能依赖：

- 手工先清数据库
- 手工先点一遍页面
- 真实 AI 临场输出

### 推荐但不作为 Stage 1 硬退出条件

- 9 条默认目标一次完成，不拆成两轮
- `test:guardrails` 命令形成统一入口
- CI 后续直接接入同一套 smoke 命令

换句话说，Stage 1 完成的最低判断不是“测得多不多”，而是：

- 核心主线有没有最小自动护栏
- 这些护栏是不是可重复
- 后续高风险改动前，AI 和人工能不能先跑一遍确认“主流程没炸”
