# Stabilization Program

> **Document role:** This is the top-level stabilization program for the current self-journal engineering phase. It is not a feature implementation plan. Its job is to freeze priorities, define stage order, create hard gates, and specify which follow-up spec / plan documents must exist before deeper refactors continue.

**Goal:** 把项目从“功能可用但工程复杂度持续上升”的状态，切换到“可诊断、可验证、可分块治理”的稳定化阶段。当前重点不是继续扩功能，而是先建立护栏、反推真实架构、识别文档漂移、拆清产品边界与实际复杂性、完成性能 profiling，再按 spec 分块重构，最后把 AI 工作流固化。

**Current posture:**  
- 停止继续扩功能  
- 暂停无护栏的大改动  
- 暂停凭感觉的性能优化  
- 允许继续推进：稳定化治理、最小验证设施、架构审计、文档对照、性能定位、已批准 spec 的分块重构准备

---

## 0. Why This Program Exists

当前项目已经过了“靠交互式 AI 快速做出 demo”的阶段，进入工程化治理阶段。

近期暴露的主要问题，不再只是点状 bug，而是：

1. 真实架构与历史文档可能已经漂移
2. 部分核心链路已经过多依赖过渡逻辑和兼容桥接
3. 产品边界和实际复杂性尚未完全拆清
4. 性能问题仍主要停留在体感层面，缺少 profiling 证据
5. AI 工作流仍偏依赖人工口头约束，缺少稳定护栏

因此当前阶段的最高优先级，不是继续做更多功能，而是先把系统“看清楚、稳住、再分块推进”。

---

## 1. Program Goals

本 program 的目标按顺序分为 8 个阶段：

1. 停止继续扩功能
2. 先补最小测试护栏
3. 代码 + 数据库反推真实架构
4. 对照文档找漂移
5. 拆清产品边界和实际复杂性
6. 再做 profiling
7. 再按 spec 一块块重构
8. 最后再把 GSD 全流程固化

这 8 个目标是顺序性的，不应跳步。

---

## 2. Non-Goals

当前 program 明确不追求：

1. 新增大功能
2. 全盘 UI 重设计
3. 凭感觉直接做性能优化
4. 无测试护栏的高风险主链改造
5. 一口气全站统一真源迁移
6. 在没有完成阶段闸门前，把高复杂 spec 直接推进到正式主链

---

## 3. Stage Overview

### Stage 0 — Freeze And Triage

**Purpose:**  
把项目从“继续扩功能”切到“稳定化治理”模式。

**Scope:**  
- 冻结新增大功能
- 冻结“顺手一起修”
- 盘点当前所有高风险在制事项
- 标记哪些允许继续，哪些暂缓

**Outputs:**  
- 冻结规则
- 当前在制高风险事项清单
- 暂缓 / 可继续事项表

**Exit condition:**  
团队对“当前阶段不以扩功能为优先”达成一致。

---

### Stage 1 — Minimum Test Guardrails

**Purpose:**  
先建立最小验证护栏，避免后续架构梳理和重构过程中把主链改炸。

**Scope:**  
- 保留现有 `build` / `lint` / `node --test`
- 新增最小 smoke / e2e 主链测试
- 明确测试运行方式、测试数据策略、通过标准
- 为测试库补最小 schema migration baseline，避免后续 schema 演进持续依赖手工 dump/import

**Outputs:**  
- Stage 1 spec
- Stage 1 implementation plan
- 最小测试命令集
- 第一批 smoke / e2e 用例清单
- 测试护栏通过标准
- 测试库 schema 同步基线（从当前状态起正规化）

**Hard rule:**  
无最小护栏，不进入任何高风险主链重构。

**Exit condition:**  
至少 3-5 条核心用户主链可以自动验证。

---

### Stage 2 — Code + Database Reverse Audit

**Purpose:**  
不先依赖历史文档结论，只看代码和数据库，反推项目当前真实架构。

**Scope:**  
- 代码
- 数据库表结构
- trigger / RPC / SQL / RLS
- 核心运行链路

**Outputs:**  
- `ARCH_AS_IS`
- `DB_TO_CODE_MAP`
- `FLOW_MAP`
- `SOURCE_OF_TRUTH_MAP`
- `LEGACY_DRIFT_LIST`

**Hard rule:**  
先回答“系统实际上怎么工作”，再回答“设计上应该怎么工作”。

**Exit condition:**  
核心链路的真实读写、状态、初始化、AI、持久化关系已画清。

---

### Stage 3 — Drift Audit

**Purpose:**  
把 Stage 2 的真实架构结果与现有文档对照，找出漂移、过时说明、未落地设计、过渡逻辑残留。

**Scope:**  
- `arch-context`
- 当前有效 spec / plan / sync-card
- 代码真实实现

**Outputs:**  
- `DRIFT_REPORT`
- 文档过时清单
- 代码漂移清单
- 设计意图与实现不一致清单

**Hard rule:**  
不为文档面子修改结论；以代码和数据库的真实行为为准。

**Exit condition:**  
项目中“文档说 A，代码跑 B”的关键偏差点被整理完毕。

---

### Stage 4 — Product Boundary And Essential Complexity Audit

**Purpose:**  
把项目拆成若干子系统，拆清每块的目标、真源、输入输出、边界场景、实际复杂性和当前技术债。

**Scope:**  
建议至少拆这 6 块：

1. `journal_entries` 数据链
2. AI 链路：提取 / 记忆 / 回顾信 / conversations
3. 文本系统：plain text / annotations / Lexical / Markdown prototype
4. 持久化系统：草稿 / 设置 / 默认用户数据初始化
5. 图片系统
6. 导航 / 页面状态 / 跳转链

**Outputs:**  
- 子系统边界卡
- 实际复杂性清单
- 附加复杂性清单
- 每个子系统的风险级别和重构建议

**Hard rule:**  
先拆清边界和复杂性，再决定重构策略；不再整体修、不再笼统修。

**Exit condition:**  
每个核心子系统都能回答：
- 目标是什么
- 不做什么
- 真源是谁
- 边界场景有哪些
- 当前最大问题是什么

---

### Stage 5 — Performance Profiling Baseline

**Purpose:**  
在做性能优化前，先建立性能基线和瓶颈证据，不再凭体感优化。

**Scope:**  
- 首屏加载
- 页面切换
- 编辑 / 保存 / AI 交互卡顿
- `Network`
- `Performance`
- React Profiler

**Outputs:**  
- `PERF_BASELINE`
- `TOP_HOTSPOTS`
- `OPTIMIZE_LATER_LIST`
- 采样环境与复现说明

**Hard rule:**  
没有 profiling 证据，不进入性能优化。

**Exit condition:**  
前几位热点问题已经明确属于网络 / 初始化 / 重渲染 / 图片 / 编辑器 / 其他哪类。

---

### Stage 6 — Spec-Driven Refactors

**Purpose:**  
按 spec 分块推进重构，不再继续以 patch-first 的方式处理高复杂模块。

**Scope:**  
- 一次只推进一个子系统
- 每块都必须有 spec 和 implementation plan
- 每块都必须经过验证回归

**Outputs:**  
- 每个子系统的独立 spec
- 对应 implementation plan
- 实施记录 / sync-card / arch update

**Hard rule:**  
高复杂模块一律 spec-first，不直接边聊边改。

**Exit condition:**  
至少一个高复杂模块完成“spec -> plan -> implement -> verify -> document”闭环。

---

### Stage 7 — GSD / AI Workflow Hardening

**Purpose:**  
把目前依赖人工口头约束的开发方式，固化成默认工作流和验证流程。

**Scope:**  
- 需求讨论
- 任务拆解
- 执行
- 验证回归
- 总结收尾
- 脚本与规则固化

**Outputs:**  
- GSD spec
- GSD plan
- 固定命令
- 固定模板
- 项目规则更新

**Hard rule:**  
把“提醒”变成“默认动作”，减少 session 风格漂移。

**Exit condition:**  
AI 开发流程不再主要依赖人工反复口头提醒。

---

## 4. Stage Dependencies

阶段依赖固定如下：

1. Stage 0 先于全部阶段
2. Stage 1 先于任何高风险主链改造
3. Stage 2 先于跨系统重构判断
4. Stage 3 先于“文档即结论”的工作方式
5. Stage 4 先于高复杂子系统重构
6. Stage 5 先于性能优化
7. Stage 6 先于工作流固化结论
8. Stage 7 在前面阶段跑顺后再做

---

## 5. Program Gates

以下闸门为强约束：

1. **没有最小 smoke/e2e，不进入高风险主链改造**
2. **没有 as-is 架构图，不进入跨系统重构**
3. **没有 drift audit，不把历史文档直接当真**
4. **没有边界卡，不推进高复杂模块正式重构**
5. **没有 profiling 证据，不做性能优化**
6. **没有 spec，不做高复杂 patch-first 改造**

---

## 6. Current High-Risk Item Handling

### 6.1 Text source / input source-of-truth adjustment

当前已存在：

- 总纲方向文档：`docs/superpowers/plans/2026-04-29-text-source-direction.md`
- 第一阶段 spec：`docs/superpowers/specs/2026-05-02-homepage-lexical-write-design.md`

当前 program 下的处理口径：

1. **方向不暂停**
2. **正式主链接入延后到 Stage 6**
3. **当前仅允许继续做：**
   - 文档 refine
   - 原型验证总结
   - 风险和兼容条件补齐
4. **当前不允许直接进入：**
   - 正式 `HomePage` 保存链替换
   - 同步卷入 `EditEntryPage`
   - 同步卷入 `RecordDetail`
   - 在缺少 Stage 1 / 2 / 4 / 5 闸门时直接落主链

原因：

- 该调整会碰写入真源、草稿、识别、图片、AI 入口、兼容桥接
- 需要在护栏、真实架构图、边界拆解、性能基线之后再正式推进

---

## 7. Required Follow-Up Documents

本 program 后续必须拆出的文档如下。

### Stage 1
- `spec`: minimum test guardrails
- `plan`: implementation of smoke / e2e guardrails

### Stage 2
- `spec`: as-is architecture reverse audit
- `plan`: code + database reverse audit execution

### Stage 3
- `spec`: drift audit
- `plan`: document-to-code comparison execution

### Stage 4
- `spec`: product boundary and essential complexity audit
- `plan`: subsystem boundary-card execution

### Stage 5
- `spec`: performance profiling baseline
- `plan`: profiling execution and evidence capture

### Stage 6
- one spec + one plan per high-complexity subsystem

### Stage 7
- `spec`: GSD / AI workflow hardening
- `plan`: script / rule / template rollout

---

## 8. Suggested Execution Order

当前建议的实际推进顺序：

1. 写 Stage 1 spec
2. 写 Stage 1 implementation plan
3. 实施 Stage 1
4. 写 Stage 2 spec
5. 写 Stage 2 implementation plan
6. 实施 Stage 2
7. 写 Stage 3 spec
8. 写 Stage 3 implementation plan
9. 实施 Stage 3
10. 写 Stage 4 spec
11. 写 Stage 4 implementation plan
12. 实施 Stage 4
13. 写 Stage 5 spec
14. 写 Stage 5 implementation plan
15. 实施 Stage 5
16. 回到 Stage 6，按单块 spec 开始重构
17. 最后 Stage 7 固化 GSD

---

## 9. Definition Of Progress

这份 program 下，“有进展”不等于改了更多代码，而是满足这些条件：

1. 新的验证护栏已经上线
2. 真实架构已被反推出图
3. 文档漂移点已被列清
4. 实际复杂性已被拆成子系统边界
5. 性能热点已用 profiling 证据定位
6. 重构开始按 spec 分块推进
7. AI 工作流逐步从口头约束转为默认流程

---

## 10. Immediate Next Step

本 program 建立后，**下一份文档应是 Stage 1 spec：Minimum Test Guardrails**。

原因：

1. 后续所有高风险梳理和重构都需要最小护栏
2. 当前项目已经有较多单元测试，但还缺页面 / 主流程级自动验证
3. 没有这一步，后续 architecture audit 和真源调整风险都过高

---

## 11. One-Line Summary

当前阶段的核心策略不是“继续堆功能”，而是：

**先立护栏，反推真实系统，拆清边界和复杂性，拿到性能证据，再按 spec 分块重构，最后把 AI 开发流程固化。**
