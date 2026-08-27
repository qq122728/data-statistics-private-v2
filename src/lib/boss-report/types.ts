export type BossReportTotals = {
  newFans: number;
  effectiveFans: number;
  replies: number;
  groupJoin: number;
  expertIntro: number;
  expertContacted: number;
  registration: number;
  orders: number;
  rechargeCents: number;
  withdrawalCents: number;
  netPerformanceCents: number;
  costCents: number | null;
  rebateCents: number;
  profitCents: number | null;
};

export type BossReportRates = {
  replyRate: number | null;
  joinRate: number | null;
  expertIntroRate: number | null;
  expertContactRate: number | null;
  expertOrderRate: number | null;
};

export type BossReportRanking = {
  name: string;
  departmentName?: string;
  orders: number;
  netPerformanceCents: number;
  profitCents: number | null;
};

export type BossReportGroupRow = {
  groupId: string;
  name: string;
  departmentName: string;
  newFans: number;
  effectiveFans: number;
  replies: number;
  groupJoin: number;
  expertIntro: number;
  expertContacted: number;
  registration: number;
  orders: number;
  rechargeCents: number;
  withdrawalCents: number;
  netPerformanceCents: number;
  costCents: number | null;
  profitCents: number | null;
};

export type BossReportAnomalies = {
  overdueExpertIntro: number;
  overdueExpertContact: number;
  overdueOrder: number;
  invalidCustomers: number;
  pendingCostGroups: number;
};

export type BossReportSnapshot = {
  totals: BossReportTotals;
  rates: BossReportRates;
};

export type BossEmployeeFunnel = {
  employeeId: string;
  role: "接粉" | "炒群" | "专家";
  name: string;
  groupName: string;
  sample: number;
  sampleState: "INSUFFICIENT" | "RANKABLE";
  stages: Record<string, number>;
  evaluation: {
    metric: "有效数据入群率" | "第3天推专家率" | "第2天开单率";
    completed: number;
    eligible: number;
    ratePercent: number | null;
    grade: "NO_SAMPLE" | "BELOW_PASS" | "PASS" | "GOOD" | "EXCELLENT";
    gradeLabel: string;
    standard: { pass: number; good: number; excellent: number };
  };
};

export type BossChannelQuality = {
  name: string;
  sampleState: "INSUFFICIENT" | "RANKABLE";
  groupNames: string[];
  submitted: number;
  effective: number;
  replies: number;
  joined: number;
  pushedExpert: number;
  orders: number;
  effectiveRate: number | null;
  effectiveFanReplyRate: number | null;
  d7SubmittedOrderRate: number | null;
  costPerEffectiveFanCents: number | null;
  invalidRate: number | null;
};

export type BossConversionStandard = {
  groupName: string;
  effectiveFanJoinRate: { pass: number; good: number; excellent: number };
  day3ExpertPushRate: { pass: number; good: number; excellent: number };
  day2OrderRate: { pass: number; good: number; excellent: number };
};

export type BossLeaveBreakdown = {
  total: number;
  withOrder: number;
  withoutOrder: number;
};

export type BossAiContext = {
  headlinePeriod: { type: "DAILY"; date: string };
  analysisWindow: { from: string; to: string };
  dataCompleteness: {
    activeFrontline: number;
    confirmedFrontline: number;
    confirmationRate: number | null;
  };
  comparison: {
    yesterday: BossReportSnapshot;
    trailing7DayAverage: BossReportSnapshot;
  };
  employeeFunnels: BossEmployeeFunnel[];
  channelQuality: BossChannelQuality[];
  verifiedProblems: BossProblemCandidate[];
  leavesToday: {
    day1To8Abnormal: BossLeaveBreakdown;
    day9To13Watch: BossLeaveBreakdown;
    day14PlusNormal: BossLeaveBreakdown;
    dateMissing: BossLeaveBreakdown;
  };
};

export type BossProblemCandidate = {
  id: string;
  category: "DATA_COMPLETENESS" | "CUSTOMER_FLOW" | "EARLY_LEAVE" | "EMPLOYEE_CONVERSION" | "CHANNEL_QUALITY" | "OBSERVATION";
  severity: 0 | 1 | 2 | 3;
  target: string;
  display: string;
  actionHint: string;
  facts: Record<string, string | number | null>;
};

export type DailyBossBrief = {
  reportDate: string;
  generatedAt: string;
  hasData: boolean;
  totals: BossReportTotals;
  rates: BossReportRates;
  topCompanies: BossReportRanking[];
  topGroups: BossReportRanking[];
  groupRows: BossReportGroupRow[];
  anomalies: BossReportAnomalies;
  aiContext?: BossAiContext;
};

export type BossAiAnalysis = {
  summary: string;
  findings: string[];
  actions: string[];
};
