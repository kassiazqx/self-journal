# 同步卡：架构待确认问题回答 · pending_core_needs 过滤 + awarenessState 拷贝安全性

> - 对应问题来源：架构 session 审查 2026-04-18 导航修复同步卡
> - git commit：`e8e58cb`（过滤修复）
> - 完成日期：2026-04-18
> - **状态：✅ 两个问题均已确认，第一个已修复**

---

## 问题一：getPendingCoreNeeds() 是否只依赖 RLS，存在跨用户数据泄露风险？

### 原始代码问题
`getPendingCoreNeeds()` 和 `getPendingCoreNeedsCount()` 查询 `pending_core_needs` 时，**没有显式 `.eq('user_id', user.id)`**，完全依赖 RLS 过滤。

其中 join 了 `journal_entries`（Supabase 内嵌语法 `journal_entries (id, content, created_at)`）。

### 确认结论
- **pending_core_needs 侧**：RLS（`user_id = auth.uid()`）本身已足够，Supabase 客户端携带 JWT 自动过滤，不会读到他人数据
- **journal_entries 侧**：PostgREST 的资源嵌入（resource embedding）会对被嵌入表**同样应用其 RLS**。即使 `entry_id` 指向他人记录，嵌入结果也会是 `null`，不会把跨用户内容带出来
- **结论：当前无安全漏洞**，但代码只有单点 RLS 保护，防御层不完整

### 已修复（commit e8e58cb）
两个函数均补充了显式过滤：

```js
const { data: { user } } = await db.auth.getUser()
if (!user) return 0  // 或 []
.eq('user_id', user.id)
```

与其他 service 函数风格保持一致，未登录时安全降级返回空值。

### 未来本地存储迁移提示
当数据从 Supabase 迁移到本地设备存储时，`db.auth.getUser()` + `.eq('user_id', ...)` 这整套身份过滤将不再需要（本地所有数据天然属于当前设备用户）。届时 service 层统一替换即可，UI 层无需改动。

---

## 问题二：awarenessState 传递时是浅拷贝还是深拷贝，是否存在共享引用风险？

### 传递链路
```
AwarenessFlow.handleBack
  → onExit(serializeFlowState(previousState))
  → MainLayout.handleAwarenessExit(awarenessState)
  → screens 数组存入 { type: 'editHome', entry, awarenessState }
  → handleEditHomeDone
  → push({ type: 'awareness', initialFlowState: awarenessState })
  → AwarenessFlow 以 initialFlowState 恢复状态
```

### 确认结论

`serializeFlowState()`（`src/lib/awarenessFlowState.js` line 434）内部调用：

```js
function clone(value) {
  return JSON.parse(JSON.stringify(value))
}
```

**这是完整的深拷贝（JSON 序列化/反序列化）**，所有嵌套对象（localNodes、localResponses、aiNodes、aiResponses 等答案数组）均已断开引用。

此外，写作页（editHome 模式）运行期间，AwarenessFlow 已卸载，`flowState` 不再存在于任何地方，根本不存在共享修改的可能。

**结论：无共享引用风险，无需额外处理。**
