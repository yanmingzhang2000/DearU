# v1 埋点 Schema（DearU · 亲爱的你）

> 配套：`v1产品契约决策回答.md` + `v1-状态机.md`。北极星 = **邀请完成率** = （TA 打开并完成仪式的房间）÷（发出的邀请房间）。

## 1. 漏斗定义（8 步）

```
建房 → TA进制作 → 双方完成制作 → 封装 → TA进庆祝 → 仪式走完 → 主动表达/截图 → TA后续自己建房
```

## 2. 事件表

| 事件名 | 触发时机 | 关键属性 | 对应漏斗步 | 备注 |
|--------|----------|----------|-----------|------|
| `room_created` | E1 房主建房成功 | `room_id`, `creator_id`, `occasion`(生日) | 1 建房 | |
| `invite_sent` | E3 房主**首次**点发链接 | `room_id`, `channel`(微信会话/群), `first_invite_sent_at` | — | 分母计数：发出的邀请房间；**按 room_id 去重**，同房间多次重发只记首次 |
| `invitee_entered_edit` | E4 寿星首次进制作页 | `room_id`, `invitee_id` | 2 TA进制作 | 记"被邀请人真正打开"（非点击分享）|
| `invitee_ready` | E6 寿星点"我选好了" | `room_id`, `invitee_ready_at` | 3 完成制作 | 双方完成制作标志 |
| `room_sealed` | E7 房主封装 | `room_id`, `sealed_at` | 4 封装 | |
| `invitee_entered_celebrate` | E8 寿星进庆祝页 | `room_id`, `invitee_id` | 5 TA进庆祝 | |
| `celebration_completed` | E9 某一方本地庆祝播放结束 | `room_id`, `role`(creator/invitee), `completed_at`, `duration` | 6 仪式走完 | 按角色记 `creator_completed_at`/`invitee_completed_at`；**北极星分子取 `invitee_completed_at` 非空** |
| `user_expressed` | 用户点截图/主动表达"甜" | `room_id`, `user_role`(creator/invitee) | 7 主动表达 | 定性 magic 信号 |
| `invitee_created_room` | 被邀请寿星自己建房 | `room_id`(新), `creator_id`(原invitee) | 8 TA后续建房 | **K 系数分子**：自然新房 |

## 3. 北极星与衍生指标

| 指标 | 公式 | 用途 |
|------|------|------|
| **邀请完成率（北极星）** | 存在 `invitee_completed_at` 的房间数 ÷ 存在 `first_invite_sent_at` 的房间数 | 测 magic 成立 + 增长可行；分子固定取寿星完成，不取房主单方完成 |
| 邀请打开率 | `invitee_entered_edit` ÷ `first_invite_sent_at 房间数` | 测分享卡片钩子（<30% 即废）|
| 制作→庆祝走完率 | invitee 完成房间 ÷ `invitee_entered_edit` | 测仪式中漏人（<40% 即改流程）|
| 口碑系数 K | `invitee_created_room` ÷ 总新房 | 测微信链自然增长 |
| 主动表达率 | `user_expressed` ÷ `celebration_completed` | 测情绪价值（截图/说甜）|

## 4. 实现规则

1. **"分享成功"记打开不记点击，分母按房间去重**：分母 `invite_sent` 按 room_id 去重（同房间多次重发只记首次，`first_invite_sent_at`），分子取 `invitee_completed_at` 非空（寿星真正走完），避免把点击或房主单方完成当成功。
2. **K 系数只算自己建房**：`invitee_created_room` 须是"曾被邀请者作为房主新建房间"，仅打开一次不算。
3. **双进房节点分离埋点**：寿星有 `invitee_entered_edit` 与 `invitee_entered_celebrate` 两个独立事件，不可合并，否则无法定位 magic 卡在制作还是庆祝。
4. **隐私**：埋点不含祝福语/愿望原文，仅记行为事件与角色。
5. **验证通过线（P1-2）**：熟人情侣 + 自然流量分开看；≥60% 邀请完成率且 ≥1 对主动表达 = 继续打磨 v1；<30% 打开或 <40% 走完 = 先改流程/文案，不进 v2。
