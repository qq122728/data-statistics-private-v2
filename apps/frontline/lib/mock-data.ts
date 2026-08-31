/** 演示用假数据。接后端时整个文件删掉，页面组件不用改。 */

export type Lead = {
  id: string;
  phone: string;
  name: string;
  email: string;
  amountUsd: number | null;
  platform: string;
  device: string;
  channel: string;
  sourceDate: string;
  /** 已等待天数：从来源日算起 */
  waitedDays: number;
  visits: number;
  lastVisitNote: string | null;
  /** 已回复待入群时用：正常聊天 / 准备拉群 */
  chatStatus?: "NORMAL" | "READY";
  repliedAt?: string;
  /** 详情抽屉用 */
  attributionOwner?: string;
  groupOperator?: string;
  expertOwner?: string;
  history?: Array<{ action: string; date: string; actor: string; note?: string; undone?: boolean }>;
  /** 归档类型：未回复归档（回访5次没反应）/ 未进群归档（回复了但谈不拢） */
  archiveKind?: "UNANSWERED" | "NOT_JOINED";
  archiveReason?: string;
  /** 无效库：导入时自动判定，或接粉后来人工改判。客户还能照常跟进，只是不计入有效数据 */
  invalidKind?: "LOW_AMOUNT" | "NO_WS";
  invalidReason?: string;
  /** 历史补录：系统启用前就已经存在的老客户，认领之后不重算旧进度，只算认领后新发生的 */
  isHistoricalRecord?: boolean;
  historicalBaselineStage?: BaselineStage;
  /** 认领自哪一批历史汇总数字——决定认领后新发生的事该算进哪个批次的计数 */
  historicalBatchId?: string;
};

/** 老客户在"系统启用前"已经走到哪一步——决定补录之后落在哪个tab/页面 */
export type BaselineStage = "NOT_REPLIED" | "REPLIED" | "JOINED" | "INTRODUCED" | "REGISTERED" | "ORDERED";

export const BASELINE_STAGE_META: Record<BaselineStage, { label: string }> = {
  NOT_REPLIED: { label: "未回复" },
  REPLIED: { label: "已回复" },
  JOINED: { label: "已进群" },
  INTRODUCED: { label: "已推专家" },
  REGISTERED: { label: "已注册" },
  ORDERED: { label: "已开单" },
};
export const BASELINE_STAGE_ORDER: BaselineStage[] = ["NOT_REPLIED", "REPLIED", "JOINED", "INTRODUCED", "REGISTERED", "ORDERED"];

/** 下一步是哪一步——用来把"以前拉过群的现在推专家了"这类新发生的事，接到基线的下一格 */
export function nextBaselineStage(stage: BaselineStage): BaselineStage | null {
  const i = BASELINE_STAGE_ORDER.indexOf(stage);
  return i >= 0 && i < BASELINE_STAGE_ORDER.length - 1 ? BASELINE_STAGE_ORDER[i + 1] : null;
}

/**
 * 历史汇总批次：系统启用前，某个渠道/日期没有具体号码、只有汇总数字的老账。
 * 例如"黑八小组"当时导入的是 100粉/20回复/10进群/5推专家/3注册/1开单，没有存号码。
 * 之后每认领出一个号码（录入老客户），认领动作本身不改这几个数字——旧账已经算过了；
 * 只有认领之后这个号码新发生的事（今天才回复/今天才拉群/今天才推专家…）才会让对应格 +1。
 */
export type HistoricalBatch = {
  id: string;
  channel: string;
  batchDate: string;
  /** 可选备注名，比如"黑八小组" */
  label?: string;
  counts: {
    fans: number;
    replied: number;
    joined: number;
    introduced: number;
    registered: number;
    ordered: number;
  };
  createdAt: string;
};

/** 基线阶段 → 该阶段对应批次里的哪个计数格。NOT_REPLIED 没有对应格（等于还没从"粉"里走出来）。 */
export const HISTORICAL_BATCH_COUNT_KEY: Partial<Record<BaselineStage, keyof HistoricalBatch["counts"]>> = {
  REPLIED: "replied",
  JOINED: "joined",
  INTRODUCED: "introduced",
  REGISTERED: "registered",
  ORDERED: "ordered",
};

export const HISTORICAL_BATCHES: HistoricalBatch[] = [
  {
    id: "batch-1", channel: "德国短信 A", batchDate: "2026-08-10", label: "黑八小组",
    counts: { fans: 100, replied: 20, joined: 10, introduced: 5, registered: 3, ordered: 1 },
    createdAt: "2026-08-10",
  },
];

/** 历史补录客户落进客户进度页之后的展示文案，按基线阶段给一套；后续"推进到下一步"也复用同一套 */
export const HISTORICAL_STAGE_TEXT: Record<BaselineStage, {
  statusPhrase: string; expertStage: string; groupProgressNote: string; expertNote: string; summaryLine: string;
}> = {
  NOT_REPLIED: { statusPhrase: "", expertStage: "", groupProgressNote: "", expertNote: "", summaryLine: "" },
  REPLIED: { statusPhrase: "", expertStage: "", groupProgressNote: "", expertNote: "", summaryLine: "" },
  JOINED: {
    statusPhrase: "历史补录 · 已进群", expertStage: "炒群跟进中",
    groupProgressNote: "历史补录：启用前已进群，今天开始正常跟进",
    expertNote: "尚未推专家", summaryLine: "历史已进群 · 未开单",
  },
  INTRODUCED: {
    statusPhrase: "历史补录 · 已推专家", expertStage: "专家跟进中",
    groupProgressNote: "历史补录：启用前已推专家",
    expertNote: "专家跟进中（历史推荐）", summaryLine: "历史已推专家 · 未开单",
  },
  REGISTERED: {
    statusPhrase: "历史补录 · 已注册", expertStage: "已注册",
    groupProgressNote: "历史补录：启用前已注册",
    expertNote: "已注册，等待开单", summaryLine: "历史已注册 · 未开单",
  },
  ORDERED: {
    statusPhrase: "历史补录 · 已开单", expertStage: "已开单",
    groupProgressNote: "历史补录：启用前已开单，历史首充不重复计入",
    expertNote: "已开单（历史）", summaryLine: "历史已开单 · 续充从补录之日起算",
  },
};

/**
 * 当前处于哪一步。旧系统的 EntryWorkflowStatus 同款口径：
 * 填了设备但没回复 = 未回复（红），没填设备 = 待联系。
 */
export function stageOf(lead: Lead): { label: string; tone: "ok" | "warn" | "bad" | "mute" } {
  if (lead.archiveKind) return { label: "已归档", tone: "mute" };
  if (lead.chatStatus) return { label: "待入群", tone: "warn" };
  if (lead.repliedAt) return { label: "待入群", tone: "warn" };
  if (!lead.device) return { label: "待联系", tone: "warn" };
  if (lead.visits > 0) return { label: `回访 ${lead.visits} 次`, tone: "warn" };
  return { label: "未回复", tone: "bad" };
}

/** 下一步该干什么 —— 直接告诉一线，不用自己判断流程 */
export function nextStepOf(lead: Lead): string {
  if (lead.archiveKind) return "客户回复后可重新激活";
  if (lead.chatStatus || lead.repliedAt) return "确认入群";
  if (!lead.device) return "填写设备号";
  return "回访 / 确认已回复";
}

export const TODAY = "2026-08-27";

/** "刚刚做了这个操作"要记的时间戳，统一格式 MM-DD HH:mm，跟表格里其它时间戳看齐 */
export function nowStamp(): string {
  const hhmm = new Date().toTimeString().slice(0, 5);
  return `${TODAY.slice(5)} ${hhmm}`;
}

/** 从 TODAY 往前推 n 天，返回同样格式的日期字符串——用来把"在群天数"倒推出一个进群日期存起来 */
export function daysBeforeToday(n: number): string {
  const d = new Date(`${TODAY}T00:00:00`);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/** 从某个日期到 TODAY 一共第几天（进群当天算第1天）——存了进群日期之后，天数从这里自动算，不用手动改 */
export function daysSince(dateStr: string): number {
  const start = new Date(`${dateStr}T00:00:00`);
  const today = new Date(`${TODAY}T00:00:00`);
  return Math.round((today.getTime() - start.getTime()) / 86400000) + 1;
}

/** 这个演示账号所在的小组——原型目前只模拟了这一个小组，精英榜的"小组榜"暂时只有它一条数据 */
export const MY_TEAM_GROUP = "德国一组";

/** 接粉团队名单（"德国一组"）——号码导入的"粉的归属"、炒群"认领老客户"的"接粉归属"共用同一份，
 *  不能两个地方各存一份、互相对不上。接真实后端时换成拉组内成员列表的接口即可，下拉框不用动。 */
export const ATTRIBUTION_OWNERS = ["陈小雨（我自己）", "周婷", "赵磊", "刘洋", "赵敏"];

/** 专家人员名单——炒群把客户推给专家时，要选推给谁 */
export const EXPERT_OWNERS = ["王敏", "刘畅", "赵健"];

/** 组长必须同时兼专家——客户没被指定给某个专家时，默认落到组长自己（这里是王敏）名下；
 *  炒群"推专家"时如果单独指定别人，才会走到 EXPERT_OWNERS 里的其他人 */
export const DEFAULT_EXPERT = EXPERT_OWNERS[0];

/** 炒群人员名单——专家认领老客户时，要顺手指定这个客户当时是哪位炒群带的（"李强"是这个演示账号自己） */
export const GROUP_OPERATORS = ["李强", "赵晨", "孙悦"];

/** 组长开账号时定的接粉↔炒群配对——一个炒群手上固定带几个接粉，接粉拉的客户算这个炒群的。
 *  真实团队一个炒群大概带3-4个接粉，这里演示名单总共只有5个接粉，分不出那么多，按现有人数
 *  尽量分匀；这份配对目前只是数据事实，没有做成组长可以在界面上改的管理面板（那是组长账号的
 *  范畴，见项目待办）。"陈小雨（我自己）"配给"李强"，跟这个演示账号本人的炒群分身对上。 */
export const RECEPTION_BY_GROUP_OPERATOR: Record<string, string[]> = {
  李强: ["陈小雨（我自己）", "周婷"],
  赵晨: ["赵磊", "刘洋"],
  孙悦: ["赵敏"],
};

/** 反查：这个接粉配给了哪个炒群——找不到就说明这份配对还没覆盖到这个人 */
export function groupOperatorOfReception(receptionName: string): string | undefined {
  return Object.entries(RECEPTION_BY_GROUP_OPERATOR).find(([, list]) => list.includes(receptionName))?.[0];
}

/** 专家跟进客户，真实的细分阶段——不是随手写的散文字，就这8档。
 *  "未成交"/"停止维护"是需求文档8.2重新定义的两种放弃状态，按放弃发生的时点划分：
 *  未成交＝开单前放弃（一直没能让客户打第一笔钱），停止维护＝开单后停止（已经开过单，
 *  但后续不再续充、不再跟进）——业务含义完全不同，不能混在一个指标里算。旧系统这两个
 *  状态叫"不愿充/杀不动"，命名混乱（旧规则要求"杀不动"必须已开单，跟字面意思相反），
 *  新系统改用直接反映时点的名字，状态机的先后顺序本身不变。 */
export type ExpertStage = "排队中" | "交资料" | "追踪中" | "待注册" | "待开单" | "未成交" | "已开单" | "停止维护";
export const EXPERT_STAGE_ORDER: ExpertStage[] = ["排队中", "交资料", "追踪中", "待注册", "待开单", "未成交", "已开单", "停止维护"];
/** 未成交/停止维护这两档是需要留意的卡点，其它是正常推进中 */
export const EXPERT_STAGE_WARN: Partial<Record<ExpertStage, true>> = { 未成交: true, 停止维护: true };

/** 专家把客户设到某一档时，"客户"列显示的那句状态文案 */
export const EXPERT_STAGE_STATUS_PHRASE: Record<ExpertStage, string> = {
  排队中: "专家待跟进",
  交资料: "客户正在交资料",
  追踪中: "专家跟进中",
  待注册: "待客户完成注册",
  待开单: "已注册待开单",
  未成交: "客户暂未成交",
  已开单: "已开单客户",
  停止维护: "已开单，暂停跟进",
};

/** 专家阶段 → 归到客户进度页哪个大分类：排队中单独一类，已开单/停止维护都算已转化客户，中间几档都算"专家跟进中"。
 *  停止维护只能从已开单进入（续充卡住，不是没首充），所以仍归"ordered"，不掉回"跟进中"。 */
export function categoryForExpertStage(stage: ExpertStage): DownstreamCategory {
  if (stage === "排队中") return "expertQueue";
  if (stage === "已开单" || stage === "停止维护") return "ordered";
  return "expertWorking";
}

/** 手机号统一按4位一组分组显示——mock数据里录入格式不统一（有的是8+4），显示层强制对齐。
 *  6位及以下的是新规则下的客户编号（取号码后6位），本来就短，不用再分组。 */
export function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length <= 6) return digits;
  return digits.replace(/(\d{4})(?=\d)/g, "$1 ");
}

/** 待回复：按等待天数从久到近排（等最久的最该先处理） */
export const PENDING_REPLY: Lead[] = [
  {
    id: "l-01", phone: "4917 6234 8891", name: "Dieter Hellmann",
    email: "d.hellmann@t-online.de", amountUsd: 42000, platform: "MT5",
    device: "WA-03", channel: "德国短信 A", sourceDate: "2026-08-22",
    waitedDays: 5, visits: 3, lastVisitNote: "第三次回访，仍未读",
    attributionOwner: "陈小雨（我自己）", groupOperator: "李强",
    history: [
      { action: "已导入", date: "8月22日", actor: "陈小雨" },
      { action: "回访 +1", date: "8月23日", actor: "陈小雨", note: "首次问候，未读" },
      { action: "回访 +1", date: "8月25日", actor: "陈小雨", note: "再次跟进，仍未读" },
      { action: "回访 +1", date: "8月26日", actor: "陈小雨", note: "第三次回访，仍未读" },
    ],
  },
  {
    id: "l-02", phone: "4915 1120 4477", name: "Sabine Kruger",
    email: "s.kruger@web.de", amountUsd: 18500, platform: "Web",
    device: "WA-03", channel: "德国短信 A", sourceDate: "2026-08-24",
    waitedDays: 3, visits: 2, lastVisitNote: "客户说在忙，晚点回",
    attributionOwner: "陈小雨（我自己）", groupOperator: "李强",
    history: [
      { action: "已导入", date: "8月24日", actor: "陈小雨" },
      { action: "已标记回复", date: "8月25日", actor: "陈小雨" },
      { action: "已撤销回复", date: "8月25日", actor: "陈小雨", note: "点错了，客户实际没回", undone: true },
      { action: "回访 +1", date: "8月26日", actor: "陈小雨", note: "客户说在忙，晚点回" },
    ],
  },
  {
    id: "l-03", phone: "4917 7845 2210", name: "Klaus Bergmann",
    email: "kbergmann@gmx.de", amountUsd: 9800, platform: "MT4",
    device: "WA-01", channel: "德国投流 B", sourceDate: "2026-08-26",
    waitedDays: 1, visits: 1, lastVisitNote: "已发首次问候",
  },
  {
    id: "l-04", phone: "4916 0398 5512", name: "Petra Vogel",
    email: "petra.vogel@gmail.com", amountUsd: 67000, platform: "MT5",
    device: "WA-01", channel: "德国投流 B", sourceDate: "2026-08-27",
    waitedDays: 0, visits: 0, lastVisitNote: null,
  },
  {
    id: "l-05", phone: "4917 2266 9034", name: "Andreas Roth",
    email: "a.roth@outlook.de", amountUsd: null, platform: "",
    device: "", channel: "德国投流 B", sourceDate: "2026-08-27",
    waitedDays: 0, visits: 0, lastVisitNote: null,
  },
  ...generateMore(),
];

/** 再造一批，让"几十条"的真实手感能被看到 */
function generateMore(): Lead[] {
  const names = [
    "Martin Schmidt", "Claudia Wolf", "Jürgen Becker", "Silke Hoffmann",
    "Rainer Koch", "Birgit Schäfer", "Uwe Richter", "Gabriele Klein",
    "Norbert Wolff", "Heidi Schröder", "Wolfgang Neumann", "Renate Schwarz",
    "Helmut Zimmermann", "Brigitte Braun", "Günter Krüger", "Karin Hofmann",
    "Manfred Hartmann", "Elke Lange", "Dieter Schmitt", "Marion Werner",
  ];
  const platforms = ["MT5", "MT4", "Web", ""];
  const chans = ["德国短信 A", "德国投流 B", "德国底料 C"];
  const notes = [
    "已发问候，未读", "客户问了手续费", "说考虑一下", "语音未接",
    "已加上，还没聊", "回了一句就没下文", null,
  ];
  return names.map((name, i) => {
    const waited = [0, 0, 0, 1, 1, 1, 2, 2, 3, 4, 6][i % 11];
    const visits = waited === 0 ? 0 : Math.min(5, waited);
    return {
      id: `l-${100 + i}`,
      phone: `49${(15 + (i % 3))}${String(1000000 + i * 137911).slice(0, 4)} ${String(2000000 + i * 91733).slice(0, 4)}`,
      name,
      email: `${name.split(" ")[0].toLowerCase()}@${["web.de", "gmx.de", "t-online.de"][i % 3]}`,
      amountUsd: [8500, 12000, 15500, 23000, 31000, 44000, 58000, 76000, 95000, 6200][i % 10],
      platform: platforms[i % 4],
      device: ["WA-01", "WA-03", "WA-07", ""][i % 4],
      channel: chans[i % 3],
      sourceDate: `2026-08-${String(27 - waited).padStart(2, "0")}`,
      waitedDays: waited,
      visits,
      lastVisitNote: visits ? notes[i % notes.length] : null,
    };
  });
}

/** 已回复，待入群 */
export const PENDING_GROUP: Lead[] = [
  {
    id: "g-01", phone: "4915 8890 3312", name: "Monika Faber",
    email: "m.faber@t-online.de", amountUsd: 55000, platform: "MT5",
    device: "WA-03", channel: "德国短信 A", sourceDate: "2026-08-21",
    waitedDays: 2, visits: 4, lastVisitNote: "已确认有意向",
    chatStatus: "READY", repliedAt: "08-25 20:14",
    attributionOwner: "陈小雨（我自己）", groupOperator: "李强",
    history: [
      { action: "已导入", date: "8月21日", actor: "陈小雨" },
      { action: "已标记回复", date: "8月25日", actor: "陈小雨", note: "客户主动问了手续费" },
    ],
  },
  {
    id: "g-02", phone: "4917 4471 6628", name: "Stefan Lange",
    email: "s.lange@web.de", amountUsd: 31000, platform: "Web",
    device: "WA-01", channel: "德国投流 B", sourceDate: "2026-08-25",
    waitedDays: 1, visits: 2, lastVisitNote: "聊得不错，还在观望",
    chatStatus: "NORMAL", repliedAt: "08-26 15:40",
  },
  {
    id: "g-03", phone: "4916 5503 1177", name: "Julia Neumann",
    email: "j.neumann@gmx.de", amountUsd: 24500, platform: "MT4",
    device: "WA-03", channel: "德国短信 A", sourceDate: "2026-08-26",
    waitedDays: 0, visits: 1, lastVisitNote: "刚回复", chatStatus: "NORMAL",
    repliedAt: "08-27 09:22",
  },
];

/** 归档：多次回访无果 */
export const ARCHIVED: Lead[] = [
  {
    id: "a-01", phone: "4915 3320 8845", name: "Thomas Weber",
    email: "", amountUsd: 12000, platform: "", device: "WA-01",
    channel: "德国短信 A", sourceDate: "2026-08-14",
    waitedDays: 13, visits: 5, lastVisitNote: "五次回访无应答，归档",
    archiveKind: "UNANSWERED", archiveReason: "回访 5 次无应答，系统自动归档",
  },
  {
    id: "a-02", phone: "4917 9982 4416", name: "Nina Schulz",
    email: "", amountUsd: 8500, platform: "", device: "WA-03",
    channel: "德国投流 B", sourceDate: "2026-08-16",
    waitedDays: 11, visits: 5, lastVisitNote: "明确表示不感兴趣",
    archiveKind: "NOT_JOINED", archiveReason: "已回复但多次沟通后明确拒绝进群",
  },
];

/** 无效库：低金额 / 无 WhatsApp，导入时自动判定或后来人工改判，客户还能继续跟 */
export const INVALID: Lead[] = [
  {
    id: "v-01", phone: "4916 4402 1187", name: "Klaus Fischer",
    email: "k.fischer@web.de", amountUsd: 3200, platform: "Web", device: "WA-03",
    channel: "德国短信 A", sourceDate: "2026-08-25",
    waitedDays: 2, visits: 1, lastVisitNote: "说再考虑一下",
    invalidKind: "LOW_AMOUNT", invalidReason: "导入时金额 $3,200，低于 $5,000 门槛，系统自动判定",
  },
  {
    id: "v-02", phone: "4915 7788 3321", name: "Renate Braun",
    email: "", amountUsd: 22000, platform: "MT5", device: "",
    channel: "德国投流 B", sourceDate: "2026-08-26",
    waitedDays: 1, visits: 0, lastVisitNote: null,
    invalidKind: "NO_WS", invalidReason: "只有座机号码，没有 WhatsApp，人工改判",
  },
];

/** 导入预览行 */
export type ImportRow = {
  id: string;
  phone: string;
  name: string;
  email: string;
  amountUsd: number | null;
  platform: string;
  /** ok = 可导入；dup = 撞粉；low = 低金额；nows = 无 WhatsApp；incomplete = 手动新增一行、还没填手机号 */
  status: "ok" | "dup" | "low" | "nows" | "incomplete";
};

export const IMPORT_PREVIEW: ImportRow[] = [
  { id: "i-1", phone: "4917 6650 2231", name: "Michael Braun", email: "m.braun@web.de", amountUsd: 38000, platform: "MT5", status: "ok" },
  { id: "i-2", phone: "4915 2201 7789", name: "Anja Fischer", email: "a.fischer@gmx.de", amountUsd: 92000, platform: "MT5", status: "ok" },
  { id: "i-3", phone: "4917 6234 8891", name: "Dieter Hellmann", email: "d.hellmann@t-online.de", amountUsd: 42000, platform: "MT5", status: "dup" },
  { id: "i-4", phone: "4916 8834 0092", name: "Lukas Wagner", email: "l.wagner@outlook.de", amountUsd: 3200, platform: "Web", status: "low" },
  { id: "i-5", phone: "4915 7719 3345", name: "Christine MayerHof", email: "c.mayer@t-online.de", amountUsd: 27500, platform: "MT4", status: "ok" },
  { id: "i-6", phone: "4917 0043 9928", name: "Robert Hoffmann", email: "", amountUsd: 15000, platform: "", status: "nows" },
];

/** 扣粉登记历史 */
export type DeductionRecord = {
  id: string;
  date: string;
  channel: string;
  dup: number;
  low: number;
  noWs: number;
  status: "pending" | "approved" | "returned";
  note: string;
};

export const DEDUCTIONS: DeductionRecord[] = [
  { id: "d-1", date: "2026-08-26", channel: "德国短信 A", dup: 3, low: 2, noWs: 1, status: "approved", note: "组长已确认" },
  { id: "d-2", date: "2026-08-25", channel: "德国投流 B", dup: 5, low: 1, noWs: 0, status: "approved", note: "组长已确认" },
  { id: "d-3", date: "2026-08-24", channel: "德国短信 A", dup: 2, low: 4, noWs: 2, status: "returned", note: "低金额数量与导入记录不符，请核对后重报" },
];

/** 跟进结果：交出去之后的下游进展（只读，接粉不能改，只能标记误录） */
export type DownstreamCategory = "inGroup" | "expertQueue" | "expertWorking" | "ordered" | "left" | "backfilled";

/** 进群不满这么多天就退群，算异常退群；满了算正常退群 */
export const NORMAL_LEAVE_GROUP_DAYS = 14;

export type DownstreamLead = {
  id: string;
  code: string;
  category: DownstreamCategory;
  statusPhrase: string;
  daysNote: string;
  channel: string;
  sourceDate: string;
  attributionOwner: string;
  groupOperator: string;
  expertOwner: string;
  expertStage: string;
  expertStageWarn?: boolean;
  groupProgressNote: string;
  groupProgressMeta?: string;
  expertNote: string;
  depositUsd: number;
  continuationCount: number;
  continuationUsd: number;
  withdrawalUsd: number;
  dataCostUsd: number;
  netUsd: number;
  summaryLine: string;
  /** 历史补录客户专用：现在实际到了哪一步、认领自哪个批次——用来"推进到下一步"时找对批次的计数格 */
  historicalStage?: BaselineStage;
  historicalBatchId?: string;
  /** 认领"以前就在群里"的老客户时，炒群手填的在群天数倒推出的进群日期——daysNote 从这个日期自动算，不用手动改；
   *  正常交棒的客户也会填这个（交棒当天），退群时用它算"在群几天"来判断正常/异常退群 */
  groupJoinDate?: string;
  /** 推给专家、标记已注册的实际日期——是给"客户漏斗数据"按天统计用的 */
  pushedToExpertDate?: string;
  registeredDate?: string;
  /** 首充/续充/出金流水——统一存成一笔一笔的记录，而不是分开存累计数字+"最近一笔"，
   *  这样"财务明细"才能把每一笔都列出来、撤销/编辑任意一笔都有据可查。种子数据/历史补录
   *  直接写好的 depositUsd 没有对应的 moneyEvents，所以撤销开单/编辑金额这些按钮不会出现在那些记录上 */
  moneyEvents?: MoneyEvent[];
  /** 退群日期 + 是否异常（进群不满14天就退的算异常） */
  leftGroupDate?: string;
  leftGroupAbnormal?: boolean;
  /** 标记退群前的状态快照——"撤销退群"要精确恢复到退群前是哪一档，不能瞎猜 */
  preLeftSnapshot?: { category: DownstreamCategory; expertStage: string; statusPhrase: string; expertStageWarn?: boolean };
  /** 这整条记录是不是录错了（比如撞错客户、导错重复号）——只是打个标，留痕迹，不会真的删掉这条记录 */
  misrecorded?: boolean;
  misrecordedReason?: string;
};

/** 首充/续充/出金的单笔流水记录 */
export type MoneyEvent = {
  id: string;
  kind: "首充" | "续充" | "出金";
  amountUsd: number;
  date: string;
};

export const DOWNSTREAM: DownstreamLead[] = [
  {
    id: "x-1", code: "19980000004", category: "inGroup", statusPhrase: "入群第 4 天", daysNote: "进群第 4 天",
    channel: "德国投流 B", sourceDate: "2026-08-23",
    attributionOwner: "陈小雨（我自己）", groupOperator: "李强", expertOwner: "待分配", expertStage: "炒群跟进中",
    groupProgressNote: "第 4 天：参与互动积极，建议今天介绍专家。", groupProgressMeta: "2026-08-27 · 李强",
    expertNote: "尚未推专家",
    depositUsd: 0, continuationCount: 0, continuationUsd: 0, withdrawalUsd: 0, dataCostUsd: 35, netUsd: -35,
    summaryLine: "未注册 · 未开单",
  },
  {
    id: "x-2", code: "19980000003", category: "inGroup", statusPhrase: "入群第 1 天", daysNote: "进群第 1 天",
    channel: "德国短信 A", sourceDate: "2026-08-26",
    attributionOwner: "陈小雨（我自己）", groupOperator: "李强", expertOwner: "待分配", expertStage: "炒群跟进中",
    groupProgressNote: "第 1 天：已欢迎入群，客户正在浏览群内容。", groupProgressMeta: "2026-08-27 · 李强",
    expertNote: "尚未推专家",
    depositUsd: 0, continuationCount: 0, continuationUsd: 0, withdrawalUsd: 0, dataCostUsd: 35, netUsd: -35,
    summaryLine: "未注册 · 未开单",
  },
  {
    id: "x-3", code: "19980000012", category: "expertQueue", statusPhrase: "专家待跟进", daysNote: "进群第 4 天",
    channel: "德国短信 A", sourceDate: "2026-08-23",
    attributionOwner: "陈小雨（我自己）", groupOperator: "李强", expertOwner: "王敏", expertStage: "排队中",
    groupProgressNote: "暂无每日进度",
    expertNote: "已推专家，等待专家接待",
    depositUsd: 0, continuationCount: 0, continuationUsd: 0, withdrawalUsd: 0, dataCostUsd: 35, netUsd: -35,
    summaryLine: "未注册 · 未开单",
  },
  {
    id: "x-4", code: "19980000005", category: "expertQueue", statusPhrase: "客户正在交资料", daysNote: "进群第 7 天",
    channel: "德国投流 B", sourceDate: "2026-08-20",
    attributionOwner: "陈小雨（我自己）", groupOperator: "李强", expertOwner: "王敏", expertStage: "交资料",
    groupProgressNote: "暂无每日进度",
    expertNote: "客户正在提交注册资料，等待完成",
    depositUsd: 0, continuationCount: 0, continuationUsd: 0, withdrawalUsd: 0, dataCostUsd: 35, netUsd: -35,
    summaryLine: "未注册 · 未开单",
  },
  {
    id: "x-5", code: "19980000007", category: "expertWorking", statusPhrase: "已注册待开单", daysNote: "进群第 10 天",
    channel: "德国底料 C", sourceDate: "2026-08-17",
    attributionOwner: "陈小雨（我自己）", groupOperator: "李强", expertOwner: "王敏", expertStage: "待开单",
    groupProgressNote: "暂无每日进度",
    expertNote: "下一步：确认首充时间",
    // 底料（返点）渠道不计数据成本，跟短信/投流粉不一样
    depositUsd: 0, continuationCount: 0, continuationUsd: 0, withdrawalUsd: 0, dataCostUsd: 0, netUsd: 0,
    summaryLine: "已注册 · 2026-08-25 · 未开单",
  },
  {
    id: "x-6", code: "19980000006", category: "expertWorking", statusPhrase: "专家跟进中", daysNote: "进群第 8 天",
    channel: "德国短信 A", sourceDate: "2026-08-19",
    attributionOwner: "陈小雨（我自己）", groupOperator: "李强", expertOwner: "王敏", expertStage: "追踪中", expertStageWarn: true,
    groupProgressNote: "暂无每日进度",
    expertNote: "下一步：周一提醒客户完成注册",
    depositUsd: 0, continuationCount: 0, continuationUsd: 0, withdrawalUsd: 0, dataCostUsd: 35, netUsd: -35,
    summaryLine: "未注册 · 未开单",
  },
  {
    id: "x-7", code: "19980000010", category: "ordered", statusPhrase: "正常退群已开单", daysNote: "进群第 16 天",
    channel: "德国投流 B", sourceDate: "2026-08-11",
    attributionOwner: "陈小雨（我自己）", groupOperator: "李强", expertOwner: "王敏", expertStage: "已开单",
    groupProgressNote: "—",
    expertNote: "已注册 · 2026-08-17",
    depositUsd: 200, continuationCount: 0, continuationUsd: 0, withdrawalUsd: 0, dataCostUsd: 35, netUsd: 165,
    summaryLine: "已注册 · 2026-08-17 · 已开单 2026-08-18",
  },
  {
    id: "x-8", code: "19980000008", category: "ordered", statusPhrase: "已开单客户", daysNote: "进群第 14 天",
    channel: "德国短信 A", sourceDate: "2026-08-13",
    attributionOwner: "陈小雨（我自己）", groupOperator: "李强", expertOwner: "王敏", expertStage: "已开单",
    groupProgressNote: "暂无每日进度",
    expertNote: "下一步：维护关系并争取续充",
    depositUsd: 300, continuationCount: 1, continuationUsd: 120, withdrawalUsd: 50, dataCostUsd: 35, netUsd: 335,
    summaryLine: "已注册 · 2026-08-19 · 已开单 2026-08-21",
  },
];

export const CHANNELS = ["德国短信 A", "德国投流 B", "德国底料 C"];
export const DEVICES = ["WA-01", "WA-03", "WA-07", "RCS-02"];

export const money = (usd: number | null) =>
  usd === null ? "—" : `$${usd.toLocaleString("en-US")}`;
