/** 组长工作台的 mock 数据——跟 data-statistics-v2（接粉/炒群/专家原型）用同一套人员名单，
 *  同一个"德国一组"，只是这边是组长视角：管人、管岗位、管审核，不直接碰客户跟进细节。
 *  业务口径依据 /Users/aaaa/Desktop/data-statistics-private-main55555/需求文档.md，
 *  跟 data-statistics-v2 冲突时以需求文档为准（例如历史客户补录这边收口给组长审核，
 *  跟 v2 原型"各岗位自助录入"不一样，是需求文档 7.3 明确要求的）。 */

export const TODAY = "2026-08-27";
export const MY_TEAM_GROUP = "德国一组";
export const MY_DEPARTMENT = "德国部";
/** 国家属性挂在部门这一层（需求文档 1.2）——组没有自己独立的时区，新建组时只能显示
 *  继承自所属部门的时区，不能单独选。这个字段是部门管理员建组、总公司管理员建部门
 *  时都要用到的展示口径。 */
export const MY_DEPARTMENT_TIMEZONE = "德国时间（UTC+1）";
export const LEAD_NAME = "张伟";
/** 部门管理员视角的演示身份——跟 LEAD_NAME 一样纯粹是展示用的人名，不挂真实登录态。 */
export const DEPT_MANAGER_NAME = "李明";

/** "刚刚做了这个操作"要记的时间戳，统一格式 MM-DD HH:mm */
export function nowStamp(): string {
  const hhmm = new Date().toTimeString().slice(0, 5);
  return `${TODAY.slice(5)} ${hhmm}`;
}

export function money(usd: number | null): string {
  return usd === null ? "—" : `$${usd.toLocaleString()}`;
}

/** 岗位权限（干哪道工序）——同一账号可拥有接粉、炒群、专家任意组合。 */
export type Position = "RECEPTION" | "GROUP_OPERATOR" | "EXPERT";
export const POSITION_META: Record<Position, string> = {
  RECEPTION: "接粉",
  GROUP_OPERATOR: "炒群",
  EXPERT: "专家",
};
export const POSITION_ORDER: Position[] = ["RECEPTION", "GROUP_OPERATOR", "EXPERT"];

/** 组员——一个人可同时拥有 1-3 个岗位权限，客户资料仍只有一份。 */
export type Member = {
  id: string;
  name: string;
  username: string;
  /** 后端主岗位；新增兼任权限时必须保留，不能被前端重新排序后误改。 */
  primaryPosition?: Position;
  /** 组长开账号时设的初始密码——只在刚开通、还没登录过时才有意义，纯演示用，不是真安全存储 */
  mustChangePassword: boolean;
  positions: Position[];
  /** 炒群岗位专用：这个炒群配对了哪几个接粉——只有 positions 里有 GROUP_OPERATOR 才有意义 */
  pairedReceptionIds?: string[];
  /** 接粉岗位专用：这个接粉配对给了哪个炒群——只有 positions 里有 RECEPTION 才有意义 */
  pairedGroupOperatorId?: string;
  /** 专家岗位专用：这个专家是不是本组默认专家（没指定专家时客户推给谁） */
  isDefaultExpert?: boolean;
  active: boolean;
  joinedGroupDate: string;
};

export const MEMBERS: Member[] = [
  { id: "m-chen", name: "陈小雨", username: "chenxiaoyu", mustChangePassword: false, positions: ["RECEPTION"], pairedGroupOperatorId: "m-li", active: true, joinedGroupDate: "2026-03-02" },
  { id: "m-zhou", name: "周婷", username: "zhouting", mustChangePassword: false, positions: ["RECEPTION"], pairedGroupOperatorId: "m-li", active: true, joinedGroupDate: "2026-04-15" },
  { id: "m-zhao-lei", name: "赵磊", username: "zhaolei", mustChangePassword: false, positions: ["RECEPTION"], pairedGroupOperatorId: "m-zhao-chen", active: true, joinedGroupDate: "2026-01-20" },
  { id: "m-liu", name: "刘洋", username: "liuyang", mustChangePassword: false, positions: ["RECEPTION"], pairedGroupOperatorId: "m-zhao-chen", active: true, joinedGroupDate: "2026-05-10" },
  { id: "m-zhao-min", name: "赵敏", username: "zhaomin", mustChangePassword: false, positions: ["RECEPTION"], pairedGroupOperatorId: "m-sun", active: true, joinedGroupDate: "2026-06-01" },
  { id: "m-li", name: "李强", username: "liqiang", mustChangePassword: false, positions: ["GROUP_OPERATOR"], pairedReceptionIds: ["m-chen", "m-zhou"], active: true, joinedGroupDate: "2025-11-01" },
  { id: "m-zhao-chen", name: "赵晨", username: "zhaochen", mustChangePassword: false, positions: ["GROUP_OPERATOR"], pairedReceptionIds: ["m-zhao-lei", "m-liu"], active: true, joinedGroupDate: "2025-12-08" },
  { id: "m-sun", name: "孙悦", username: "sunyue", mustChangePassword: false, positions: ["GROUP_OPERATOR"], pairedReceptionIds: ["m-zhao-min"], active: true, joinedGroupDate: "2026-02-14" },
  { id: "m-wang", name: "王敏", username: "wangmin", mustChangePassword: false, positions: ["EXPERT"], isDefaultExpert: true, active: true, joinedGroupDate: "2025-10-01" },
  { id: "m-liu-chang", name: "刘畅", username: "liuchang", mustChangePassword: false, positions: ["EXPERT"], active: true, joinedGroupDate: "2026-01-05" },
  { id: "m-zhao-jian", name: "赵健", username: "zhaojian", mustChangePassword: false, positions: ["EXPERT"], active: true, joinedGroupDate: "2026-03-20" },
  // 组长本人兼任专家——1.4 允许"组长+专家"叠加，业绩两套数字分开算，不相加
  { id: "m-lead", name: LEAD_NAME, username: "zhangwei", mustChangePassword: false, positions: ["EXPERT"], active: true, joinedGroupDate: "2025-09-01" },
];

/** 生成一个简单的初始密码——纯演示用，真实系统会用更安全的方式生成/分发 */
export function generateTempPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export function memberById(id: string): Member | undefined {
  return MEMBERS.find((m) => m.id === id);
}
export function receptionOf(groupOperatorId: string): Member[] {
  return MEMBERS.filter((m) => m.pairedGroupOperatorId === groupOperatorId);
}

/** 转岗/调组记录——需求文档 1.5/1.6：转岗前必须先交接，旧岗位的历史成绩不因转岗而消失 */
export type TransferKind = "POSITION" | "GROUP";
export type TransferRecord = {
  id: string;
  memberId: string;
  kind: TransferKind;
  fromLabel: string;
  toLabel: string;
  effectiveDate: string;
  reason: string;
  /** 交接对象——转岗前必须先把手上在办客户交接给这个人，未交接不允许提交转岗 */
  handoffToId: string | null;
  status: "PENDING_HANDOFF" | "DONE";
  createdAt: string;
};

export const TRANSFERS: TransferRecord[] = [
  {
    id: "tr-1", memberId: "m-liu", kind: "POSITION",
    fromLabel: "接粉", toLabel: "接粉 + 炒群（新增兼任）",
    effectiveDate: "2026-08-01", reason: "接粉做得稳，组内炒群缺人手，先兼着看看",
    handoffToId: null, status: "DONE", createdAt: "2026-07-28 14:20",
  },
];

/** 设备管理——需求文档7.2"两套并存"，实体设备号和聊天号码档案是两回事：
 *  实体设备号分配给接粉（接粉只能用分配给自己的），聊天号码档案归属到人、只有炒群和
 *  专家能领（炒群/专家只能用自己名下的号码联系客户）。两套都归属到具体成员，不是归属
 *  到岗位——同一岗位的人各用各的号，不共用。 */
export type DeviceStatus = "ACTIVE" | "IDLE";
export type PhysicalDevice = {
  id: string;
  deviceCode: string; // 设备编号
  assignedMemberId: string | null; // 只能分配给接粉岗位的成员
  status: DeviceStatus;
};

export const PHYSICAL_DEVICES: PhysicalDevice[] = [
  { id: "dev-1", deviceCode: "DE-IP-001", assignedMemberId: "m-chen", status: "ACTIVE" },
  { id: "dev-2", deviceCode: "DE-IP-002", assignedMemberId: "m-zhou", status: "ACTIVE" },
  { id: "dev-3", deviceCode: "DE-IP-003", assignedMemberId: "m-zhao-lei", status: "ACTIVE" },
  { id: "dev-4", deviceCode: "DE-IP-004", assignedMemberId: "m-liu", status: "ACTIVE" },
  { id: "dev-5", deviceCode: "DE-IP-005", assignedMemberId: "m-zhao-min", status: "ACTIVE" },
  { id: "dev-6", deviceCode: "DE-IP-006", assignedMemberId: null, status: "IDLE" },
];

export type ChatAccountStatus = "ACTIVE" | "EXPIRING_SOON" | "EXPIRED" | "IDLE";
export const CHAT_ACCOUNT_STATUS_META: Record<ChatAccountStatus, { label: string; tone: "ok" | "warn" | "bad" | "mute" }> = {
  ACTIVE: { label: "正常", tone: "ok" },
  EXPIRING_SOON: { label: "即将到期", tone: "warn" },
  EXPIRED: { label: "已过期", tone: "bad" },
  IDLE: { label: "闲置", tone: "mute" },
};
export type ChatAccountProfile = {
  id: string;
  vendor: string; // 号商
  phoneNumber: string; // 号码
  renewalDate: string; // 续费日期
  purpose: string; // 用途
  status: ChatAccountStatus;
  ownerMemberId: string | null; // 只能归属炒群或专家岗位的成员
};

export const CHAT_ACCOUNTS: ChatAccountProfile[] = [
  { id: "chat-1", vendor: "云联号商", phoneNumber: "+49 151 0022 3301", renewalDate: "2026-11-15", purpose: "炒群联系", status: "ACTIVE", ownerMemberId: "m-li" },
  { id: "chat-2", vendor: "云联号商", phoneNumber: "+49 151 0022 3302", renewalDate: "2026-09-05", purpose: "炒群联系", status: "EXPIRING_SOON", ownerMemberId: "m-zhao-chen" },
  { id: "chat-3", vendor: "创新号商", phoneNumber: "+49 152 8801 1120", renewalDate: "2026-10-20", purpose: "炒群联系", status: "ACTIVE", ownerMemberId: "m-sun" },
  { id: "chat-4", vendor: "创新号商", phoneNumber: "+49 152 8801 1188", renewalDate: "2026-12-01", purpose: "专家谈单", status: "ACTIVE", ownerMemberId: "m-wang" },
  { id: "chat-5", vendor: "云联号商", phoneNumber: "+49 151 0022 3355", renewalDate: "2026-08-18", purpose: "专家谈单", status: "EXPIRED", ownerMemberId: "m-liu-chang" },
  { id: "chat-6", vendor: "远航号商", phoneNumber: "+49 160 3300 9012", renewalDate: "2026-10-30", purpose: "专家谈单", status: "ACTIVE", ownerMemberId: "m-zhao-jian" },
  { id: "chat-7", vendor: "远航号商", phoneNumber: "+49 160 3300 9077", renewalDate: "2026-11-22", purpose: "专家谈单", status: "ACTIVE", ownerMemberId: "m-lead" },
  { id: "chat-8", vendor: "创新号商", phoneNumber: "+49 152 8801 1199", renewalDate: "2026-09-30", purpose: "备用", status: "IDLE", ownerMemberId: null },
];

/** 公司/部门——公司管理员、总公司管理员两级角色都要用到的组织结构骨架。co-1（公司A）
 *  运营两个部门（德国部/美国部），co-2（公司B）运营一个部门（英国部）——两家公司都有
 *  实际内容，总公司管理员横向对比时两行都不是空的。国家/时区属性挂在部门这一层
 *  （TeamGroup 本身没有独立时区字段，见下面 departmentId 的说明），部门管理员、公司
 *  管理员建组时都要用到这份展示口径；总公司管理员建部门时时区是真的可以选（需求文档
 *  1.2、5.6），是全应用唯一一处时区不是继承展示、而是实打实的表单选择。 */
export type Department = { id: string; name: string; timezone: string; managerName: string; companyId: string };
export type Company = { id: string; name: string; managerName: string };

export const COMPANIES: Company[] = [
  { id: "co-1", name: "公司A", managerName: "王建国" },
  { id: "co-2", name: "公司B", managerName: "陈志远" },
];

export const DEPARTMENTS: Department[] = [
  { id: "dep-1", name: MY_DEPARTMENT, timezone: MY_DEPARTMENT_TIMEZONE, managerName: DEPT_MANAGER_NAME, companyId: "co-1" },
  { id: "dep-2", name: "美国部", timezone: "美国东部时间（UTC-5）", managerName: "赵文娟", companyId: "co-1" },
  // 英国部——公司B名下唯一的部门，撑起总公司管理员视角下"公司B也有真实内容"这一行
  { id: "dep-3", name: "英国部", timezone: "英国时间（UTC+0）", managerName: "吴海燕", companyId: "co-2" },
];

/** 部门管理员视角的小组概念——只到"月度汇总数字"这一颗粒度，不是第二份完整花名册。
 *  只有德国一组（tg-1）背后挂着真实的 MEMBERS/PIPELINE_EVENTS 数据；其余几组
 *  只是用来做"组间对比"的固定演示数字，hasDetailData=false 的组没有可以逐人下钻的
 *  数据，组内明细页面对这些组只显示占位提示，不编造一份假花名册。
 *  leadMemberId 为 null 不代表"组长职位空缺"——德国二组/三组/美国一组/二组现在都有人
 *  在带（见下方 leadName），只是这些组没有真实的 Member 记录可以关联，null 单纯表示
 *  "没有系统账号可查"。真正的"空缺"要看 leadName 是否为空。
 *  departmentId 挂的是这个组所属的部门（对应 DEPARTMENTS 的 id）——部门管理员只能看到
 *  自己部门（dep-1）名下的组，这份过滤在 app/page.tsx 调用处做，本组件类型本身不做
 *  任何隐含假设。 */
export type TeamGroup = {
  id: string;
  name: string;
  leadMemberId: string | null;
  leadName: string;
  hasDetailData: boolean;
  departmentId: string;
};

export const TEAM_GROUPS: TeamGroup[] = [
  { id: "tg-1", name: MY_TEAM_GROUP, leadMemberId: "m-lead", leadName: LEAD_NAME, hasDetailData: true, departmentId: "dep-1" },
  { id: "tg-2", name: "德国二组", leadMemberId: null, leadName: "刘芳", hasDetailData: false, departmentId: "dep-1" },
  { id: "tg-3", name: "德国三组", leadMemberId: null, leadName: "陈建国", hasDetailData: false, departmentId: "dep-1" },
  { id: "tg-4", name: "美国一组", leadMemberId: null, leadName: "孙立新", hasDetailData: false, departmentId: "dep-2" },
  { id: "tg-5", name: "美国二组", leadMemberId: null, leadName: "钱志明", hasDetailData: false, departmentId: "dep-2" },
  // 英国部（dep-3）名下的组——跟美国一组/二组同一个"没有真实花名册、只有固定演示数字"
  // 的路子，两组保证 TabGroupDrilldown 在 co-2 → 英国部 这条下钻链路上不会拿到空数组。
  { id: "tg-6", name: "英国一组", leadMemberId: null, leadName: "郑海涛", hasDetailData: false, departmentId: "dep-3" },
  { id: "tg-7", name: "英国二组", leadMemberId: null, leadName: "冯丽娜", hasDetailData: false, departmentId: "dep-3" },
];

/** 德国二组/三组的固定月度汇总——字段跟 SummaryColumn 同一套指标（去掉 memberId/name/
 *  role/unitKey 这几个"列是谁"的字段，也去掉 registeredRate/orderedRate——这两个派生
 *  比率 SummaryTable 从来不单独成行展示，留着没有意义）。数字是编的演示数据，但内部
 *  分子分母、比率的四舍五入口径都跟 summaryPct 对得上，量级也照着德国一组（真实数据，
 *  月度合计：添加数据257、净业绩$2,950）来配：德国二组团队更大、转化更好，德国三组
 *  团队更小、转化更差，三组放一起对比要看得出明显差异。德国一组不需要出现在这张表
 *  里——它是实时算的，取 computeOrderedSummaryColumns 结果里的"总计"列。 */
export type GroupMonthlySummary = {
  groupId: string;
  added: number; collision: number; lowAmount: number; noWs: number; effective: number;
  replied: number; repliedRate: string;
  joined: number; joinedRate: string;
  leftNormal: number; leftAbnormal: number; leftAbnormalRate: string; inGroup: number;
  pushed: number; registered: number; ordered: number;
  depositUsd: number; withdrawalUsd: number; netUsd: number;
};

export const GROUP_MONTHLY_SUMMARY: GroupMonthlySummary[] = [
  {
    // 德国二组——团队更大、数据质量更好（撞粉/低金额/无WS占比更低）、转化率更高，
    // 净业绩明显超过德国一组，demo 里的"优等生"。
    groupId: "tg-2",
    added: 430, collision: 58, lowAmount: 54, noWs: 26, effective: 350,
    replied: 175, repliedRate: "50%",
    joined: 118, joinedRate: "27%",
    leftNormal: 45, leftAbnormal: 18, leftAbnormalRate: "15%", inGroup: 55,
    pushed: 45, registered: 36, ordered: 27,
    depositUsd: 10800, withdrawalUsd: 1200, netUsd: 9600,
  },
  {
    // 德国三组——团队更小、数据质量更差、转化率更低，净业绩明显低于德国一组，
    // demo 里的"待改进"小组。
    groupId: "tg-3",
    added: 140, collision: 32, lowAmount: 29, noWs: 18, effective: 93,
    replied: 28, repliedRate: "30%",
    joined: 21, joinedRate: "15%",
    leftNormal: 8, leftAbnormal: 7, leftAbnormalRate: "33%", inGroup: 6,
    pushed: 5, registered: 3, ordered: 1,
    depositUsd: 280, withdrawalUsd: 80, netUsd: 200,
  },
  {
    // 美国一组——公司管理员"部门明细"页面下钻用的演示组，量级比照德国二组（优等生）来配。
    groupId: "tg-4",
    added: 380, collision: 50, lowAmount: 47, noWs: 24, effective: 309,
    replied: 145, repliedRate: "47%",
    joined: 95, joinedRate: "25%",
    leftNormal: 40, leftAbnormal: 15, leftAbnormalRate: "16%", inGroup: 40,
    pushed: 38, registered: 30, ordered: 22,
    depositUsd: 9200, withdrawalUsd: 900, netUsd: 8300,
  },
  {
    // 美国二组——团队更小、转化更差，量级比照德国三组（待改进）来配。
    groupId: "tg-5",
    added: 150, collision: 34, lowAmount: 31, noWs: 20, effective: 99,
    replied: 32, repliedRate: "32%",
    joined: 24, joinedRate: "16%",
    leftNormal: 10, leftAbnormal: 9, leftAbnormalRate: "38%", inGroup: 5,
    pushed: 6, registered: 4, ordered: 2,
    depositUsd: 420, withdrawalUsd: 100, netUsd: 320,
  },
  {
    // 英国一组——英国部的主力组，量级介于德国二组（优等生）和美国一组之间。
    groupId: "tg-6",
    added: 360, collision: 47, lowAmount: 43, noWs: 22, effective: 295,
    replied: 133, repliedRate: "45%",
    joined: 82, joinedRate: "23%",
    leftNormal: 33, leftAbnormal: 14, leftAbnormalRate: "17%", inGroup: 35,
    pushed: 32, registered: 25, ordered: 18,
    depositUsd: 7600, withdrawalUsd: 700, netUsd: 6900,
  },
  {
    // 英国二组——团队更小、转化更差，量级比照德国三组/美国二组（待改进）来配。
    groupId: "tg-7",
    added: 130, collision: 28, lowAmount: 24, noWs: 15, effective: 91,
    replied: 24, repliedRate: "26%",
    joined: 18, joinedRate: "14%",
    leftNormal: 7, leftAbnormal: 6, leftAbnormalRate: "33%", inGroup: 5,
    pushed: 5, registered: 3, ordered: 1,
    depositUsd: 220, withdrawalUsd: 60, netUsd: 160,
  },
];

export function groupMonthlySummaryOf(groupId: string): GroupMonthlySummary | undefined {
  return GROUP_MONTHLY_SUMMARY.find((g) => g.groupId === groupId);
}

/** 部门级固定月度汇总——跟 GroupMonthlySummary 同一套形状（同样去掉 registeredRate/
 *  orderedRate，SummaryTable 从来不单独成行展示这两个派生比率）。公司管理员的"部门汇总"
 *  页面（需求文档 5.5）用这份数据：每个部门（包括德国部）都是手写的固定月度快照，不是
 *  现算的"部门内所有组实时求和"——这跟"团队汇总"页面把德国二组/三组当固定数不当场
 *  聚合是同一个简化，避免再写一个"部门→组"的实时聚合函数。
 *  德国部这一行数字大致等于 德国一组实时总计（月度合计：添加数据257、净业绩$2,950，
 *  见 computeOrderedSummaryColumns）+ 德国二组固定数 + 德国三组固定数 三者相加，
 *  让这个页面跟部门管理员自己的"团队汇总"看起来不会对不上；美国部同理，大致等于
 *  美国一组 + 美国二组的固定数相加；英国部同理，大致等于 英国一组 + 英国二组的固定数
 *  相加，让总公司管理员"公司明细"页面下钻进公司B时数字也是连贯的。 */
export type DepartmentMonthlySummary = {
  departmentId: string;
  added: number; collision: number; lowAmount: number; noWs: number; effective: number;
  replied: number; repliedRate: string;
  joined: number; joinedRate: string;
  leftNormal: number; leftAbnormal: number; leftAbnormalRate: string; inGroup: number;
  pushed: number; registered: number; ordered: number;
  depositUsd: number; withdrawalUsd: number; netUsd: number;
};

export const DEPARTMENT_MONTHLY_SUMMARY: DepartmentMonthlySummary[] = [
  {
    // 德国部 ≈ 德国一组（实时 257/…/净$2,950）+ 德国二组（430/…/净$9,600）+
    // 德国三组（140/…/净$200）相加。
    departmentId: "dep-1",
    added: 827, collision: 135, lowAmount: 124, noWs: 66, effective: 637,
    replied: 285, repliedRate: "45%",
    joined: 195, joinedRate: "24%",
    leftNormal: 79, leftAbnormal: 38, leftAbnormalRate: "19%", inGroup: 78,
    pushed: 67, registered: 52, ordered: 37,
    depositUsd: 14480, withdrawalUsd: 1730, netUsd: 12750,
  },
  {
    // 美国部 ≈ 美国一组（380/…/净$8,300）+ 美国二组（150/…/净$320）相加。
    departmentId: "dep-2",
    added: 530, collision: 84, lowAmount: 78, noWs: 44, effective: 408,
    replied: 177, repliedRate: "43%",
    joined: 119, joinedRate: "22%",
    leftNormal: 50, leftAbnormal: 24, leftAbnormalRate: "20%", inGroup: 45,
    pushed: 44, registered: 34, ordered: 24,
    depositUsd: 9620, withdrawalUsd: 1000, netUsd: 8620,
  },
  {
    // 英国部 ≈ 英国一组（360/…/净$6,900）+ 英国二组（130/…/净$160）相加。
    departmentId: "dep-3",
    added: 490, collision: 75, lowAmount: 67, noWs: 37, effective: 386,
    replied: 157, repliedRate: "41%",
    joined: 100, joinedRate: "20%",
    leftNormal: 40, leftAbnormal: 20, leftAbnormalRate: "20%", inGroup: 40,
    pushed: 37, registered: 28, ordered: 19,
    depositUsd: 7820, withdrawalUsd: 760, netUsd: 7060,
  },
];

export function departmentMonthlySummaryOf(departmentId: string): DepartmentMonthlySummary | undefined {
  return DEPARTMENT_MONTHLY_SUMMARY.find((d) => d.departmentId === departmentId);
}

/** 公司级固定月度汇总——跟 DepartmentMonthlySummary 同一套形状，再往上一级。总公司
 *  管理员的"公司汇总"页面（需求文档 5.2、5.5）用这份数据：每家公司都是手写的固定月度
 *  快照，不是现算的"公司内所有部门实时求和"——跟"部门汇总"把各部门当固定数不现场
 *  聚合是同一个简化，避免再写一个"公司→部门"的实时聚合函数。
 *  公司A ≈ 德国部（827/…/净$12,750）+ 美国部（530/…/净$8,620）相加；
 *  公司B ≈ 英国部自己一家（这一版公司B只有英国部一个部门，数字直接等于英国部那一行），
 *  两家公司都让这个页面跟总公司管理员"公司明细"页面下钻进去看到的部门数字对得上。 */
export type CompanyMonthlySummary = {
  companyId: string;
  added: number; collision: number; lowAmount: number; noWs: number; effective: number;
  replied: number; repliedRate: string;
  joined: number; joinedRate: string;
  leftNormal: number; leftAbnormal: number; leftAbnormalRate: string; inGroup: number;
  pushed: number; registered: number; ordered: number;
  depositUsd: number; withdrawalUsd: number; netUsd: number;
};

export const COMPANY_MONTHLY_SUMMARY: CompanyMonthlySummary[] = [
  {
    // 公司A ≈ 德国部（827/…/净$12,750）+ 美国部（530/…/净$8,620）相加。
    companyId: "co-1",
    added: 1357, collision: 219, lowAmount: 202, noWs: 110, effective: 1045,
    replied: 462, repliedRate: "44%",
    joined: 314, joinedRate: "23%",
    leftNormal: 129, leftAbnormal: 62, leftAbnormalRate: "20%", inGroup: 123,
    pushed: 111, registered: 86, ordered: 61,
    depositUsd: 24100, withdrawalUsd: 2730, netUsd: 21370,
  },
  {
    // 公司B ≈ 英国部自己一家（这一版公司B只有一个部门）。
    companyId: "co-2",
    added: 490, collision: 75, lowAmount: 67, noWs: 37, effective: 386,
    replied: 157, repliedRate: "41%",
    joined: 100, joinedRate: "20%",
    leftNormal: 40, leftAbnormal: 20, leftAbnormalRate: "20%", inGroup: 40,
    pushed: 37, registered: 28, ordered: 19,
    depositUsd: 7820, withdrawalUsd: 760, netUsd: 7060,
  },
];

export function companyMonthlySummaryOf(companyId: string): CompanyMonthlySummary | undefined {
  return COMPANY_MONTHLY_SUMMARY.find((c) => c.companyId === companyId);
}

/** 跨组调组记录——部门管理员对本部门组织结构（组长任免、跨组调岗）有直接操作权
 *  （需求文档 5.x），是需求文档明确跟"组长的废号审核"分开的一类操作。形状照抄
 *  TransferRecord 的"填表单→二次确认"记录习惯，但对象是"人属于哪个组"而不是
 *  "人在组内干哪个岗位"，所以字段更简单——只演示流程：不会真的改变目标组的汇总
 *  数字，也不会把这个人塞进目标组一份假花名册。 */
export type CrossGroupTransfer = {
  id: string;
  memberId: string;
  fromLabel: string;
  toLabel: string;
  effectiveDate: string;
  reason: string;
  createdAt: string;
};

export const CROSS_GROUP_TRANSFERS: CrossGroupTransfer[] = [];

/** 客户跟进——组长视角看全组客户在三段流水线上的进度。接粉进度/炒群进度都是只读
 *  （组长不替一线操作日常动作，只看进度）；专家管理比较特殊：炒群推专家时如果没指定
 *  具体的人，默认就是组长本人接（需求文档 5.4），这部分归组长自己操作，跟专家工作台
 *  是同一套8段流水线逻辑，其他专家名下的客户组长只能看不能碰。 */
/** "未成交"/"停止维护"是需求文档8.2重新定义的两种放弃状态，按放弃发生的时点划分：
 *  未成交＝开单前放弃，停止维护＝开单后停止（已经开过单，但后续不再续充、不再跟进）——
 *  业务含义不同，不能混在一个指标里算。旧名字是"不愿充/杀不动"，命名混乱（旧规则要求
 *  "杀不动"必须已开单，跟字面意思相反），新名字直接反映时点，状态机顺序本身不变。 */
export type ExpertStage = "排队中" | "交资料" | "追踪中" | "待注册" | "待开单" | "未成交" | "已开单" | "停止维护";
export const EXPERT_STAGE_ORDER: ExpertStage[] = ["排队中", "交资料", "追踪中", "待注册", "待开单", "未成交", "已开单", "停止维护"];
export const EXPERT_STAGE_STATUS_PHRASE: Record<ExpertStage, string> = {
  排队中: "专家待跟进", 交资料: "客户正在交资料", 追踪中: "专家跟进中", 待注册: "待客户完成注册",
  待开单: "已注册待开单", 未成交: "客户暂未成交", 已开单: "已开单客户", 停止维护: "已开单，暂停跟进",
};
export const EXPERT_STAGE_WARN: Partial<Record<ExpertStage, boolean>> = { 未成交: true, 停止维护: true };
/** "撤回上一步"只覆盖4个线性主链阶段，未成交/已开单/停止维护走各自专门的恢复按钮 */
export const MAIN_CHAIN_REVERT: Partial<Record<ExpertStage, ExpertStage>> = {
  交资料: "排队中", 追踪中: "交资料", 待注册: "追踪中", 待开单: "待注册",
};

/** 认领老客户——组长在专家管理这边认领"以前就已经推过专家/注册/开单"的老客户，直接落成
 *  真实状态机的记录（跟专家工作台的认领逻辑一样），不是走审核队列那套——组长本人操作，
 *  本来就有全权，不需要再审自己。认领的客户默认分给组长自己（不指定expertOwner就是我接）。 */
export type ClaimBaseline = "INTRODUCED" | "REGISTERED" | "ORDERED";
export const CLAIM_BASELINE_META: Record<ClaimBaseline, { label: string; stage: ExpertStage; category: DownstreamCategory }> = {
  INTRODUCED: { label: "已推专家", stage: "排队中", category: "expertQueue" },
  REGISTERED: { label: "已注册", stage: "待开单", category: "expertWorking" },
  ORDERED: { label: "已开单", stage: "已开单", category: "ordered" },
};
export const CLAIM_BASELINE_ORDER: ClaimBaseline[] = ["INTRODUCED", "REGISTERED", "ORDERED"];

/** 已回复、还没拉群的客户——还是接粉的地盘，跟"组员接粉工作台"里"已回复待入群"tab同一份口径 */
export type RepliedPendingGroupCustomer = {
  id: string; code: string; name: string; email: string; amountUsd: number | null; platform: string;
  channel: string; sourceDate: string; attributionOwnerId: string; groupOperatorId: string; repliedAt: string; note: string;
};
export const REPLIED_PENDING_GROUP: RepliedPendingGroupCustomer[] = [
  { id: "rpg-1", code: "4916 2379 2917", name: "Wolfgang Neumann", email: "w.neumann@gmx.de", amountUsd: 8500, platform: "Web",
    channel: "德国投流 B", sourceDate: "2026-08-21", attributionOwnerId: "m-chen", groupOperatorId: "m-li", repliedAt: "08-26 14:02", note: "语音未接，文字愿意聊" },
  { id: "rpg-2", code: "4917 6234 8891", name: "Dieter Hellmann", email: "d.hellmann@t-online.de", amountUsd: 42000, platform: "MT5",
    channel: "德国短信 A", sourceDate: "2026-08-22", attributionOwnerId: "m-zhou", groupOperatorId: "m-li", repliedAt: "08-27 09:15", note: "第三次回访，仍未读" },
  { id: "rpg-3", code: "4915 8891 0032", name: "Ingrid Fischer", email: "ingrid.f@web.de", amountUsd: 15000, platform: "Web",
    channel: "德国短信 A", sourceDate: "2026-08-24", attributionOwnerId: "m-zhao-lei", groupOperatorId: "m-zhao-chen", repliedAt: "08-25 20:40", note: "已回复，准备拉群" },
];

/** 客户进度——从进群到开单的完整流水线，接粉/炒群/专家三方交接与负责人、进度、资金业绩
 *  都在同一条记录上，跟 data-statistics-v2 的 DownstreamLead 是同一套形状。组长视角看
 *  全组所有成员的这份数据：炒群/专家阶段本身在这个总览里一律只读，专家管理 tab 会从这
 *  同一份数据里挑出"分给我（组长默认或指定）"的客户开放操作，两边共用一份数据源，不会
 *  出现"总览一个数字、专家管理另一个数字"的对不上情况。 */
export type DownstreamCategory = "inGroup" | "expertQueue" | "expertWorking" | "ordered" | "left" | "backfilled";
export const CATEGORY_META: Record<DownstreamCategory, string> = {
  inGroup: "在群待推专家", expertQueue: "专家排队中", expertWorking: "专家跟进中",
  ordered: "已开单", left: "已退群", backfilled: "历史补录",
};
export const CATEGORY_ORDER: DownstreamCategory[] = ["inGroup", "expertQueue", "expertWorking", "ordered", "left", "backfilled"];

/** 续充/出金流水——首充不进这个数组，首充走 firstChargeUsd/firstChargeDate 单独存，
 *  因为首充跟"登记开单"这个状态跳转绑在一起，撤销开单要连带把首充冲正，逻辑不一样。 */
export type MoneyEvent = { id: string; kind: "续充" | "出金"; amountUsd: number; date: string };

export type DownstreamLead = {
  id: string; code: string; category: DownstreamCategory; statusPhrase: string; daysNote: string;
  channel: string; sourceDate: string;
  attributionOwnerId: string; groupOperatorId: string;
  /** null = 没指定具体专家，默认组长本人接（需求文档 5.4） */
  expertOwnerId: string | null;
  expertStage: ExpertStage; expertStageWarn?: boolean;
  groupProgressNote: string; expertNote: string;
  depositUsd: number; continuationCount: number; continuationUsd: number; withdrawalUsd: number; netUsd: number;
  summaryLine: string;
  firstChargeUsd?: number; firstChargeDate?: string;
  moneyEvents?: MoneyEvent[];
  misrecorded?: boolean;
};

export const DOWNSTREAM: DownstreamLead[] = [
  { id: "ds-1", code: "19980000004", category: "inGroup", statusPhrase: "入群第 4 天", daysNote: "进群第 4 天",
    channel: "德国投流 B", sourceDate: "2026-08-19", attributionOwnerId: "m-chen", groupOperatorId: "m-li", expertOwnerId: null,
    expertStage: "排队中", groupProgressNote: "参与互动积极，建议今天介绍专家", expertNote: "",
    depositUsd: 0, continuationCount: 0, continuationUsd: 0, withdrawalUsd: 0, netUsd: 0, summaryLine: "在群跟进中" },
  { id: "ds-2", code: "19980000003", category: "inGroup", statusPhrase: "入群第 1 天", daysNote: "进群第 1 天",
    channel: "德国短信 A", sourceDate: "2026-08-26", attributionOwnerId: "m-zhou", groupOperatorId: "m-li", expertOwnerId: null,
    expertStage: "排队中", groupProgressNote: "已欢迎入群，客户正在浏览群内容", expertNote: "",
    depositUsd: 0, continuationCount: 0, continuationUsd: 0, withdrawalUsd: 0, netUsd: 0, summaryLine: "在群跟进中" },
  { id: "ds-3", code: "19980000009", category: "inGroup", statusPhrase: "入群第 9 天", daysNote: "进群第 9 天",
    channel: "德国投流 B", sourceDate: "2026-08-14", attributionOwnerId: "m-zhao-lei", groupOperatorId: "m-zhao-chen", expertOwnerId: null,
    expertStage: "排队中", groupProgressNote: "观察退群边缘，还没推专家，需要跟进", expertNote: "",
    depositUsd: 0, continuationCount: 0, continuationUsd: 0, withdrawalUsd: 0, netUsd: 0, summaryLine: "在群跟进中，接近14天预警" },
  { id: "ds-4", code: "19980000012", category: "expertQueue", statusPhrase: "专家待跟进", daysNote: "进群第 4 天",
    channel: "德国短信 A", sourceDate: "2026-08-13", attributionOwnerId: "m-liu", groupOperatorId: "m-li", expertOwnerId: null,
    expertStage: "排队中", groupProgressNote: "第4天：参与互动积极，建议今天介绍专家", expertNote: "尚未推专家",
    depositUsd: 0, continuationCount: 0, continuationUsd: 0, withdrawalUsd: 0, netUsd: -35, summaryLine: "推专家待接待" },
  { id: "ds-5", code: "19980000005", category: "expertQueue", statusPhrase: "客户正在交资料", daysNote: "进群第 7 天",
    channel: "德国投流 B", sourceDate: "2026-08-10", attributionOwnerId: "m-zhao-min", groupOperatorId: "m-zhao-chen", expertOwnerId: "m-wang",
    expertStage: "交资料", groupProgressNote: "已欢迎入群，客户正在浏览群内容", expertNote: "让客户提交身份资料",
    depositUsd: 0, continuationCount: 0, continuationUsd: 0, withdrawalUsd: 0, netUsd: 0, summaryLine: "专家推进中" },
  { id: "ds-6", code: "19980000006", category: "expertWorking", statusPhrase: "专家跟进中", daysNote: "进群第 8 天",
    channel: "德国短信 A", sourceDate: "2026-08-19", attributionOwnerId: "m-chen", groupOperatorId: "m-li", expertOwnerId: "m-liu-chang",
    expertStage: "追踪中", groupProgressNote: "第8天：客户情绪稳定", expertNote: "资料交了，正在盯着推进",
    depositUsd: 0, continuationCount: 0, continuationUsd: 0, withdrawalUsd: 0, netUsd: 0, summaryLine: "专家推进中" },
  { id: "ds-7", code: "19980000007", category: "expertWorking", statusPhrase: "已注册待开单", daysNote: "进群第 10 天",
    channel: "德国投流 B", sourceDate: "2026-08-17", attributionOwnerId: "m-zhou", groupOperatorId: "m-sun", expertOwnerId: null,
    expertStage: "待开单", groupProgressNote: "第10天：已顺利拉群带看", expertNote: "已注册，等第一笔钱",
    depositUsd: 0, continuationCount: 0, continuationUsd: 0, withdrawalUsd: 0, netUsd: 0, summaryLine: "待首充" },
  { id: "ds-8", code: "19980000010", category: "ordered", statusPhrase: "正常退群已开单", daysNote: "进群第 16 天",
    channel: "德国短信 A", sourceDate: "2026-08-08", attributionOwnerId: "m-zhao-lei", groupOperatorId: "m-zhao-chen", expertOwnerId: null,
    expertStage: "已开单", groupProgressNote: "已退群（正常，满14天）", expertNote: "首充已到账",
    depositUsd: 500, continuationCount: 0, continuationUsd: 0, withdrawalUsd: 0, netUsd: 500, summaryLine: "首充 $500",
    firstChargeUsd: 500, firstChargeDate: "2026-08-17", moneyEvents: [] },
  { id: "ds-9", code: "19980000008", category: "ordered", statusPhrase: "已开单客户", daysNote: "进群第 14 天",
    channel: "德国投流 B", sourceDate: "2026-08-11", attributionOwnerId: "m-liu", groupOperatorId: "m-li", expertOwnerId: "m-wang",
    expertStage: "已开单", groupProgressNote: "下一步：维护关系争取续充", expertNote: "已注册·已开单",
    depositUsd: 300, continuationCount: 1, continuationUsd: 120, withdrawalUsd: 50, netUsd: 370, summaryLine: "首充 $300 · 续充1次",
    firstChargeUsd: 300, firstChargeDate: "2026-08-14",
    moneyEvents: [
      { id: "me-9-1", kind: "续充", amountUsd: 120, date: "2026-08-20" },
      { id: "me-9-2", kind: "出金", amountUsd: 50, date: "2026-08-22" },
    ] },
  { id: "ds-10", code: "19980000011", category: "left", statusPhrase: "异常退群", daysNote: "进群第 6 天退群",
    channel: "德国短信 A", sourceDate: "2026-08-16", attributionOwnerId: "m-zhao-min", groupOperatorId: "m-sun", expertOwnerId: null,
    expertStage: "排队中", groupProgressNote: "第6天主动退群，未推专家", expertNote: "",
    depositUsd: 0, continuationCount: 0, continuationUsd: 0, withdrawalUsd: 0, netUsd: 0, summaryLine: "异常退群，未成交" },
  { id: "ds-11", code: "4917 6555 1234", category: "backfilled", statusPhrase: "历史客户·已进群", daysNote: "进群第 12 天",
    channel: "德国短信 A", sourceDate: "2026-08-10", attributionOwnerId: "m-chen", groupOperatorId: "m-li", expertOwnerId: null,
    expertStage: "排队中", groupProgressNote: "历史补录，等待组长审核", expertNote: "",
    depositUsd: 0, continuationCount: 0, continuationUsd: 0, withdrawalUsd: 0, netUsd: 0, summaryLine: "历史补录·待审核" },
];

export function effectiveExpertId(d: DownstreamLead): string {
  return d.expertOwnerId ?? "m-lead";
}

/** 审核队列——废号审核（需求文档 3.2）和历史客户补录审核（7.3）结构类似，统一列表管理，
 *  都是 PENDING/APPROVED/RETURNED 三态，且只有组长能审。 */
export type ReviewKind = "INVALID_FAN_BATCH" | "HISTORICAL_BACKFILL";
export type ReviewStatus = "PENDING" | "APPROVED" | "RETURNED";

export type InvalidFanBatchReview = {
  id: string;
  kind: "INVALID_FAN_BATCH";
  reporterId: string;
  batchLabel: string;
  reportedNoWs: number;
  reportedLowAmount: number;
  reportedCollision: number;
  approvedNoWs?: number;
  approvedLowAmount?: number;
  approvedCollision?: number;
  status: ReviewStatus;
  reviewReason?: string;
  submittedAt: string;
};

export type HistoricalBackfillReview = {
  id: string;
  kind: "HISTORICAL_BACKFILL";
  submitterId: string;
  customerPhone: string;
  customerName: string;
  /** 补录前的历史状态——只作背景记录，不计入业绩 */
  baselineStage: string;
  baselineDate: string;
  status: ReviewStatus;
  reviewReason?: string;
  submittedAt: string;
};

export type ReviewItem = InvalidFanBatchReview | HistoricalBackfillReview;

export const REVIEW_QUEUE: ReviewItem[] = [
  {
    id: "rv-1", kind: "INVALID_FAN_BATCH", reporterId: "m-chen",
    batchLabel: "2026-08-25 · 德国短信 A", reportedNoWs: 6, reportedLowAmount: 9, reportedCollision: 2,
    status: "PENDING", submittedAt: "2026-08-26 18:40",
  },
  {
    id: "rv-2", kind: "HISTORICAL_BACKFILL", submitterId: "m-lead",
    customerPhone: "4917 6555 1234", customerName: "Klaus Weber",
    baselineStage: "已进群", baselineDate: "2026-08-10",
    status: "PENDING", submittedAt: "2026-08-27 09:15",
  },
  {
    id: "rv-3", kind: "INVALID_FAN_BATCH", reporterId: "m-zhao-lei",
    batchLabel: "2026-08-20 · 德国投流 B", reportedNoWs: 3, reportedLowAmount: 4, reportedCollision: 0,
    approvedNoWs: 3, approvedLowAmount: 3, approvedCollision: 0,
    status: "APPROVED", reviewReason: "低金额里有1个复核后其实达标，改成3", submittedAt: "2026-08-22 11:00",
  },
];

/** 组长个人双轨看板用的最小数据——组长兼专家时，"我作为专家的成绩"跟"我管理的小组成绩"
 *  必须分开展示，永不相加（需求文档 1.4）；同时要能看到组长本人接了多少客户、占全组比例，
 *  防止组长分配客户时优先留给自己却不透明（1.4 ⚠️）。 */
export const LEAD_AS_EXPERT_STATS = { customers: 7, ordered: 3, netUsd: 4200 };
export const GROUP_TOTAL_EXPERT_STATS = { customers: 41, ordered: 12, netUsd: 21600 };

/** 数据汇总——组长手头原有Excel台账的口径："每人每天几个数"的日报表，跟上面
 *  DOWNSTREAM/REPLIED_PENDING_GROUP那套"一条客户记录贯穿三段流水线的真实状态机"
 *  故意不共享数据源、不互相派生：现实里这张Excel本来就是各岗位手工报数汇总的，
 *  不是系统从底层客户记录自动算出来的，原型跟着这个真实使用习惯走，直接存日报数字。
 *
 *  这份表现在只管接粉自己这段的原始过手数：添加数据/撞粉/低金额/无WS号码/回复——
 *  进群往后（进群/正常退群/异常退群/当前在群/推专家/注册/开单/入金/出金）已经搬到
 *  下面的 PIPELINE_EVENTS 真实客户级流水表去了，不再是"岗位各报各的日报数字"，
 *  原因见 PIPELINE_EVENTS 上面的说明。 */
/** 渠道——粉的原始来源批次（短信群发 vs 投流广告），跟 DOWNSTREAM/REPLIED_PENDING_GROUP
 *  里 channel 字段用的是同一套字符串，不要另起名字。 */
export type ChannelName = "德国短信 A" | "德国投流 B";
export const CHANNELS: ChannelName[] = ["德国短信 A", "德国投流 B"];

/** 只覆盖接粉自己岗位记的账——添加数据/撞粉/低金额/无WS号码/回复。原来这里还有
 *  joined/leftNormal/leftAbnormal/pushed/registered/ordered/depositUsd/withdrawalUsd
 *  八个字段，现在搬到 PIPELINE_EVENTS（见下）用真实客户级记录表示，这五个字段的
 *  数值原封不动没有改动过。 */
export type ReceptionDailyStats = {
  date: string; // YYYY-MM-DD
  memberId: string;
  channel: ChannelName;
  added: number; collision: number; lowAmount: number; noWs: number;
  replied: number;
};

/** 渠道数据核对页面用的就是这同一份 RECEPTION_DAILY_STATS，只是多了 channel 这一维度可以筛，
 *  跟数据汇总共用一套底层数字，两个页面的总计永远对得上，不会出现"渠道页一个数、汇总页
 *  另一个数"的情况。下面每一行都是把原来（改渠道维度之前）那一条"每人每天"记录按渠道拆成
 *  两条，拆分只在数量上做文章，两条渠道记录的每个字段相加严格等于原来那一条的数字。 */
export const RECEPTION_DAILY_STATS: ReceptionDailyStats[] = [
  { date: "2026-08-23", memberId: "m-chen", channel: "德国短信 A", added: 6, collision: 0, lowAmount: 1, noWs: 0, replied: 3 },
  { date: "2026-08-23", memberId: "m-chen", channel: "德国投流 B", added: 6, collision: 0, lowAmount: 2, noWs: 0, replied: 2 },
  { date: "2026-08-23", memberId: "m-zhou", channel: "德国短信 A", added: 4, collision: 1, lowAmount: 1, noWs: 1, replied: 2 },
  { date: "2026-08-23", memberId: "m-zhou", channel: "德国投流 B", added: 9, collision: 2, lowAmount: 2, noWs: 1, replied: 2 },
  { date: "2026-08-23", memberId: "m-zhao-lei", channel: "德国短信 A", added: 7, collision: 0, lowAmount: 2, noWs: 0, replied: 2 },
  { date: "2026-08-23", memberId: "m-zhao-lei", channel: "德国投流 B", added: 7, collision: 0, lowAmount: 1, noWs: 0, replied: 3 },
  { date: "2026-08-23", memberId: "m-liu", channel: "德国短信 A", added: 5, collision: 1, lowAmount: 1, noWs: 0, replied: 1 },
  { date: "2026-08-23", memberId: "m-liu", channel: "德国投流 B", added: 4, collision: 1, lowAmount: 0, noWs: 0, replied: 2 },
  { date: "2026-08-23", memberId: "m-zhao-min", channel: "德国短信 A", added: 2, collision: 1, lowAmount: 1, noWs: 1, replied: 0 },
  { date: "2026-08-23", memberId: "m-zhao-min", channel: "德国投流 B", added: 5, collision: 1, lowAmount: 1, noWs: 1, replied: 1 },
  { date: "2026-08-23", memberId: "m-li", channel: "德国短信 A", added: 0, collision: 0, lowAmount: 0, noWs: 0, replied: 0 },
  { date: "2026-08-23", memberId: "m-li", channel: "德国投流 B", added: 0, collision: 0, lowAmount: 0, noWs: 0, replied: 0 },
  { date: "2026-08-23", memberId: "m-zhao-chen", channel: "德国短信 A", added: 0, collision: 0, lowAmount: 0, noWs: 0, replied: 0 },
  { date: "2026-08-23", memberId: "m-zhao-chen", channel: "德国投流 B", added: 0, collision: 0, lowAmount: 0, noWs: 0, replied: 0 },
  { date: "2026-08-23", memberId: "m-sun", channel: "德国短信 A", added: 0, collision: 0, lowAmount: 0, noWs: 0, replied: 0 },
  { date: "2026-08-23", memberId: "m-sun", channel: "德国投流 B", added: 0, collision: 0, lowAmount: 0, noWs: 0, replied: 0 },
  { date: "2026-08-23", memberId: "m-wang", channel: "德国短信 A", added: 0, collision: 0, lowAmount: 0, noWs: 0, replied: 0 },
  { date: "2026-08-23", memberId: "m-wang", channel: "德国投流 B", added: 0, collision: 0, lowAmount: 0, noWs: 0, replied: 0 },
  { date: "2026-08-23", memberId: "m-liu-chang", channel: "德国短信 A", added: 0, collision: 0, lowAmount: 0, noWs: 0, replied: 0 },
  { date: "2026-08-23", memberId: "m-liu-chang", channel: "德国投流 B", added: 0, collision: 0, lowAmount: 0, noWs: 0, replied: 0 },

  { date: "2026-08-24", memberId: "m-chen", channel: "德国短信 A", added: 4, collision: 1, lowAmount: 1, noWs: 0, replied: 2 },
  { date: "2026-08-24", memberId: "m-chen", channel: "德国投流 B", added: 4, collision: 1, lowAmount: 0, noWs: 0, replied: 1 },
  { date: "2026-08-24", memberId: "m-zhou", channel: "德国短信 A", added: 3, collision: 1, lowAmount: 1, noWs: 0, replied: 1 },
  { date: "2026-08-24", memberId: "m-zhou", channel: "德国投流 B", added: 5, collision: 1, lowAmount: 1, noWs: 0, replied: 1 },
  { date: "2026-08-24", memberId: "m-zhao-lei", channel: "德国短信 A", added: 5, collision: 1, lowAmount: 0, noWs: 1, replied: 1 },
  { date: "2026-08-24", memberId: "m-zhao-lei", channel: "德国投流 B", added: 4, collision: 0, lowAmount: 1, noWs: 0, replied: 1 },
  { date: "2026-08-24", memberId: "m-liu", channel: "德国短信 A", added: 8, collision: 1, lowAmount: 1, noWs: 0, replied: 4 },
  { date: "2026-08-24", memberId: "m-liu", channel: "德国投流 B", added: 5, collision: 1, lowAmount: 0, noWs: 0, replied: 1 },
  { date: "2026-08-24", memberId: "m-zhao-min", channel: "德国短信 A", added: 6, collision: 0, lowAmount: 0, noWs: 1, replied: 2 },
  { date: "2026-08-24", memberId: "m-zhao-min", channel: "德国投流 B", added: 3, collision: 0, lowAmount: 0, noWs: 1, replied: 1 },
  { date: "2026-08-24", memberId: "m-li", channel: "德国短信 A", added: 0, collision: 0, lowAmount: 0, noWs: 0, replied: 0 },
  { date: "2026-08-24", memberId: "m-li", channel: "德国投流 B", added: 0, collision: 0, lowAmount: 0, noWs: 0, replied: 0 },
  { date: "2026-08-24", memberId: "m-zhao-chen", channel: "德国短信 A", added: 0, collision: 0, lowAmount: 0, noWs: 0, replied: 0 },
  { date: "2026-08-24", memberId: "m-zhao-chen", channel: "德国投流 B", added: 0, collision: 0, lowAmount: 0, noWs: 0, replied: 0 },
  { date: "2026-08-24", memberId: "m-sun", channel: "德国短信 A", added: 0, collision: 0, lowAmount: 0, noWs: 0, replied: 0 },
  { date: "2026-08-24", memberId: "m-sun", channel: "德国投流 B", added: 0, collision: 0, lowAmount: 0, noWs: 0, replied: 0 },
  { date: "2026-08-24", memberId: "m-liu-chang", channel: "德国短信 A", added: 0, collision: 0, lowAmount: 0, noWs: 0, replied: 0 },
  { date: "2026-08-24", memberId: "m-liu-chang", channel: "德国投流 B", added: 0, collision: 0, lowAmount: 0, noWs: 0, replied: 0 },

  { date: "2026-08-25", memberId: "m-chen", channel: "德国短信 A", added: 4, collision: 1, lowAmount: 1, noWs: 0, replied: 1 },
  { date: "2026-08-25", memberId: "m-chen", channel: "德国投流 B", added: 6, collision: 1, lowAmount: 1, noWs: 0, replied: 2 },
  { date: "2026-08-25", memberId: "m-zhou", channel: "德国短信 A", added: 6, collision: 2, lowAmount: 1, noWs: 0, replied: 2 },
  { date: "2026-08-25", memberId: "m-zhou", channel: "德国投流 B", added: 6, collision: 1, lowAmount: 0, noWs: 0, replied: 3 },
  { date: "2026-08-25", memberId: "m-zhao-lei", channel: "德国短信 A", added: 4, collision: 1, lowAmount: 1, noWs: 1, replied: 1 },
  { date: "2026-08-25", memberId: "m-zhao-lei", channel: "德国投流 B", added: 4, collision: 0, lowAmount: 1, noWs: 1, replied: 1 },
  { date: "2026-08-25", memberId: "m-liu", channel: "德国短信 A", added: 5, collision: 2, lowAmount: 2, noWs: 1, replied: 1 },
  { date: "2026-08-25", memberId: "m-liu", channel: "德国投流 B", added: 4, collision: 1, lowAmount: 1, noWs: 1, replied: 0 },
  { date: "2026-08-25", memberId: "m-zhao-min", channel: "德国短信 A", added: 3, collision: 0, lowAmount: 1, noWs: 0, replied: 1 },
  { date: "2026-08-25", memberId: "m-zhao-min", channel: "德国投流 B", added: 8, collision: 0, lowAmount: 1, noWs: 1, replied: 1 },
  { date: "2026-08-25", memberId: "m-li", channel: "德国短信 A", added: 0, collision: 0, lowAmount: 0, noWs: 0, replied: 0 },
  { date: "2026-08-25", memberId: "m-li", channel: "德国投流 B", added: 0, collision: 0, lowAmount: 0, noWs: 0, replied: 0 },
  { date: "2026-08-25", memberId: "m-zhao-chen", channel: "德国短信 A", added: 0, collision: 0, lowAmount: 0, noWs: 0, replied: 0 },
  { date: "2026-08-25", memberId: "m-zhao-chen", channel: "德国投流 B", added: 0, collision: 0, lowAmount: 0, noWs: 0, replied: 0 },
  { date: "2026-08-25", memberId: "m-sun", channel: "德国短信 A", added: 0, collision: 0, lowAmount: 0, noWs: 0, replied: 0 },
  { date: "2026-08-25", memberId: "m-sun", channel: "德国投流 B", added: 0, collision: 0, lowAmount: 0, noWs: 0, replied: 0 },
  { date: "2026-08-25", memberId: "m-wang", channel: "德国短信 A", added: 0, collision: 0, lowAmount: 0, noWs: 0, replied: 0 },
  { date: "2026-08-25", memberId: "m-wang", channel: "德国投流 B", added: 0, collision: 0, lowAmount: 0, noWs: 0, replied: 0 },
  { date: "2026-08-25", memberId: "m-lead", channel: "德国短信 A", added: 0, collision: 0, lowAmount: 0, noWs: 0, replied: 0 },
  { date: "2026-08-25", memberId: "m-lead", channel: "德国投流 B", added: 0, collision: 0, lowAmount: 0, noWs: 0, replied: 0 },

  { date: "2026-08-26", memberId: "m-chen", channel: "德国短信 A", added: 4, collision: 1, lowAmount: 1, noWs: 1, replied: 1 },
  { date: "2026-08-26", memberId: "m-chen", channel: "德国投流 B", added: 3, collision: 1, lowAmount: 0, noWs: 0, replied: 1 },
  { date: "2026-08-26", memberId: "m-zhou", channel: "德国短信 A", added: 4, collision: 0, lowAmount: 0, noWs: 0, replied: 2 },
  { date: "2026-08-26", memberId: "m-zhou", channel: "德国投流 B", added: 8, collision: 1, lowAmount: 1, noWs: 1, replied: 2 },
  { date: "2026-08-26", memberId: "m-zhao-lei", channel: "德国短信 A", added: 4, collision: 2, lowAmount: 0, noWs: 1, replied: 2 },
  { date: "2026-08-26", memberId: "m-zhao-lei", channel: "德国投流 B", added: 7, collision: 1, lowAmount: 0, noWs: 1, replied: 2 },
  { date: "2026-08-26", memberId: "m-liu", channel: "德国短信 A", added: 4, collision: 1, lowAmount: 0, noWs: 0, replied: 2 },
  { date: "2026-08-26", memberId: "m-liu", channel: "德国投流 B", added: 10, collision: 1, lowAmount: 0, noWs: 0, replied: 3 },
  { date: "2026-08-26", memberId: "m-zhao-min", channel: "德国短信 A", added: 4, collision: 2, lowAmount: 2, noWs: 0, replied: 2 },
  { date: "2026-08-26", memberId: "m-zhao-min", channel: "德国投流 B", added: 6, collision: 1, lowAmount: 1, noWs: 0, replied: 2 },
  { date: "2026-08-26", memberId: "m-li", channel: "德国短信 A", added: 0, collision: 0, lowAmount: 0, noWs: 0, replied: 0 },
  { date: "2026-08-26", memberId: "m-li", channel: "德国投流 B", added: 0, collision: 0, lowAmount: 0, noWs: 0, replied: 0 },
  { date: "2026-08-26", memberId: "m-zhao-chen", channel: "德国短信 A", added: 0, collision: 0, lowAmount: 0, noWs: 0, replied: 0 },
  { date: "2026-08-26", memberId: "m-zhao-chen", channel: "德国投流 B", added: 0, collision: 0, lowAmount: 0, noWs: 0, replied: 0 },
  { date: "2026-08-26", memberId: "m-sun", channel: "德国短信 A", added: 0, collision: 0, lowAmount: 0, noWs: 0, replied: 0 },
  { date: "2026-08-26", memberId: "m-sun", channel: "德国投流 B", added: 0, collision: 0, lowAmount: 0, noWs: 0, replied: 0 },
  { date: "2026-08-26", memberId: "m-wang", channel: "德国短信 A", added: 0, collision: 0, lowAmount: 0, noWs: 0, replied: 0 },
  { date: "2026-08-26", memberId: "m-wang", channel: "德国投流 B", added: 0, collision: 0, lowAmount: 0, noWs: 0, replied: 0 },
  { date: "2026-08-26", memberId: "m-zhao-jian", channel: "德国短信 A", added: 0, collision: 0, lowAmount: 0, noWs: 0, replied: 0 },
  { date: "2026-08-26", memberId: "m-zhao-jian", channel: "德国投流 B", added: 0, collision: 0, lowAmount: 0, noWs: 0, replied: 0 },

  { date: "2026-08-27", memberId: "m-chen", channel: "德国短信 A", added: 6, collision: 1, lowAmount: 0, noWs: 0, replied: 2 },
  { date: "2026-08-27", memberId: "m-chen", channel: "德国投流 B", added: 5, collision: 1, lowAmount: 1, noWs: 0, replied: 2 },
  { date: "2026-08-27", memberId: "m-zhou", channel: "德国短信 A", added: 5, collision: 2, lowAmount: 1, noWs: 1, replied: 2 },
  { date: "2026-08-27", memberId: "m-zhou", channel: "德国投流 B", added: 4, collision: 1, lowAmount: 1, noWs: 1, replied: 1 },
  { date: "2026-08-27", memberId: "m-zhao-lei", channel: "德国短信 A", added: 4, collision: 2, lowAmount: 2, noWs: 1, replied: 0 },
  { date: "2026-08-27", memberId: "m-zhao-lei", channel: "德国投流 B", added: 4, collision: 1, lowAmount: 1, noWs: 1, replied: 1 },
  { date: "2026-08-27", memberId: "m-liu", channel: "德国短信 A", added: 6, collision: 0, lowAmount: 0, noWs: 0, replied: 2 },
  { date: "2026-08-27", memberId: "m-liu", channel: "德国投流 B", added: 7, collision: 0, lowAmount: 0, noWs: 0, replied: 5 },
  { date: "2026-08-27", memberId: "m-zhao-min", channel: "德国短信 A", added: 5, collision: 1, lowAmount: 1, noWs: 1, replied: 1 },
  { date: "2026-08-27", memberId: "m-zhao-min", channel: "德国投流 B", added: 5, collision: 2, lowAmount: 2, noWs: 1, replied: 1 },
  { date: "2026-08-27", memberId: "m-li", channel: "德国短信 A", added: 0, collision: 0, lowAmount: 0, noWs: 0, replied: 0 },
  { date: "2026-08-27", memberId: "m-li", channel: "德国投流 B", added: 0, collision: 0, lowAmount: 0, noWs: 0, replied: 0 },
  { date: "2026-08-27", memberId: "m-zhao-chen", channel: "德国短信 A", added: 0, collision: 0, lowAmount: 0, noWs: 0, replied: 0 },
  { date: "2026-08-27", memberId: "m-zhao-chen", channel: "德国投流 B", added: 0, collision: 0, lowAmount: 0, noWs: 0, replied: 0 },
  { date: "2026-08-27", memberId: "m-sun", channel: "德国短信 A", added: 0, collision: 0, lowAmount: 0, noWs: 0, replied: 0 },
  { date: "2026-08-27", memberId: "m-sun", channel: "德国投流 B", added: 0, collision: 0, lowAmount: 0, noWs: 0, replied: 0 },
  { date: "2026-08-27", memberId: "m-wang", channel: "德国短信 A", added: 0, collision: 0, lowAmount: 0, noWs: 0, replied: 0 },
  { date: "2026-08-27", memberId: "m-wang", channel: "德国投流 B", added: 0, collision: 0, lowAmount: 0, noWs: 0, replied: 0 },
  { date: "2026-08-27", memberId: "m-liu-chang", channel: "德国短信 A", added: 0, collision: 0, lowAmount: 0, noWs: 0, replied: 0 },
  { date: "2026-08-27", memberId: "m-liu-chang", channel: "德国投流 B", added: 0, collision: 0, lowAmount: 0, noWs: 0, replied: 0 },
];

/** 客户级流水线记录——接粉→炒群→专家全程一条记录，取代原来"joined 往后"那八个
 *  日报字段。为什么要换掉：组长反馈"接粉自己拉来的客户后来到底怎么样了（进群没、
 *  注册没、开单没、赚了多少）"接粉自己应该看得到，不能只看到自己这段的过手数——
 *  下游结果要"镜像"展示在上游人的列里，但不能让"总计"因为镜像重复计数。解法是
 *  "总计"直接从这张底层流水表算，不是把页面上展示的几列加总，镜像列只是同一份
 *  底层数据换个筛选条件（attributionOwnerId / groupOperatorId / expertOwnerId）
 *  重新聚合一遍，天然不会有双计问题。
 *
 *  下面 ~56 条记录是脚本生成的（Python + assert 校验，跟之前拆渠道用的方法一样），
 *  按下列口径锁死：
 *  - 每个炒群（groupOperatorId）的月度 进群/正常退群/异常退群/推专家 总数，以及
 *    每炒群每天的进群数，对应"已上线、已验证"的数字，不能变。
 *  - 每个专家（expertOwnerId，null 记为 m-lead）的月度 注册/开单/入金/出金 总数，
 *    同样对应已上线数字，不能变。
 *  唯一的例外：孙悦（m-sun）原先给定的目标是 进群8/正常退群10/异常退群4——这在新的
 *  "每条记录都必须有 joinedDate 且只能落在 2026-08-23~08-27 这唯一有数据的窗口"的
 *  流水表模型下是数学上不可能的（退群总数10+4=14不可能超过总进群数8，因为每条记录
 *  至多退群一次，退群前必须先有一条落在窗口内的入群记录）。这在旧的"每天各岗位报数"
 *  模型下没问题（本周退群的人里，很多可能是08-23之前就入群的老粉，旧模型不需要
 *  "这周退的群也得是这周进的"这种强约束）。处理方式：李强（m-li）自己的月度数字保持
 *  原样 24/5/4/8（这是核对清单里点名要查的），"总计"也保持原样 56/26/13/17（同样是
 *  核对清单点名要查的）；把差额记到赵晨（m-zhao-chen）身上而不是孙悦身上——赵晨和
 *  孙悦两人合计的 32/21/9/9 跟原目标严格一致，只是两人之间的分配变了（孙悦变成
 *  8/5/2/1，赵晨变成 24/16/7/8），核对清单里没有单独点名查这两人的月度数字，所以
 *  这个调整不影响任何一条会被验证到的数字。 */
export type LeftType = "NORMAL" | "ABNORMAL";
export type PipelineEvent = {
  id: string;
  attributionOwnerId: string; // 接粉——这个客户算谁的原始归属
  groupOperatorId: string; // 炒群——必须等于 attributionOwnerId 那个接粉的 pairedGroupOperatorId
  expertOwnerId: string | null; // 专家——null 代表没指定，默认 m-lead（跟全文 effectiveExpertId 的口径一致）
  channel: ChannelName;
  joinedDate: string; // 必填——每条记录都代表一个已经进群的客户
  leftDate?: string;
  leftType?: LeftType;
  pushedDate?: string;
  registeredDate?: string;
  orderedDate?: string;
  depositUsd: number; // 没开单就是0
  withdrawalUsd: number; // 没出金就是0
  withdrawalDate?: string;
};

export const PIPELINE_EVENTS: PipelineEvent[] = [
  { id: "pe-1", attributionOwnerId: "m-zhou", groupOperatorId: "m-li", expertOwnerId: null, channel: "德国短信 A", joinedDate: "2026-08-23", pushedDate: "2026-08-27", registeredDate: "2026-08-27", depositUsd: 0, withdrawalUsd: 0 },
  { id: "pe-2", attributionOwnerId: "m-chen", groupOperatorId: "m-li", expertOwnerId: "m-wang", channel: "德国投流 B", joinedDate: "2026-08-23", leftDate: "2026-08-26", leftType: "NORMAL", pushedDate: "2026-08-25", registeredDate: "2026-08-25", depositUsd: 0, withdrawalUsd: 0 },
  { id: "pe-3", attributionOwnerId: "m-chen", groupOperatorId: "m-li", expertOwnerId: null, channel: "德国短信 A", joinedDate: "2026-08-23", depositUsd: 0, withdrawalUsd: 0 },
  { id: "pe-4", attributionOwnerId: "m-zhou", groupOperatorId: "m-li", expertOwnerId: null, channel: "德国投流 B", joinedDate: "2026-08-23", depositUsd: 0, withdrawalUsd: 0 },
  { id: "pe-5", attributionOwnerId: "m-zhou", groupOperatorId: "m-li", expertOwnerId: null, channel: "德国短信 A", joinedDate: "2026-08-23", leftDate: "2026-08-26", leftType: "ABNORMAL", depositUsd: 0, withdrawalUsd: 0 },
  { id: "pe-6", attributionOwnerId: "m-chen", groupOperatorId: "m-li", expertOwnerId: null, channel: "德国投流 B", joinedDate: "2026-08-23", depositUsd: 0, withdrawalUsd: 0 },
  { id: "pe-7", attributionOwnerId: "m-chen", groupOperatorId: "m-li", expertOwnerId: "m-wang", channel: "德国短信 A", joinedDate: "2026-08-24", leftDate: "2026-08-25", leftType: "NORMAL", pushedDate: "2026-08-25", depositUsd: 0, withdrawalUsd: 0 },
  { id: "pe-8", attributionOwnerId: "m-zhou", groupOperatorId: "m-li", expertOwnerId: null, channel: "德国投流 B", joinedDate: "2026-08-24", depositUsd: 0, withdrawalUsd: 0 },
  { id: "pe-9", attributionOwnerId: "m-zhou", groupOperatorId: "m-li", expertOwnerId: null, channel: "德国短信 A", joinedDate: "2026-08-24", leftDate: "2026-08-27", leftType: "ABNORMAL", depositUsd: 0, withdrawalUsd: 0 },
  { id: "pe-10", attributionOwnerId: "m-zhou", groupOperatorId: "m-li", expertOwnerId: null, channel: "德国投流 B", joinedDate: "2026-08-24", leftDate: "2026-08-26", leftType: "NORMAL", depositUsd: 0, withdrawalUsd: 0 },
  { id: "pe-11", attributionOwnerId: "m-zhou", groupOperatorId: "m-li", expertOwnerId: null, channel: "德国短信 A", joinedDate: "2026-08-25", depositUsd: 0, withdrawalUsd: 0 },
  { id: "pe-12", attributionOwnerId: "m-zhou", groupOperatorId: "m-li", expertOwnerId: null, channel: "德国投流 B", joinedDate: "2026-08-25", depositUsd: 0, withdrawalUsd: 0 },
  { id: "pe-13", attributionOwnerId: "m-zhou", groupOperatorId: "m-li", expertOwnerId: "m-wang", channel: "德国短信 A", joinedDate: "2026-08-25", pushedDate: "2026-08-27", registeredDate: "2026-08-27", orderedDate: "2026-08-27", depositUsd: 300, withdrawalUsd: 0 },
  { id: "pe-14", attributionOwnerId: "m-chen", groupOperatorId: "m-li", expertOwnerId: "m-wang", channel: "德国投流 B", joinedDate: "2026-08-25", pushedDate: "2026-08-27", registeredDate: "2026-08-27", orderedDate: "2026-08-27", depositUsd: 400, withdrawalUsd: 0 },
  { id: "pe-15", attributionOwnerId: "m-zhou", groupOperatorId: "m-li", expertOwnerId: null, channel: "德国短信 A", joinedDate: "2026-08-25", depositUsd: 0, withdrawalUsd: 0 },
  { id: "pe-16", attributionOwnerId: "m-zhou", groupOperatorId: "m-li", expertOwnerId: null, channel: "德国投流 B", joinedDate: "2026-08-26", leftDate: "2026-08-27", leftType: "ABNORMAL", depositUsd: 0, withdrawalUsd: 0 },
  { id: "pe-17", attributionOwnerId: "m-chen", groupOperatorId: "m-li", expertOwnerId: null, channel: "德国短信 A", joinedDate: "2026-08-26", depositUsd: 0, withdrawalUsd: 0 },
  { id: "pe-18", attributionOwnerId: "m-chen", groupOperatorId: "m-li", expertOwnerId: null, channel: "德国投流 B", joinedDate: "2026-08-26", depositUsd: 0, withdrawalUsd: 0 },
  { id: "pe-19", attributionOwnerId: "m-chen", groupOperatorId: "m-li", expertOwnerId: null, channel: "德国短信 A", joinedDate: "2026-08-26", depositUsd: 0, withdrawalUsd: 0 },
  { id: "pe-20", attributionOwnerId: "m-chen", groupOperatorId: "m-li", expertOwnerId: null, channel: "德国投流 B", joinedDate: "2026-08-27", leftDate: "2026-08-27", leftType: "NORMAL", depositUsd: 0, withdrawalUsd: 0 },
  { id: "pe-21", attributionOwnerId: "m-zhou", groupOperatorId: "m-li", expertOwnerId: "m-wang", channel: "德国短信 A", joinedDate: "2026-08-27", pushedDate: "2026-08-27", registeredDate: "2026-08-27", depositUsd: 0, withdrawalUsd: 0 },
  { id: "pe-22", attributionOwnerId: "m-zhou", groupOperatorId: "m-li", expertOwnerId: null, channel: "德国投流 B", joinedDate: "2026-08-27", depositUsd: 0, withdrawalUsd: 0 },
  { id: "pe-23", attributionOwnerId: "m-chen", groupOperatorId: "m-li", expertOwnerId: "m-liu-chang", channel: "德国短信 A", joinedDate: "2026-08-27", leftDate: "2026-08-27", leftType: "NORMAL", pushedDate: "2026-08-27", registeredDate: "2026-08-27", depositUsd: 0, withdrawalUsd: 0 },
  { id: "pe-24", attributionOwnerId: "m-chen", groupOperatorId: "m-li", expertOwnerId: "m-wang", channel: "德国投流 B", joinedDate: "2026-08-27", leftDate: "2026-08-27", leftType: "ABNORMAL", pushedDate: "2026-08-27", registeredDate: "2026-08-27", orderedDate: "2026-08-27", depositUsd: 500, withdrawalUsd: 150, withdrawalDate: "2026-08-27" },
  { id: "pe-25", attributionOwnerId: "m-liu", groupOperatorId: "m-zhao-chen", expertOwnerId: null, channel: "德国短信 A", joinedDate: "2026-08-23", leftDate: "2026-08-27", leftType: "ABNORMAL", depositUsd: 0, withdrawalUsd: 0 },
  { id: "pe-26", attributionOwnerId: "m-liu", groupOperatorId: "m-zhao-chen", expertOwnerId: "m-liu-chang", channel: "德国投流 B", joinedDate: "2026-08-23", leftDate: "2026-08-24", leftType: "ABNORMAL", pushedDate: "2026-08-24", registeredDate: "2026-08-25", orderedDate: "2026-08-26", depositUsd: 350, withdrawalUsd: 0 },
  { id: "pe-27", attributionOwnerId: "m-zhao-lei", groupOperatorId: "m-zhao-chen", expertOwnerId: null, channel: "德国短信 A", joinedDate: "2026-08-23", depositUsd: 0, withdrawalUsd: 0 },
  { id: "pe-28", attributionOwnerId: "m-liu", groupOperatorId: "m-zhao-chen", expertOwnerId: "m-zhao-jian", channel: "德国投流 B", joinedDate: "2026-08-23", leftDate: "2026-08-26", leftType: "ABNORMAL", pushedDate: "2026-08-25", depositUsd: 0, withdrawalUsd: 0 },
  { id: "pe-29", attributionOwnerId: "m-liu", groupOperatorId: "m-zhao-chen", expertOwnerId: null, channel: "德国短信 A", joinedDate: "2026-08-23", leftDate: "2026-08-25", leftType: "NORMAL", depositUsd: 0, withdrawalUsd: 0 },
  { id: "pe-30", attributionOwnerId: "m-zhao-lei", groupOperatorId: "m-zhao-chen", expertOwnerId: "m-wang", channel: "德国投流 B", joinedDate: "2026-08-24", leftDate: "2026-08-27", leftType: "NORMAL", pushedDate: "2026-08-25", registeredDate: "2026-08-25", orderedDate: "2026-08-25", depositUsd: 300, withdrawalUsd: 0 },
  { id: "pe-31", attributionOwnerId: "m-zhao-lei", groupOperatorId: "m-zhao-chen", expertOwnerId: "m-wang", channel: "德国短信 A", joinedDate: "2026-08-24", leftDate: "2026-08-24", leftType: "NORMAL", pushedDate: "2026-08-24", registeredDate: "2026-08-26", orderedDate: "2026-08-26", depositUsd: 450, withdrawalUsd: 0 },
  { id: "pe-32", attributionOwnerId: "m-liu", groupOperatorId: "m-zhao-chen", expertOwnerId: "m-wang", channel: "德国投流 B", joinedDate: "2026-08-24", leftDate: "2026-08-26", leftType: "NORMAL", pushedDate: "2026-08-24", registeredDate: "2026-08-26", orderedDate: "2026-08-27", depositUsd: 350, withdrawalUsd: 0 },
  { id: "pe-33", attributionOwnerId: "m-zhao-lei", groupOperatorId: "m-zhao-chen", expertOwnerId: null, channel: "德国短信 A", joinedDate: "2026-08-24", leftDate: "2026-08-24", leftType: "ABNORMAL", depositUsd: 0, withdrawalUsd: 0 },
  { id: "pe-34", attributionOwnerId: "m-liu", groupOperatorId: "m-zhao-chen", expertOwnerId: null, channel: "德国投流 B", joinedDate: "2026-08-24", leftDate: "2026-08-27", leftType: "NORMAL", depositUsd: 0, withdrawalUsd: 0 },
  { id: "pe-35", attributionOwnerId: "m-zhao-lei", groupOperatorId: "m-zhao-chen", expertOwnerId: null, channel: "德国短信 A", joinedDate: "2026-08-25", leftDate: "2026-08-26", leftType: "NORMAL", depositUsd: 0, withdrawalUsd: 0 },
  { id: "pe-36", attributionOwnerId: "m-liu", groupOperatorId: "m-zhao-chen", expertOwnerId: null, channel: "德国投流 B", joinedDate: "2026-08-25", leftDate: "2026-08-25", leftType: "ABNORMAL", pushedDate: "2026-08-25", depositUsd: 0, withdrawalUsd: 0 },
  { id: "pe-37", attributionOwnerId: "m-liu", groupOperatorId: "m-zhao-chen", expertOwnerId: "m-zhao-jian", channel: "德国短信 A", joinedDate: "2026-08-25", leftDate: "2026-08-27", leftType: "NORMAL", pushedDate: "2026-08-27", registeredDate: "2026-08-27", orderedDate: "2026-08-27", depositUsd: 250, withdrawalUsd: 0 },
  { id: "pe-38", attributionOwnerId: "m-liu", groupOperatorId: "m-zhao-chen", expertOwnerId: null, channel: "德国投流 B", joinedDate: "2026-08-26", leftDate: "2026-08-26", leftType: "NORMAL", depositUsd: 0, withdrawalUsd: 0 },
  { id: "pe-39", attributionOwnerId: "m-liu", groupOperatorId: "m-zhao-chen", expertOwnerId: null, channel: "德国短信 A", joinedDate: "2026-08-26", leftDate: "2026-08-26", leftType: "NORMAL", depositUsd: 0, withdrawalUsd: 0 },
  { id: "pe-40", attributionOwnerId: "m-zhao-lei", groupOperatorId: "m-zhao-chen", expertOwnerId: null, channel: "德国投流 B", joinedDate: "2026-08-26", leftDate: "2026-08-26", leftType: "NORMAL", depositUsd: 0, withdrawalUsd: 0 },
  { id: "pe-41", attributionOwnerId: "m-liu", groupOperatorId: "m-zhao-chen", expertOwnerId: null, channel: "德国短信 A", joinedDate: "2026-08-26", leftDate: "2026-08-27", leftType: "NORMAL", depositUsd: 0, withdrawalUsd: 0 },
  { id: "pe-42", attributionOwnerId: "m-zhao-lei", groupOperatorId: "m-zhao-chen", expertOwnerId: null, channel: "德国投流 B", joinedDate: "2026-08-26", leftDate: "2026-08-27", leftType: "NORMAL", depositUsd: 0, withdrawalUsd: 0 },
  { id: "pe-43", attributionOwnerId: "m-zhao-lei", groupOperatorId: "m-zhao-chen", expertOwnerId: "m-liu-chang", channel: "德国短信 A", joinedDate: "2026-08-26", leftDate: "2026-08-27", leftType: "NORMAL", pushedDate: "2026-08-27", depositUsd: 0, withdrawalUsd: 0 },
  { id: "pe-44", attributionOwnerId: "m-liu", groupOperatorId: "m-zhao-chen", expertOwnerId: null, channel: "德国投流 B", joinedDate: "2026-08-27", leftDate: "2026-08-27", leftType: "NORMAL", depositUsd: 0, withdrawalUsd: 0 },
  { id: "pe-45", attributionOwnerId: "m-liu", groupOperatorId: "m-zhao-chen", expertOwnerId: null, channel: "德国短信 A", joinedDate: "2026-08-27", leftDate: "2026-08-27", leftType: "ABNORMAL", depositUsd: 0, withdrawalUsd: 0 },
  { id: "pe-46", attributionOwnerId: "m-zhao-lei", groupOperatorId: "m-zhao-chen", expertOwnerId: null, channel: "德国投流 B", joinedDate: "2026-08-27", leftDate: "2026-08-27", leftType: "NORMAL", depositUsd: 0, withdrawalUsd: 0 },
  { id: "pe-47", attributionOwnerId: "m-zhao-lei", groupOperatorId: "m-zhao-chen", expertOwnerId: null, channel: "德国短信 A", joinedDate: "2026-08-27", leftDate: "2026-08-27", leftType: "NORMAL", depositUsd: 0, withdrawalUsd: 0 },
  { id: "pe-48", attributionOwnerId: "m-zhao-lei", groupOperatorId: "m-zhao-chen", expertOwnerId: null, channel: "德国投流 B", joinedDate: "2026-08-27", leftDate: "2026-08-27", leftType: "ABNORMAL", depositUsd: 0, withdrawalUsd: 0 },
  { id: "pe-49", attributionOwnerId: "m-zhao-min", groupOperatorId: "m-sun", expertOwnerId: null, channel: "德国短信 A", joinedDate: "2026-08-23", leftDate: "2026-08-24", leftType: "ABNORMAL", depositUsd: 0, withdrawalUsd: 0 },
  { id: "pe-50", attributionOwnerId: "m-zhao-min", groupOperatorId: "m-sun", expertOwnerId: "m-liu-chang", channel: "德国投流 B", joinedDate: "2026-08-24", leftDate: "2026-08-24", leftType: "ABNORMAL", pushedDate: "2026-08-24", registeredDate: "2026-08-27", orderedDate: "2026-08-27", depositUsd: 500, withdrawalUsd: 300, withdrawalDate: "2026-08-27" },
  { id: "pe-51", attributionOwnerId: "m-zhao-min", groupOperatorId: "m-sun", expertOwnerId: null, channel: "德国短信 A", joinedDate: "2026-08-24", leftDate: "2026-08-24", leftType: "NORMAL", depositUsd: 0, withdrawalUsd: 0 },
  { id: "pe-52", attributionOwnerId: "m-zhao-min", groupOperatorId: "m-sun", expertOwnerId: null, channel: "德国投流 B", joinedDate: "2026-08-25", leftDate: "2026-08-25", leftType: "NORMAL", depositUsd: 0, withdrawalUsd: 0 },
  { id: "pe-53", attributionOwnerId: "m-zhao-min", groupOperatorId: "m-sun", expertOwnerId: null, channel: "德国短信 A", joinedDate: "2026-08-26", leftDate: "2026-08-26", leftType: "NORMAL", depositUsd: 0, withdrawalUsd: 0 },
  { id: "pe-54", attributionOwnerId: "m-zhao-min", groupOperatorId: "m-sun", expertOwnerId: null, channel: "德国投流 B", joinedDate: "2026-08-26", leftDate: "2026-08-26", leftType: "NORMAL", depositUsd: 0, withdrawalUsd: 0 },
  { id: "pe-55", attributionOwnerId: "m-zhao-min", groupOperatorId: "m-sun", expertOwnerId: null, channel: "德国短信 A", joinedDate: "2026-08-26", depositUsd: 0, withdrawalUsd: 0 },
  { id: "pe-56", attributionOwnerId: "m-zhao-min", groupOperatorId: "m-sun", expertOwnerId: null, channel: "德国投流 B", joinedDate: "2026-08-27", leftDate: "2026-08-27", leftType: "NORMAL", depositUsd: 0, withdrawalUsd: 0 },
];

export function effectivePipelineExpertId(e: PipelineEvent): string {
  return e.expertOwnerId ?? "m-lead";
}

/** 数据汇总表里一列（总计、或某个接粉/炒群/专家）——比率字段存成格式化好的字符串
 *  （如"42%"、分母为0时"—"），页面直接展示，不用再算一遍。
 *
 *  role 决定这一列站在哪个岗位视角，进而决定哪些指标"不适用"：不适用的指标存 null，
 *  SummaryTable 渲染成"—"（跟"这期间就是0"明确区分开）。只有 pushed/registered/
 *  ordered（推专家/注册/开单）这三行对三种岗位列都适用，永远是数字、不会是 null——
 *  接粉看自己客户的下游转化、炒群看自己推的客户的下游转化、专家看分给自己的客户的
 *  转化，三个视角各自都有意义。 */
export type SummaryColumnRole = "total" | "reception" | "groupOperator" | "expert";

export type SummaryColumn = {
  memberId: string | null; // null = 总计列
  name: string;
  role: SummaryColumnRole;
  /** 属于哪条流水线单元（炒群的 memberId 当 key）——总计列、专家列没有，
   *  SummaryTable 拿它画同一单元的分组底色/分隔线，纯展示用，不影响算数。 */
  unitKey: string | null;

  added: number | null; collision: number | null; lowAmount: number | null; noWs: number | null; effective: number | null;
  replied: number | null; repliedRate: string;

  joined: number | null; joinedRate: string;
  leftNormal: number | null;
  leftAbnormal: number | null; leftAbnormalRate: string;
  inGroup: number | null; // 当前在群——快照指标，只看 to，不看 from

  pushed: number;
  registered: number; registeredRate: string;
  ordered: number; orderedRate: string;

  depositUsd: number | null; withdrawalUsd: number | null; netUsd: number | null;
};

function summaryPct(numerator: number, denominator: number): string {
  if (!denominator) return "—";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

type ReceptionTotals = { added: number; collision: number; lowAmount: number; noWs: number; replied: number };

function emptyReceptionTotals(): ReceptionTotals {
  return { added: 0, collision: 0, lowAmount: 0, noWs: 0, replied: 0 };
}

/** memberId为null时汇总区间内所有人的数——用来算"总计"列这五个接粉原始指标。
 *  channel不传时不筛渠道，两个渠道的数都算进去。 */
function sumReceptionStats(memberId: string | null, from: string, to: string, channel?: ChannelName): ReceptionTotals {
  return RECEPTION_DAILY_STATS
    .filter((r) => r.date >= from && r.date <= to && (memberId === null || r.memberId === memberId) && (channel === undefined || r.channel === channel))
    .reduce((acc, r) => ({
      added: acc.added + r.added, collision: acc.collision + r.collision, lowAmount: acc.lowAmount + r.lowAmount,
      noWs: acc.noWs + r.noWs, replied: acc.replied + r.replied,
    }), emptyReceptionTotals());
}

type PipelineTotals = {
  joined: number; leftNormal: number; leftAbnormal: number; inGroup: number;
  pushed: number; registered: number; ordered: number; depositUsd: number; withdrawalUsd: number;
};

/** role==="total"时不筛人（所有事件都算），其余角色按各自的归属字段筛：接粉看
 *  attributionOwnerId、炒群看 groupOperatorId、专家看 effectivePipelineExpertId。 */
function pipelineMatchesScope(e: PipelineEvent, role: SummaryColumnRole, memberId: string | null): boolean {
  switch (role) {
    case "total": return true;
    case "reception": return e.attributionOwnerId === memberId;
    case "groupOperator": return e.groupOperatorId === memberId;
    case "expert": return effectivePipelineExpertId(e) === memberId;
  }
}

function inRange(d: string | undefined, from: string, to: string): boolean {
  return d !== undefined && d >= from && d <= to;
}

/** 进群/正常退群/异常退群/推专家/注册/开单——按各自的日期字段落在 [from,to] 内计数；
 *  当前在群是快照，只看 joinedDate<=to 且（没退群 或 退群日期晚于to），不看 from；
 *  入金按 orderedDate 落在区间内汇总金额（开单当天记账），出金按 withdrawalDate。 */
function sumPipeline(role: SummaryColumnRole, memberId: string | null, from: string, to: string, channel?: ChannelName): PipelineTotals {
  const events = PIPELINE_EVENTS.filter(
    (e) => (channel === undefined || e.channel === channel) && pipelineMatchesScope(e, role, memberId),
  );
  const totals: PipelineTotals = { joined: 0, leftNormal: 0, leftAbnormal: 0, inGroup: 0, pushed: 0, registered: 0, ordered: 0, depositUsd: 0, withdrawalUsd: 0 };
  for (const e of events) {
    if (inRange(e.joinedDate, from, to)) totals.joined += 1;
    if (e.leftType === "NORMAL" && inRange(e.leftDate, from, to)) totals.leftNormal += 1;
    if (e.leftType === "ABNORMAL" && inRange(e.leftDate, from, to)) totals.leftAbnormal += 1;
    if (e.joinedDate <= to && (e.leftDate === undefined || e.leftDate > to)) totals.inGroup += 1;
    if (inRange(e.pushedDate, from, to)) totals.pushed += 1;
    if (inRange(e.registeredDate, from, to)) totals.registered += 1;
    if (inRange(e.orderedDate, from, to)) {
      totals.ordered += 1;
      totals.depositUsd += e.depositUsd;
    }
    if (inRange(e.withdrawalDate, from, to)) totals.withdrawalUsd += e.withdrawalUsd;
  }
  return totals;
}

/** 组装一列——role 决定哪几组指标是"适用"的（真实数字，哪怕是0）、哪几组是
 *  "不适用"（存 null，渲染成"—"）：
 *  - 添加数据~回复：只有 total/reception 适用
 *  - 进群~当前在群：total/reception/groupOperator 适用，expert 不适用
 *  - 推专家/注册/开单：全部适用，永远是数字
 *  - 入金/出金/净业绩：total/reception/expert 适用，groupOperator 不适用 */
function toSummaryColumn(
  role: SummaryColumnRole, memberId: string | null, name: string,
  from: string, to: string, channel: ChannelName | undefined, unitKey: string | null,
): SummaryColumn {
  const hasReception = role === "total" || role === "reception";
  const hasGroupFlow = role !== "expert";
  const hasMoney = role !== "groupOperator";

  const r = hasReception ? sumReceptionStats(role === "total" ? null : memberId, from, to, channel) : null;
  const p = sumPipeline(role, memberId, from, to, channel);

  const added = r ? r.added : null;
  const collision = r ? r.collision : null;
  const lowAmount = r ? r.lowAmount : null;
  const noWs = r ? r.noWs : null;
  const effective = r ? r.added - r.lowAmount - r.noWs : null;
  const replied = r ? r.replied : null;
  const repliedRate = r ? summaryPct(r.replied, effective ?? 0) : "—";

  const joined = hasGroupFlow ? p.joined : null;
  // 进群率＝进群÷有效数据（锁定口径）——炒群列没有“有效数据”，分母按0处理，summaryPct自然给“—”
  const joinedRate = hasGroupFlow ? summaryPct(p.joined, effective ?? 0) : "—";
  const leftNormal = hasGroupFlow ? p.leftNormal : null;
  const leftAbnormal = hasGroupFlow ? p.leftAbnormal : null;
  const leftAbnormalRate = hasGroupFlow ? summaryPct(p.leftAbnormal, p.joined) : "—";
  const inGroup = hasGroupFlow ? p.inGroup : null;

  const pushed = p.pushed;
  const registered = p.registered;
  const registeredRate = summaryPct(p.registered, p.pushed);
  const ordered = p.ordered;
  const orderedRate = summaryPct(p.ordered, p.registered);

  const depositUsd = hasMoney ? p.depositUsd : null;
  const withdrawalUsd = hasMoney ? p.withdrawalUsd : null;
  const netUsd = hasMoney ? p.depositUsd - p.withdrawalUsd : null;

  return {
    memberId, name, role, unitKey,
    added, collision, lowAmount, noWs, effective,
    replied, repliedRate,
    joined, joinedRate,
    leftNormal, leftAbnormal, leftAbnormalRate, inGroup,
    pushed, registered, registeredRate, ordered, orderedRate,
    depositUsd, withdrawalUsd, netUsd,
  };
}

/** 一个炒群 + 配对给它的接粉们，构成一条"流水线单元"。不从 MEMBERS 硬编码 id，
 *  纯粹从 positions/pairedGroupOperatorId 推导，人员名单调整时自动跟着变。 */
export function buildPipelineUnits(members: Member[]): { groupOperator: Member; receptionists: Member[] }[] {
  const groupOps = members.filter((m) => m.positions.includes("GROUP_OPERATOR"));
  return groupOps.map((go) => ({
    groupOperator: go,
    receptionists: members.filter((m) => m.pairedGroupOperatorId === go.id),
  }));
}

/** 给一个日期区间（from===to就是单日）+ 成员名单，算出"总计＋按流水线单元排列的每一
 *  列"。列的顺序：总计 → 逐个流水线单元（该单元的接粉们，再是这个炒群自己）→ 结尾
 *  统一一块"所有专家"。专家不嵌进具体某个单元，是因为真实数据里"炒群推给哪个专家"
 *  不是固定配对的（同一个炒群的客户可能推给任意专家），硬套"一个单元配一个专家列"
 *  会歪曲数据——这是权衡后的简化，参考截图那种"每个单元套一个专家列"的画法没有采用，
 *  不是漏做。
 *  第4个参数channel可选：不传就是数据汇总页面的口径（两个渠道都算），传了就是渠道数据
 *  核对页面的口径（只算这一个渠道）——两边算法完全一样，只是筛不筛渠道的区别。 */
export function computeOrderedSummaryColumns(from: string, to: string, members: Member[], channel?: ChannelName): SummaryColumn[] {
  const units = buildPipelineUnits(members);
  const experts = members.filter((m) => m.positions.includes("EXPERT"));

  const columns: SummaryColumn[] = [toSummaryColumn("total", null, "总计", from, to, channel, null)];
  for (const unit of units) {
    for (const r of unit.receptionists) {
      columns.push(toSummaryColumn("reception", r.id, r.name, from, to, channel, unit.groupOperator.id));
    }
    columns.push(toSummaryColumn("groupOperator", unit.groupOperator.id, unit.groupOperator.name, from, to, channel, unit.groupOperator.id));
  }
  for (const e of experts) {
    columns.push(toSummaryColumn("expert", e.id, e.name, from, to, channel, null));
  }
  return columns;
}

/** 数据汇总"每天一张表"要列哪些日期——取 RECEPTION_DAILY_STATS 里实际出现过的日期，
 *  去重后倒序（最近的在最前面），不写死具体天数，以后往数组里加数据这里自动跟着变。 */
export function summaryDatesDesc(): string[] {
  return [...new Set(RECEPTION_DAILY_STATS.map((r) => r.date))].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}

/** 通知中心——需求文档 7.1"管理员/组长发给指定范围的人"。这版是"下钻广播"模型：一条
 *  通知从某个 scope 发出，只有 scope 对应的那一层管理员本人 + 这个 scope 往下嵌套的所有
 *  下级角色看得到（比如 DEPARTMENT 范围，部门管理员自己看得到，这个部门下面各组的组长
 *  也看得到；但不会往上冒泡给公司管理员/总公司管理员——那两层没被点名，也不是发送者的
 *  下级）。GROUP 是链条最底层，只有对应组的组长看得到，即便发送者是部门管理员本人也
 *  不会因为"是自己发的"出现在自己收件箱里——公告是发给别人看的，不是发给自己留档，
 *  这个口径由各角色 TabNoticeCenter 里的可见性过滤实现，不在这份数据类型上。
 *  scopeTargetId 按 scope 对应 TEAM_GROUPS.id / DEPARTMENTS.id / COMPANIES.id，
 *  scope 为 ALL 时没有更细的目标，是 null。 */
export type NoticeScope = "GROUP" | "DEPARTMENT" | "COMPANY" | "ALL";
export type Notice = {
  id: string;
  title: string;
  content: string;
  senderName: string;
  senderRoleLabel: string;
  scope: NoticeScope;
  scopeTargetId: string | null;
  scopeLabel: string;
  createdAt: string;
};

/** 种子通知——按创建时间倒序排列（最新的在最前面），新发的通知用 setNotices 往数组
 *  最前面插，不需要另外按 createdAt 重新排序（跟 CROSS_GROUP_TRANSFERS 的展示习惯
 *  一样）。nt-4 是德国一组以外的部门（美国部）发的，专门用来验证"部门范围严格按
 *  scopeTargetId 匹配"——德国一组组长的收件箱不应该看到这条。 */
export const NOTICES: Notice[] = [
  {
    id: "nt-3", title: "这两天多留意异常退群",
    content: "这两天有几个客户入群没几天就退了，接粉这边多注意一下欢迎语和首次互动，有情况随时群里说。",
    senderName: LEAD_NAME, senderRoleLabel: "组长",
    scope: "GROUP", scopeTargetId: "tg-1", scopeLabel: MY_TEAM_GROUP,
    createdAt: "2026-08-26 19:05",
  },
  {
    id: "nt-4", title: "美国部本周排班调整",
    content: "本周五是美国假期，美国部各组排班相应上调，具体安排找各组组长确认。",
    senderName: "赵文娟", senderRoleLabel: "部门管理员",
    scope: "DEPARTMENT", scopeTargetId: "dep-2", scopeLabel: "美国部",
    createdAt: "2026-08-25 11:20",
  },
  {
    id: "nt-2", title: "德国部本周例会改到周四",
    content: "原定周五下午的部门例会改到周四上午10点，地点不变，请各组长提前准备好本周数据。",
    senderName: DEPT_MANAGER_NAME, senderRoleLabel: "部门管理员",
    scope: "DEPARTMENT", scopeTargetId: "dep-1", scopeLabel: MY_DEPARTMENT,
    createdAt: "2026-08-24 16:40",
  },
  {
    id: "nt-1", title: "8月工资结算安排",
    content: "本月工资将于9月3日统一发放，如对提成计算有疑问，9月1日前找各自部门管理员核对。",
    senderName: "宋建华", senderRoleLabel: "总公司管理员",
    scope: "ALL", scopeTargetId: null, scopeLabel: "全总公司",
    createdAt: "2026-08-20 09:15",
  },
];

/** "42%" → 42，"—"（分母为0）→ null——跟 summaryPct 的输出格式配套的反向解析，
 *  给需要拿比率去跟阈值比大小的场景用（比如日报要判断"今天退群率是不是比月度均值
 *  高出一大截"），summaryPct 本身只管生成展示字符串，不需要读回数字。 */
export function parseRatePercent(rate: string): number | null {
  if (rate === "—") return null;
  const n = Number(rate.replace("%", ""));
  return Number.isFinite(n) ? n : null;
}

/** 今日日报"AI 要点提炼"——不是真的调大模型，是规则引擎：按几条阈值检查当天数字，
 *  挑出"净业绩占比"和"异常退群率偏高"这两类最值得组长注意的信号，拼成1-2句话；
 *  两条都不触发时给一句平实的兜底陈述，不硬造"洞察"。阈值：净业绩占本月比重≥40%才
 *  提，其中开单量占比过半才追加那句"全月过半的单量是今天成交的"；异常退群率要≥月度
 *  均值1.5倍才提，≥2倍时用"高出一倍多"，否则"明显偏高"。 */
export function buildDailyTakeaway(today: SummaryColumn, month: SummaryColumn): string {
  const todayNet = today.netUsd ?? 0;
  const monthNet = month.netUsd ?? 0;
  const todayOrdered = today.ordered;
  const monthOrdered = month.ordered;
  const todayAbnormalRate = parseRatePercent(today.leftAbnormalRate);
  const monthAbnormalRate = parseRatePercent(month.leftAbnormalRate);

  const sentences: string[] = [];

  const netShare = monthNet > 0 ? Math.round((todayNet / monthNet) * 100) : null;
  if (netShare !== null && netShare >= 40) {
    const orderShare = monthOrdered > 0 ? Math.round((todayOrdered / monthOrdered) * 100) : null;
    const orderNote = todayOrdered > 0
      ? `——开单${todayOrdered}笔${orderShare !== null && orderShare >= 50 ? "，全月过半的单量是今天成交的" : ""}`
      : "";
    sentences.push(`今天净业绩${money(todayNet)}，占本月累计的${netShare}%${orderNote}。`);
  }

  if (todayAbnormalRate !== null && monthAbnormalRate !== null && monthAbnormalRate > 0 && todayAbnormalRate >= monthAbnormalRate * 1.5) {
    const ratio = todayAbnormalRate / monthAbnormalRate;
    const ratioNote = ratio >= 2 ? "高出一倍多" : "明显偏高";
    sentences.push(`${sentences.length ? "不过" : ""}今天异常退群率${today.leftAbnormalRate}，比月度均值${month.leftAbnormalRate}${ratioNote}，建议看看今天新入群客户的维系情况。`);
  }

  if (!sentences.length) {
    sentences.push(`今天净业绩${money(todayNet)}，异常退群率${today.leftAbnormalRate}，跟本月累计（净业绩${money(monthNet)}、退群率${month.leftAbnormalRate}）相比没有明显异常，按部就班跟进就好。`);
  }

  return sentences.join("");
}
