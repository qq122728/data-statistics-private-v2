import { type BotInsights, money, percent } from '../../packages/customer-sheet/bot-insights';

type Staff = {id:string;name:string;values:Record<string,number>};
export type CompactReport = {
  groupId:string; groupName:string; countryCode?:string; departmentName?:string; date:string;
  daily:Record<string,number>; monthly:Record<string,number>;
  reception:Staff[]; operators:Staff[]; experts:Staff[];
  insights?:BotInsights; insightNames?:Record<string,string>;
};
const cashOrDash=(n:number|null)=>n===null?'—':money(n);
const country=(r:CompactReport)=>({DE:'德国',SG:'新加坡',US:'美国',GB:'英国',IT:'意大利'}[r.countryCode||'']||r.departmentName||'小组');
const name=(r:CompactReport,id:string)=>r.insightNames?.[id]||[...r.reception,...r.operators,...r.experts].find(p=>p.id===id)?.name||(id==='未分配'?'未分配':'历史接粉人员');
export function compactGroupText(r:CompactReport) {
  const a=r.insights;if(!a)throw Error('缺少日报分析快照');
  const f=a.monthFinance;
  const lines=[`📊 ${country(r)}｜${r.groupName}`,`${r.date} 收工日报 · 新版`, '', '一、业务成绩', '指标｜今日｜本月'];
  for(const [key,label] of [['added','接粉'],['replied','回复'],['joined','进群'],['pushed','介绍专家'],['registered','注册'],['ordered','开单'],['initialDepositCents','首充'],['rechargeCents','续充'],['withdrawalCents','出金'],['netCents','净业绩']])
    lines.push(`${label}｜${key.endsWith('Cents')?money(r.daily[key]||0):r.daily[key]||0}｜${key.endsWith('Cents')?money(r.monthly[key]||0):r.monthly[key]||0}`);
  lines.push('','二、开单来自哪批粉？','接粉月份｜今日开单｜本月开单｜本月平均首充');
  for(const [key,label] of [['current','本月粉'],['old','以前粉'],['other','其他批次']] as const){
    const b=f.intake[key],d=a.day.intake[key];if(key==='other'&&!b.orders&&!d.orders)continue;
    lines.push(`${label}｜${d.orders}｜${b.orders}｜${b.orders?money(b.firstCents/b.orders):'—'}`);
  }
  lines.push(`整体平均首充：今日 ${cashOrDash(a.day.averageFirst)}；本月 ${cashOrDash(f.averageFirst)}。`,'','三、本月续充来源（按首次开单月份）');
  lines.push(`本月开单 ${money(f.opening.current)}｜上月开单 ${money(f.opening.previous)}｜更早开单 ${money(f.opening.earlier)}`);
  if(f.opening.other)lines.push(`其他开单批次 ${money(f.opening.other)}`);
  lines.push(`续充 ${f.renewed}人｜合计 ${money(f.rechargeCents)}｜续充人均 ${cashOrDash(f.averageRecharge)}`);
  lines.push('','四、接粉人员｜本月','姓名｜接粉｜回复率｜进群率｜推专家｜新粉/老粉开单');
  for(const p of a.people)lines.push(`${name(r,p.owner)}｜${p.leads}｜${percent(p.replies,p.leads)}｜${percent(p.joins,p.leads)}｜${p.introductions}｜${p.intake.current.orders}/${p.intake.old.orders}${p.intake.other.orders?`（其他${p.intake.other.orders}）`:''}`);
  if(!a.people.length)lines.push('本月暂无接粉或开单记录。');
  if(a.day.orders)lines.push('',`📌 今日${a.day.orders}个开单：本月粉${a.day.intake.current.orders}个、以前粉${a.day.intake.old.orders}个${a.day.intake.other.orders?`、其他${a.day.intake.other.orders}个`:''}。`);
  lines.push('','口径：上方按事件发生日统计；接粉人员回复/进群/推专家只看本月接粉客户，截至日报日的转化。开单归原接粉人；续充按实际到账日期，重复续充不算新开单。USD。');
  return lines.join('\n');
}
type Metric = BotInsights['channels'][number]['metrics'][number];
const metricValue=(m:Metric|undefined)=>!m||m.current.n<m.minimum?'—':m.key==='renewAmount'?`${money(m.current.value!)}（${m.current.n}人）`:`${percent(m.current.hits,m.current.n)}（${m.current.hits}/${m.current.n}）`;
export function countryAnalysisText(reports:CompactReport[]) {
  if(!reports.length||reports.some(r=>!r.insights))throw Error('缺少国家报告快照');
  const lines=[`🔎 ${country(reports[0])}｜业务能力分析`,`${reports[0].date} · ${reports.map(r=>r.groupName).join(' / ')}`,''];
  const warnings:Array<{text:string;action:string;decline:number}>=[];
  const eligible=reports.flatMap(r=>r.insights!.channels.map(c=>({r,c}))).filter(x=>x.c.metrics.some(m=>m.key!=='leadOrder'&&m.current.n>=m.minimum));
  // Match the channel label only for presentation; never pool different channels into a ranking.
  const labels=[...new Set(eligible.map(x=>x.c.channel))].sort((a,b)=>eligible.filter(x=>x.c.channel===b).length-eligible.filter(x=>x.c.channel===a).length);
  const selected=labels.slice(0,3);
  const metrics=(x:typeof eligible[number],key:string)=>x.c.metrics.find(m=>m.key===key);
  lines.push('一、接粉 → 炒群 → 专家（按渠道分开）');
  for(const channel of selected.filter(channel=>eligible.some(x=>x.c.channel===channel&&x.c.metrics.some(m=>!['leadOrder','renew','renewAmount'].includes(m.key)&&m.current.n>=m.minimum)))){
    lines.push(`【${channel}】`,'小组｜7天回复｜7天进群｜进群7天介绍｜7天异常退群');
    for(const x of eligible.filter(x=>x.c.channel===channel))lines.push(`${x.r.groupName}｜${metricValue(metrics(x,'reply'))}｜${metricValue(metrics(x,'join'))}｜${metricValue(metrics(x,'intro'))}｜${metricValue(metrics(x,'exit'))}`);
    lines.push('小组｜进群3天按时介绍｜接手7天注册｜接手30天开单');
    for(const x of eligible.filter(x=>x.c.channel===channel))lines.push(`${x.r.groupName}｜${metricValue(metrics(x,'timely'))}｜${metricValue(metrics(x,'register'))}｜${metricValue(metrics(x,'expertOrder'))}`);
  }
  if(!selected.length)lines.push('本次暂无满足观察时长和样本门槛的能力对比。');
  if(labels.length>3)lines.push(`其余${labels.length-3}个渠道可按渠道查询明细。`);
  for(const {r,c} of eligible)for(const m of c.metrics.filter(m=>m.alert&&m.key!=='leadOrder')){
    const fmt=(v:number)=>m.key==='renewAmount'?money(v):(100*v).toFixed(1)+'%';
    const action=['reply','join'].includes(m.key)?'按接粉人员核对跟进与来源。':['intro','timely','exit'].includes(m.key)?'组长检查未介绍专家和异常退群客户。':'专家负责人核对注册、开单及续充跟进。';
    warnings.push({text:`${r.groupName} / ${c.channel} ${m.label}：${fmt(m.previous.value!)} → ${fmt(m.current.value!)}，${m.key==='exit'?'上升':'下降'}${(Math.abs(m.decline!)*100).toFixed(1)}%。批次${m.previous.from}—${m.previous.to} 对 ${m.current.from}—${m.current.to}；样本${m.previous.n}→${m.current.n}。`,action,decline:Math.abs(m.decline!)});
  }
  lines.push('','二、首充质量｜本月','小组｜开单｜首充总额｜平均首充｜新粉/老粉均额');
  for(const r of reports){const f=r.insights!.monthFinance,b=f.intake;lines.push(`${r.groupName}｜${f.orders}｜${money(f.firstCents)}｜${cashOrDash(f.averageFirst)}｜${b.current.orders?money(b.current.firstCents/b.current.orders):'—'}/${b.old.orders?money(b.old.firstCents/b.old.orders):'—'}`);
    const c=r.insights!.firstComparison;
    if(c.current.orders>=10&&c.previous.orders>=10&&c.previous.averageFirst!>0){const decline=(c.previous.averageFirst!-c.current.averageFirst!)/c.previous.averageFirst!;if(decline>=0.1-1e-10)warnings.push({text:`${r.groupName}平均首充 ${cashOrDash(c.previous.averageFirst)} → ${cashOrDash(c.current.averageFirst)}，下降${(decline*100).toFixed(1)}%；${c.previousFrom}—${c.previousTo} 对 ${c.from}—${c.to}（${c.previous.orders}→${c.current.orders}人）。`,action:'按渠道及专家拆查首充结构，避免把来源变化直接归因为能力。',decline});}
  }
  lines.push('','三、续充贡献｜本月','小组｜续充人数｜续充总额｜续充人均');
  for(const r of reports){const f=r.insights!.monthFinance;lines.push(`${r.groupName}｜${f.renewed}｜${money(f.rechargeCents)}｜${cashOrDash(f.averageRecharge)}`);lines.push(`来源：本月开单${money(f.opening.current)} / 上月${money(f.opening.previous)} / 更早${money(f.opening.earlier)}${f.opening.other?` / 其他${money(f.opening.other)}`:''}`);}
  lines.push('','四、后续贡献｜开单后前30天','小组 / 渠道｜续充率｜人均续充（含未续充者）');
  const renewRows=eligible.filter(x=>selected.includes(x.c.channel)&&metrics(x,'renew')!.current.n>=10);
  for(const x of renewRows)lines.push(`${x.r.groupName} / ${x.c.channel}｜${metricValue(metrics(x,'renew'))}｜${metricValue(metrics(x,'renewAmount'))}`);
  if(!renewRows.length)lines.push('本次成熟批次未达到续充比较门槛，继续观察。');
  const specialistRows=reports.flatMap(r=>r.insights!.experts.filter(e=>e.id!=='未分配'&&e.metrics.some(m=>['register','expertOrder'].includes(m.key)&&m.current.n>=m.minimum)).map(e=>({r,e})));
  if(specialistRows.length){lines.push('','专家跟进概览（当前负责人，来源混合，仅作定位）','专家 / 小组｜接手7天注册｜接手30天开单');for(const {r,e} of specialistRows.slice(0,8))lines.push(`${name(r,e.id)} / ${r.groupName}｜${metricValue(e.metrics.find(m=>m.key==='register'))}｜${metricValue(e.metrics.find(m=>m.key==='expertOrder'))}`);}
  warnings.sort((a,b)=>b.decline-a.decline);
  const top=warnings.slice(0,3);
  const renewTotal=reports.reduce((s,r)=>s+r.insights!.monthFinance.rechargeCents,0),prevTotal=reports.reduce((s,r)=>s+r.insights!.monthFinance.opening.previous,0);
  lines.push('','简短分析',reports.length===1?'本国家本次只有一个小组，使用自身批次变化，不做组间排名。':'同渠道、相同观察时长才可比较；组间差距用于定位，不直接认定人员能力。');
  const gaps:Array<{gap:number;text:string}>=[];
  for(const channel of selected)for(const key of ['intro','register','expertOrder']){
    const items=eligible.filter(x=>x.c.channel===channel&&metrics(x,key)!.current.n>=30).map(x=>({x,m:metrics(x,key)!})).sort((a,b)=>a.m.current.value!-b.m.current.value!);
    if(items.length>=2){const low=items[0],high=items[items.length-1],gap=high.m.current.value!-low.m.current.value!;if(gap>0)gaps.push({gap,text:`${channel} ${low.m.label}：${low.x.r.groupName}比${high.x.r.groupName}低${(100*gap).toFixed(1)}个百分点，优先检查该环节的承接。`});}
  }
  if(gaps.length)lines.push(gaps.sort((a,b)=>b.gap-a.gap)[0].text);
  if(renewTotal>0)lines.push(`上月开单客户贡献本期续充的${percent(prevTotal,renewTotal)}；新开单客户继续观察，不能用当前金额直接判定质量。`);
  lines.push('',top.length?'🔴 严重预警（最多3项）':'本次可比数据未触发严重预警。',...top.map((w,i)=>`${i+1}. ${w.text}`));
  if(top.length)lines.push('','明日优先处理',...[...new Set(top.map(w=>w.action))].slice(0,2).map((s,i)=>`${i+1}. ${s}`));
  lines.push('','口径：能力指标取最近14天已成熟批次，对比前14天同龄批次；各指标观察窗口不同，不串成同一漏斗。转化样本至少30人，续充至少10人；不足显示—。下降≥10%（异常退群率上升≥10%）严重预警。月内金额按实际发生；均额为描述，不直接排名。USD。');
  return lines.join('\n');
}
export function reportHtml(text:string) {
  const escape=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const lines=text.split('\n'),out:string[]=[];let table=false;
  for(const line of lines){const cells=line.split('｜');
    if(cells.length>=3){if(!table){out.push('<table>');table=true;}out.push('<tr>'+cells.map(c=>`<td>${escape(c)}</td>`).join('')+'</tr>');}
    else {if(table){out.push('</table>');table=false;}if(line)out.push(`<p>${escape(line)}</p>`);}
  }
  if(table)out.push('</table>');const html=out.join('');if(Buffer.byteLength(html)>32000)throw Error('日报超过富文本长度限制');return html;
}
