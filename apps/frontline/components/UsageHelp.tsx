"use client";

import { useEffect, useRef, useState } from "react";
import { WORKSPACE_LABELS as labels, NAVIGATION_GUIDE, ACCOUNT_MENU_GUIDE, RESOURCE_REPORT_GUIDE, CUSTOMER_NUMBER_GUIDE, CUSTOMER_FUND_GUIDE } from "../../../packages/workspace/navigation";
import type { BackendUser } from "@/lib/backend";
import styles from "./UsageHelp.module.css";

const topics = [
  { title: "页面入口与名称", body: [NAVIGATION_GUIDE, ACCOUNT_MENU_GUIDE, RESOURCE_REPORT_GUIDE] },
  { title: "1. 第一次使用：先导入，再核对", body: [`打开“${labels.customers}”→“导入客户”，下载最新的统一 Excel 模板。一个客户只占一行，在“业务阶段”选择待进群、在群跟进或专家跟进，不要把同一号码重复填三遍。`, "先删除模板说明和示例客户，再填写自己的真实记录。只允许导入有效客户；撞粉、低金额、无 WS 号码、人工无效不再支持录入，上传前请移除这些记录。已有历史分类和统计保留。", "首行用途不明确时先选择它是列标题还是客户，不会默认丢弃第一行。上传后先检查日期、渠道、负责人及预览结果，处理报错和冲突，再勾选记录确认保存。仅上传文件或发送 AI 消息，不代表已经保存。“待新增 / 待更新”表示检查通过但未保存；错误行单列，不算成功。看到“已保存”才完成。文件渠道优先，统一渠道只补空；渠道错误需核对该行输入值及本组启用渠道。每批最多 500 位客户。"] },
  { title: "2. 三种阶段分别填什么", body: ["待进群：客户完整号码、真实接粉日期、渠道，以及有权限选择的前台负责人。已经回复的客户还要填写回复日期。", "在群跟进：在接粉资料基础上，补进群日期和群操作员；正常退群、异常退群分别记录实际发生日期。", "专家跟进：保留接粉、进群日期及群操作员，补加专家日期、专家负责人；已经注册或首充的，填写对应日期，首充还要填金额及银行卡/加密货币方式。", "群操作员和专家负责人从本组有对应岗位的在职人员中选择。人员变更后重新下载模板；能看到候选人不等于可以越权分配，无法选择时联系组长。"] },
  { title: "3. 补历史数据：日期不要都填今天", body: ["导入时接粉日期默认当前统计日，补录历史客户必须改为真实接粉日期。点击日期框可用日历选取日期；没有发生的动作不要提前填日期。", "例如：9/1 接粉、9/2 进群、9/3 加专家、9/4 注册、9/5 首充 100。添加计入 9/1，进群计入 9/2，推专家计入 9/3，注册计入 9/4，开单和首充金额计入 9/5。", "只导入号码不会自动补出进群、注册、开单或金额。资料不确定先核实，不能用今天代替未知日期。系统采用北京时间 14:00 换统计日，请以页面显示的统计日为准。"] },
  { title: "4. 日常跟进、退群和专家进度", body: [`进入${labels.customers}，点击带铅笔的字段修改，选择日期或完成编辑后查看保存提示；刷新重开可核对结果。只读字段需要由对应负责人或组长处理。`, "待进群按接粉日期、在群按进群日期、专家按加专家日期分组。可以用今天、昨天、自定义日期、搜索及状态筛选查找；折叠日期可以展开。每页50人，上下方均显示总人数、当前第几人及剩余人数，可直接选择页码。", "在群默认只看正常在群。保存退群后，客户移出当前名单；切换正常退群/异常退群或全部状态查看，不是客户被删除。误勾需撤销并核对日期。", "专家阶段按记录显示联系、追踪、注册、开单；暂停或结束通过跟进安排设置。接粉、回复、进群、加专家、追踪、邀请注册、开户、首充，已填写的日期必须按先后排列，允许同一天。追踪和邀请等选填步骤可以留空；实际日期不能晚于系统统计日。退群不能早于进群。"] },
  { title: "5. 首充、续充和出金怎么记", body: ["首充填写客户的首充金额、首充/开单日期和方式。后续新增资金点击“投资总额”，选择续充或出金，填每笔金额、发生日期和支付方式，点击保存流水。", "续充和出金日期不能早于已填写的首充日期，更改首充日期时也会核对已有流水。续充和出金要逐笔登记；当前导入模板支持首充，不导入续充/出金流水。不要把多笔不同日期的资金写成一笔总额。", "投资总额＝首充＋续充；净业绩＝首充＋续充－出金。保存后去对应发生日期核对报表。", CUSTOMER_FUND_GUIDE, "删除号码时点击行首垃圾桶，选择“删除归档”或“永久删除”。归档后可在“已删除”中恢复或永久删除；永久删除会清除客户资料、资金明细及客户修改历史，无法在系统内恢复。相关自动统计会重新计算。"] },
  { title: "6. 黑客组与律师组怎样统计", body: ["黑客组按号码和资金流水自动统计；律师组继续在每日数据填写数字和金额，导入或修改客户不会覆盖律师组的手填日报。以下自动变化规则适用于黑客组。", "带接粉日期和渠道的号码，添加和号码分类按接粉日统计；回复、进群、退群、推专家、注册、开单及资金按各自发生日统计。灰底或“号码自动统计”的数据用于核对，不再重复填数量。", "当前在群＝截至所选日期累计进群－累计正常退群－累计异常退群，包含以前日期仍留在群里的客户，不是把每天在群人数相加。", "发现数量不对，先核对报表日期、渠道及客户动作日期，再回客户记录修正。旧记录标记“历史手填”时属于旧口径，不能据此认为新号码没有自动统计。", "统计归属与当前办事人不是一回事：业务归属原接粉人，群操作员和专家负责各自进度。自己没有归属日报，不代表当天没工作。"] },
  { title: "7. AI 助手能做什么", body: ["直接发送有效客户的完整号码和说明，或上传统一 Excel。AI 使用同样的日期和有效数据限制，不会把无效客户改为有效来导入。助手在对话里询问缺少的日期、渠道和负责人，并生成文字摘要；回复“确认执行”才保存，没有导入卡片。", "可按号码更新本人接粉或群内负责客户的进度；专家后续及资金仅指定且具备专家权限的负责人可操作。已有客户沿用原资料，缺少日期不会擅自当作今天。每批导入最多500人，更新最多50人。", "确认保存后可继续对话更新同一批客户；发新号码可切换对象，回复“取消”放弃未保存操作。AI不能直接查询真实统计。刷新后对话重新开始，已保存资料保留。"] },
  { title: "8. 常见问题与求助", body: [CUSTOMER_NUMBER_GUIDE, "导入报重复或冲突：核对是否同一客户。已有客户可补资料，冲突默认保留旧值；不要换一个号码绕过校验。", "提示已被修改：其他人或另一个页面刚更新了客户，刷新读取最新内容后再核对修改，避免覆盖对方记录。", "找不到客户：点击“找号码 · 全部进度”，输入尾号四位、完整号码或客户编号，可查本组有权查看的全部进度及删除归档，不受当前日期、状态和负责人筛选影响。结果显示负责人、进度和页码；点击“直接打开”自动切换并高亮。相同尾号可能对应多人，请核对完整号码、编号和负责人。普通搜索仍筛选当前范围。", "需要组长帮助时，说明客户编号、页面名称、动作日期和报错内容。不要在公共群发送完整客户号码或密码。"] },
];

export function UsageHelp({ user }: { user: BackendUser }) {
  const management = !user.groupId || user.role === "ADMIN" || user.role === "COMPANY_MANAGER" || (Boolean(user.duty) && user.role !== "LEAD");
  const managementTopics = [
    {title:"管理账号：先选范围，再看数据",body:["部门管理员查看授权部门，公司管理员查看所属公司，总管理员查看全部授权组织；资源账号仅查看已授权渠道。看不到其他组织是权限范围限制，不需要重复导入数据。", "先确认公司、部门、小组及日期范围，再核对汇总。黑客组数量按客户动作日期、资金按每笔发生日期自动统计；律师组汇总来自手填日报。当前在群是截止日存量。"]},
    {title:"核对汇总和客户进度",body:["在汇总顶部查看各对象的比率，下方按指标查看数量和金额。客户进度先选择具体小组，再切换待进群、在群或专家阶段。", "上级管理账号的客户资料只读，号码按权限遮挡。发现错误请让相应负责人或组长更正客户原始记录，不要另填一份总数抵消。", "接粉统计归属与当前群、专家负责人不同。岗位榜按客户当前负责人展示期间成绩，不能将三个岗位相加当作组总计。"]},
    {title:"人员、渠道与操作确认",body:[`在“${labels.organization}”分组下维护人员岗位；渠道授权在账号或渠道入口处理，以当前菜单为准。人员变更前检查接收岗位、在办客户和设备，并先预览调动影响；历史接粉业绩不应因交接改名。`, "停用账号与删除记录不是一回事。停用用于限制登录，历史记录需要保留；不要通过删除账号处理普通离职交接。", "通知只在确认后发送。AI 对话不代替人事调动、客户修改或报表核对，也不会直接查询真实统计。"]},
    ...topics.filter(topic => !topic.title.startsWith("1.") && !topic.title.startsWith("2.")),
  ];
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const key = `usage-help:v3:${management ? "management" : "member"}:${user.id}`;
  useEffect(() => {
    try { setOpen(localStorage.getItem(key) !== "read"); }
    catch { setOpen(true); }
  }, [key]);
  useEffect(() => {
    const element = dialog.current;
    if (open && element && !element.open) element.showModal();
    if (!open && element?.open) element.close();
  }, [open]);
  function dismiss() {
    try { localStorage.setItem(key, "read"); } catch { /* Help remains usable without browser storage. */ }
    setOpen(false);
  }
  return <>
    <button type="button" className={styles.launch} onClick={() => setOpen(true)}>使用帮助</button>
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="usage-help-title" onCancel={event => { event.preventDefault(); dismiss(); }}>
      <header className={styles.header}><div><small>使用指南 · 可随时重新打开</small><h2 id="usage-help-title">{management ? "管理工作台使用说明" : "每日数据与客户操作指南"}</h2></div><button type="button" onClick={dismiss} aria-label="关闭使用帮助">关闭</button></header>
      <div className={styles.body}>
        <p className={styles.intro}>{user.groupId ? `${user.name}，从下面三步开始。` : "本说明介绍组员录入流程，管理账号按授权范围查看与核对。"}黑客组按号码自动统计，不重复填数；律师组继续填写每日数量和金额。</p>
        <ol className={styles.steps}>{management ? <><li><strong>选择管理范围</strong><span>确认组织、渠道和日期</span></li><li><strong>核对数量与资金</strong><span>从汇总追查客户原始记录</span></li><li><strong>处理人员与授权</strong><span>先预览影响，再确认操作</span></li></> : <><li><strong>导入完整号码</strong><span>一行一位客户，选实际阶段</span></li><li><strong>补真实日期</strong><span>接粉、进群、开单分别填写</span></li><li><strong>确认并核对</strong><span>保存后查看对应日期报表</span></li></>}</ol>
        <p className={styles.notice}>补录以前的客户，最重要的是日期。不要把历史动作都记到今天。</p>
        {user.role === "LEAD" && <p className={styles.notice}>组长：先核对渠道和负责人，再检查小组汇总；组员遇到归属或权限问题时由你协助处理。</p>}
        {(management ? managementTopics : topics).map((topic, index) => <details key={topic.title} open={index === 0 ? true : undefined}><summary>{topic.title}</summary>{topic.body.map(text => <p key={text}>{text}</p>)}</details>)}
      </div>
      <footer className={styles.footer}><small>本浏览器按账号记住已读；换设备或清理浏览器后会再次提示。</small><button type="button" onClick={dismiss}>知道了，开始使用</button></footer>
    </dialog>
  </>;
}
