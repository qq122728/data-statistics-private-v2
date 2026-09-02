# 后端 API 生命周期与整理清单

> 盘点日期：2026-09-02。仓库当前共有 92 个 `route.ts`（包含新增的组长专用归属纠错接口）。本清单先根据现用 3000/3002 前端、服务端调用、测试和当前业务规则分类；正式删除前还必须核对生产访问日志。

## 整理原则

不能只看“前端没有调用”就立刻删除。安全顺序是：

1. 从页面和 AI 移除入口。
2. 在接口记录废弃调用来源，观察生产访问日志。
3. 没有真实调用后，把写接口改为 `410 Gone`，先阻止旧浏览器或脚本继续写旧口径数据。
4. 保留一个发布周期后再删除路由、旧测试和只被旧接口使用的业务库代码。
5. 数据库表先只读归档；确认备份、迁移和审计都不再依赖后，再单独做数据库迁移删除。

大白话：先关门、再看还有没有人来敲门，最后才拆房子。不能直接把房子拆掉。

## A. 现行业务核心接口：保留

以下接口有现用页面或 AI 的明确调用，不能当死代码删除：

- 认证：`/api/auth/*`
- AI 只读闲聊：`/api/ai/chat`
- 员工每日数据：`/api/daily-stats`
- 客户共享表：`/api/lead/customer-reporting/*`、`/api/leads/[leadId]`
  - 普通行更新：`PATCH /api/lead/customer-reporting/[leadId]`，只处理按当前负责人分段授权的客户资料、炒群和专家动作；禁止修改接粉归属、来源渠道、接粉日期。
  - 原始归属纠错：`POST /api/lead/customer-reporting/[leadId]/attribution-correction`，仅本组组长可用，原因必填，并同步搬正统计、记录前后值。
- 开单与客户资金跟踪：`/api/customer-orders`、`/api/customer-finance/*`
- 号码存在性查询：`GET /api/legacy-customers`（只返回当前跟踪记录的脱敏存在性结果；旧命名待后续兼容期结束后合并）
- 组员、岗位、配对和交接：`/api/lead/members/*`、`/api/lead/collaborations/*`、`/api/admin/users/transfer`
- 汇总、日报、排名：`/api/org/reporting`、`/api/lead/channel-reporting`、`/api/lead/channel-report-export`、`/api/lead/daily-business-report`、`/api/performance-leaderboard`
- 组织和账号：现用 `/api/org/*`
- 渠道和资源报表：`/api/admin/channels`、`/api/resource/reporting`
- 设备、通知：`/api/device-accounts`、`/api/group-devices`、`/api/notifications/*`

`GET /api/lead/customer-reporting` 的客户明细必须按调用人过滤：普通组员只返回本人作为原接粉归属人、当前炒群负责人或当前专家负责人的客户；本组组长返回全组；组织管理员按管理范围只读。该过滤同时作用于列表、分页、阶段数量、渠道和资金汇总。接口返回的本组成员/专家候选名单不套用客户可见条件，确保负责人仍可自由分配。

候选人员必须再按岗位过滤：接粉归属只列有接粉权限的在职成员，炒群负责人只列有炒群权限的在职成员或组长，专家负责人只列有专家权限的在职成员或组长。后端保存时必须重复验证，不能只相信前端下拉框。

`GET /api/legacy-customers` 和 `POST /api/leads/check` 做全库查重时，只能告诉无配合关系的账号“号码已存在”，不得返回客户姓名、归属人、渠道或跳转地址。同组不等于有权查看。

仍处于兼容期的 `GET /api/group-operator/customers` 和 `GET /api/expert/customers` 也必须复用同一条配合关系过滤，不能因为它们属于待评估旧接口就继续暴露同组全部客户。

## B. 与现行业务直接冲突：第一批已下线

### 旧资源部审批链

- `/api/daily-confirmations`
- `/api/lead/channel-review`
- `/api/resource/channel-review`
- `/api/resource/channel-review/[id]`
- `/api/resource/daily-stats`

冲突原因：它们仍表达“员工或组长发送 → 资源部确认/异议 → 正式入账”的旧流程。当前员工保存后直接进入统计，资源部不审核日报。

以上接口现已统一返回 `410 Gone`，不能继续读写旧审批状态。管理前端里的旧 `resource-inbox` 入口和 `RealResourceDailyStatReview` 已移除，资源账号默认进入渠道数据汇总。

数据库里的确认记录继续保留为历史审计；旧待确认日报通过迁移将最新版设为正式版，没有删除修订历史。

组长渠道汇总 `GET /api/lead/channel-reporting` 继续作为正式查询接口，但已删除旧的 `review.pending`、`review.approved`、`review.returned` 返回字段。前端不得再根据这些字段显示“待资源部核对”。

SQLite→PostgreSQL 正式搬库脚本必须覆盖 `LoginThrottleBucket`，确保登录失败次数和锁定截止时间随库迁移；`Session` 继续明确排除，切换环境后要求重新登录。

## C. 旧单体手工统计接口：第二批评估下线

- `/api/batches`
- `/api/events`
- `/api/channels`
- `/api/history`
- `/api/admin/settings`

这些接口服务旧单体“来源批次 + 手工事件”页面。现用前端已经改用 `/api/daily-stats` 和号码阶段事件。它们仍有大量旧单元测试、请求限流脚本和确认状态副作用，删除前需要先把测试分成“现行业务测试”和“历史兼容测试”。

特别注意：不能因为 `/api/events` 名字普通就直接删。旧测试还用它验证事务和历史统计，必须确认当前报表已经完全不依赖它写入的新数据。

## D. 旧分岗位客户工作台：第三批评估下线

- `/api/reception/customers`
- `/api/reception/import-options`
- `/api/group-operator/customers`
- `/api/expert/customers`
- `/api/leads`
- `/api/leads/check`
- `/api/leads/[leadId]/downstream-progress`

当前页面以统一共享客户表为主，但 `/api/leads/*` 仍可能被共享表或 AI 的部分动作调用，不能整组删除。应逐个方法检查，先把仍在使用的动作并入 `/api/lead/customer-reporting/*`，再下线重复地址。

其中 `POST /api/leads` 暂作兼容导入：接粉归属候选和保存都必须校验接粉岗位；同组无配合关系的撞粉只返回“已存在客户”，不能泄露归属姓名。`/api/reception/import-options` 同样只返回有接粉权限的在职成员。

## E. 旧历史补录和审核：第四批评估

- `/api/expert-customers/historical`
- `/api/group-customers/historical`
- `/api/historical-claims`
- `/api/historical-claims/review`
- `/api/legacy-customer-rows/*`

现行业务统一使用“新增进群客户”和“新增专家客户”。`POST /api/legacy-customers` 已返回 `410 Gone`；同一路径的 `GET` 暂时只供统一新增入口和 AI 做隐私安全的号码存在性判断，不再承担老客户导入。名字相近的 `/api/legacy-customer-rows/*` 是另一套旧表，现已统一返回 `410 Gone`，不能继续读取或修改。`POST /api/expert-customers/historical` 也已由共享表“新增专家客户”替代并返回 `410 Gone`。

2026-09-01 号码切换规则：进群日期早于切换日的真实号码全部匿名封存，9 月 1 日及以后进群的号码继续作为当前客户；`LeadCustomer`、订单和资金事实行继续保留，以维持已经核准的 8 月汇总。所有客户工作台、待办、预警、人员交接和客户资金写入口必须排除 `trackingArchivedAt` 非空的行；历史报表仍可读取这些匿名事实。原号码在 9 月发生新阶段时创建新客户行，不恢复旧行，也不重复生成 8 月事件。客户进度 GET 未传 `month` 时必须返回全部日期，不能默认用当前月份隐藏已保存客户。

`/api/group-customers/historical` 当前是明确拒绝旧写法的兼容壳。可以先保留并记录调用，确认旧页面完全消失后再删。

## F. 当前没有现用页面调用，但不一定能直接删

- 考勤与导出：`/api/attendance`、`/api/exports/attendance`
- 旧人员绩效：`/api/personal-performance`、`/api/member-overview/[memberId]`、`/api/lead/performance-details`
- 旧异常审核：`/api/invalid-fan-reports/*`
- 旧风险与跟进：`/api/admin/risk-*`

`PATCH /api/admin/customer-follow-up` 已改为 `410 Gone`。该旧写入口与“组织管理员客户只读”冲突，任何旧页面或脚本都不能再通过它修改客户跟进计划。
- 旧组织入口：`/api/admin/departments`、`/api/admin/groups`、`/api/company/*`
- 旧导出：`/api/exports/member-daily`、`/api/exports/member-performance`
- 其他旧配置：`/api/lead/conversion-standards`、`/api/lead/expert-assignments`、`/api/admin/audit-logs`

这些接口当前没有现用前端直接调用，但有些仍被测试、报表库或运维脚本引用。先查生产日志和内部依赖，再决定合并、只读保留或删除。

## 推荐实施批次

### 第 1 批：已完成

1. 已从 3002 管理端移除资源部旧审核入口。
2. 五个旧资源审批接口已停止写入并返回明确废弃提示。
3. 每日保存逻辑已改为最新版直接成为正式版。
4. 已增加回归测试：员工保存后直接进入报表，资源账号不能确认或修改员工日报。

### 第 2 批：收口重复客户接口

以 `/api/lead/customer-reporting/*` 为统一入口，把共享表和 AI 仍使用的 `/api/leads/*` 动作逐项迁入，避免两个接口同时修改同一客户。

### 第 3 批：清理旧单体统计与历史补录

先冻结旧接口写入，再移除旧测试和库依赖；最后才考虑删除旧表。每一批都要做 PostgreSQL 迁移演练和生产备份恢复演练。

## 粉量分配的新接口原则

未来“粉量分配”不能复用旧 `channel-review` 或 `daily-confirmations`，应新建独立领域，例如：

- `GET /api/resource/allocation-suggestions`
- `POST /api/resource/allocation-plans`
- `POST /api/resource/allocation-plans/[id]/confirm`

新接口只处理“今日可分多少、建议分给谁、资源部确认方案”，不能读取或改写员工日报确认状态。
