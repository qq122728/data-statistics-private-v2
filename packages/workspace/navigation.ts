/** 仅包含界面名称，不定义权限或查询范围。两端菜单、标题、帮助和 AI 共用。 */
export const WORKSPACE_LABELS = {
  "customers": "客户进度表",
  "devices": "设备账号",
  "rankings": "员工排名与预警",
  "groups": "小组管理",
  "members": "成员管理",
  "organization": "组织与人员",
  "departmentDashboard": "部门工作台",
  "companyDashboard": "公司工作台",
  "hqDashboard": "总公司工作台",
  "daily": "每日数据",
  "history": "历史数据",
  "finance": "财务数据",
  "summary": "数据汇总",
  "groupSummary": "小组数据汇总",
  "channels": "渠道管理",
  "channelSettings": "渠道设置",
  "notifications": "通知中心",
  "personnel": "人员与岗位",
  "transfer": "人员调动",
  "companies": "公司与部门",
  "resources": "资源管理",
  "resourceDashboard": "资源工作台",
  "resourceDaily": "每日渠道数据",
  "resourceSummary": "渠道数据汇总",
  "resourceChannels": "渠道与单价",
  "resourceUsage": "渠道使用情况",
  "resourceAccounts": "资源账号管理",
  "resourceComparison": "渠道表现对比",
  "resourceAnomalies": "异常数据提醒",
  "myDashboard": "我的看板",
  "channelReview": "渠道数据核对",
  "departmentDetail": "部门明细",
  "companyDetail": "公司明细",
  "groupDetail": "小组明细",
  "groupDataDetail": "小组数据明细",
  "groupLeadership": "小组与人员管理",
  "companyLeadership": "部门与组长人事",
  "systemAdmin": "系统管理员",
  "hqAdmin": "总公司管理员"
} as const;

export const NAV_GROUPS = { work: "我的工作", data: "数据查看", organization: "组织与人员", resources: "资源管理" } as const;

export const NAVIGATION_GUIDE = `菜单按“${NAV_GROUPS.work}、${NAV_GROUPS.data}、${NAV_GROUPS.organization}、${NAV_GROUPS.resources}”分组，仅显示当前账号已有入口。客户操作入口统一叫“${WORKSPACE_LABELS.customers}”，设备入口叫“${WORKSPACE_LABELS.devices}”，榜单叫“${WORKSPACE_LABELS.rankings}”。组长在“${WORKSPACE_LABELS.groups}”处理成员和交接；综合人事入口叫“${WORKSPACE_LABELS.organization}”，分开的公司、部门、人员入口仍保留。以当前账号实际菜单为准。`;

export const ACCOUNT_MENU_GUIDE = "点击右上角姓名打开账号菜单，可选择修改密码或退出登录。姓名下方显示当前岗位和管理范围。取消修改密码不会保存；成功修改后所有旧登录失效，需要重新登录。退出失败时请重试，不能只凭页面跳转判断已经退出。";

export const RESOURCE_REPORT_GUIDE = "资源报表默认显示常用数量和资金。用显示栏目展开转化率、退群明细、历史无效分类，或选择展开全部、恢复常用；这些操作只调整显示，不改合计或导出。查旧月份或遇到历史无效数据会提示并默认展开，手动收起后仍可重新查看。显示偏好按当前浏览器、账号、业务类型和报表页面分别保存。律师组保留完整手填指标；数量和资金按实际发生日期统计，当前在群为截止日存量，归属按原接粉成员。";

export const CUSTOMER_NUMBER_GUIDE = "只有同组账号可以查看和搜索客户完整号码，包括列表、查找、历史、导入与对话核对。同尾号客户逐条列出，按编号和负责人区分。其他组成员不能查看；管理账号跨组查看仍打码，可用尾号四位或编号查找。编辑与资金操作权限沿用原规则。";

export const CUSTOMER_FUND_GUIDE = "资金流水逐笔保存。录错时点击该笔右侧垃圾桶，核对日期、类型和金额后永久删除；系统会撤销该笔当前编号，并自动重算客户投资总额及对应日期业绩。删除不能在系统内恢复，但客户修改历史和编号历史保留。只有原本有权维护该客户资金的负责人可以操作。AI 闲聊不能代删，请到客户进度表的投资总额中处理。";
