# 同步卡：回顾信生成时间过滤器修复

> **状态：⏳ 待实现**
> Plan：`docs/superpowers/plans/2026-04-21-review-letter-time-filter-fix.md`

---

## 一、改动清单

| # | 问题 | 文件 | 改动性质 |
|---|---|---|---|
| 1 | `generateReviewLetter` 用时间过滤排除了旧时间戳未覆盖条目 | `reviewLetterService.js:58-59` | 删两行查询条件 |
| 2 | `checkAndGenerateLetter` 计数查询有同样时间过滤，旧条目不被计入触发阈值 | `reviewLetterService.js:213` | 删一行查询条件 |
| 3 | `checkAndGenerateLetter` 调用 `generateReviewLetter` 传 `period_end` 作 periodStart | `reviewLetterService.js:220` | 改为传 `null` |
| 4 | `generateLetterNow` 同样问题（已在上次 session 改为 `null`，本次核对） | `reviewLetterService.js:236` | 核对确认 |

---

## 二、架构审查要点

### §A 去掉时间过滤后的去重保障

**原担心：** 去掉 `created_at > period_end` 后，旧条目会不会被重复纳入多封信？

**结论：不会。** `covered_by_letter_id` 是硬性去重字段。每封信生成后 Step 6 会把所有纳入条目的 `covered_by_letter_id` 回写为该信的 id，下次查询 `IS NULL` 时这些条目已排除。时间过滤从来不是去重机制，只是一个"近似新条目"的代理过滤器——现在用字段本身替代，更精确。

**风险点：** 如果 Step 6 回写失败（代码里有 `console.error` 但不 throw），该条目下次会被重新纳入另一封信。这是已知的降级行为，与修改无关，原代码同样存在。

---

### §B `period_start` 展示字段的变化

**改前：** `period_start: periodStart ?? entries[0]?.created_at`，periodStart 来自上一封信的 period_end，偶尔与实际最老条目不符。

**改后：** periodStart 统一传 `null`，所以 `period_start` 始终等于 `entries[0]?.created_at`（本次纳入的最老条目的实际时间），**更准确**。

对用户可见的影响：信的"覆盖期间"展示从"上封信结束时间"变为"本封信最老条目时间"，更贴合实际内容。

---

### §C `require_new_entries` 逻辑不变

`checkAndGenerateLetter` 里的 `if (prefs.require_new_entries && newEntryCount === 0) return` 保持不变。去掉时间过滤后，`newEntryCount` 会正确统计所有未覆盖非随手记条目（含旧时间戳），`=== 0` 时仍然跳过。行为符合预期。

---

### §D 无新表、无 schema 变更

全部改动在 `reviewLetterService.js` 一个文件内，无新字段、无新表、无 API 变更。

---

## 三、不涉及范围

- `covered_by_letter_id` 回写失败的重试机制：已知问题，不在本次范围
- 随手记（`template_type = 'freewrite'`）排除逻辑：不变
- 触发阈值校验逻辑：不变

---

## 四、实施前确认清单

- [x] 去掉时间过滤后，`covered_by_letter_id` 提供完整去重保障，无重复覆盖风险
- [x] `period_start` 展示字段改后更准确，无副作用
- [x] `require_new_entries` 行为不受影响
- [ ] 所有改动均在 `reviewLetterService.js` 内，无新文件、无新表
