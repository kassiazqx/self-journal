# 同步卡：手机端保存卡住 Bug 修复

**状态：** ✅ 已完成  
**日期：** 2026-04-21  
**commit：** 577a19d

---

## 问题描述

手机通过局域网 `http://192.168.x.x:port` 访问 Vite dev server 时，点 ✓ 后按钮永远显示「…」，页面完全不跳转。电脑 localhost 正常，Vercel HTTPS 正常。

## 根本原因

`HomePage.jsx` 中 `crypto.randomUUID()` 裸调用（第 452 行）。

`crypto.randomUUID()` 要求**安全上下文（Secure Context）**：
- `http://localhost` → 浏览器特殊处理为安全上下文 ✓
- `http://192.168.x.x` → **不是安全上下文** → 抛出 TypeError ✗
- `https://self-journal-kassia.vercel.app` → HTTPS 安全上下文 ✓

TypeError 导致 `handleDone` async 函数提前退出，`setSaving(false)` 从未执行，按钮永远显示「…」。

## 修复

```js
// 修复前
id: crypto.randomUUID(),

// 修复后（与 AwarenessFlow.jsx 保持一致）
id: crypto.randomUUID?.() ?? (Date.now().toString(36) + Math.random().toString(36).slice(2)),
```

## 为何架构审查和 code review 没发现

1. **code review 只审 diff**：这行代码不是最近改动引入的，不在任何 review 的 diff 范围内
2. **静态分析无法发现运行时 API 兼容性问题**：编译通过不等于在所有环境正常运行
3. **同项目内已有安全写法（AwarenessFlow.jsx）但不一致性未被对比**

## 预防规则

新增 §4.40 / §4.41 到 arch-context.md：  
任何 Web Crypto API 调用必须用 `?.` 可选链 + fallback，不能裸调用。
