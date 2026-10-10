"use client";

import { useEffect, useMemo, useState } from "react";
async function requestJson<T>(url: string): Promise<T> {
 const response=await fetch(url,{credentials:"include",cache:"no-store"});
 const data=await response.json();
 if(!response.ok)throw new Error(data.error||"读取汇总失败");
 return data as T;
}
import { RealMetricMatrix, type RealMetrics } from "./RealMetricsTable";
import styles from "./RealHierarchyOverview.module.css";

type Business = "HACKER" | "LAWYER";
type Group = {id:string;name:string;groupType:Business;leadName?:string|null;department:{id:string;name:string};company:{id:string;name:string}|null;period:{today:string;from:string;to:string};totals:RealMetrics};
type Member = {id:string;name:string;groupId:string;totals:RealMetrics};
type DailyDetail = {date:string;groupId:string;groupName:string;groupType:Business;department:{id:string;name:string};company:{id:string;name:string}|null;member:{id:string;name:string};channel:{id:string;name:string};totals:RealMetrics};
type Payload = {range:{preset:string;label:string;from:string;to:string};groups:Group[];members:Member[];dailyDetails:DailyDetail[]};
type DateMode = "month" | "day" | "today" | "3d" | "7d" | "yesterday" | "lastMonth" | "custom";
type FundKind = "ALL" | "INITIAL" | "RECHARGE" | "WITHDRAWAL";
type FundRow = {id:string;date:string;kind:"INITIAL"|"RECHARGE"|"WITHDRAWAL";phone:string;amountCents:number;depositMethod:"CRYPTO"|"BANK"|null;groupId:string;groupName:string;departmentName:string;companyName:string;channel:{id:string;name:string};owner:{id:string;name:string};enteredBy:{id:string;name:string}};
const money=(n=0)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n/100);
const sum=(groups:Array<{totals:RealMetrics}>,key:keyof RealMetrics)=>groups.reduce((n,g)=>n+(g.totals[key]??0),0);
const rate=(a:number,b:number)=>b>0?`${(a/b*100).toFixed(1)}%`:'—';
const monthToday=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit'}).format(new Date());
const dateToday=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const shiftDate=(date:string, days:number)=>{
 const value=new Date(`${date}T00:00:00Z`);value.setUTCDate(value.getUTCDate()+days);return value.toISOString().slice(0,10);
};
const daysForMonth=(month:string,today:string)=>{
 const [year,rawMonth]=month.split('-').map(Number);const total=new Date(Date.UTC(year,rawMonth,0)).getUTCDate();
 const latest=today.slice(0,7)===month?Math.min(total,Number(today.slice(8,10))):total;
 return Array.from({length:latest},(_,index)=>String(index+1).padStart(2,'0'));
};
const previousMonthRange=(month:string, today:string)=>{
 const [year,rawMonth]=month.split('-').map(Number); const previous=new Date(Date.UTC(year,rawMonth-2,1));
 const prefix=`${previous.getUTCFullYear()}-${String(previous.getUTCMonth()+1).padStart(2,'0')}`;
 const days=new Date(Date.UTC(previous.getUTCFullYear(),previous.getUTCMonth()+1,0)).getUTCDate();
 const currentMonth=today.slice(0,7)===month; const day=currentMonth?Math.min(Number(today.slice(8,10)),days):days;
 return {from:`${prefix}-01`,to:`${prefix}-${String(day).padStart(2,'0')}`};
};

export function RealHierarchyOverview({level,title,showDailyDetails=false}: {level:"group"|"department"|"company";title:string;fixedMonth?:boolean;showDailyDetails?:boolean}) {
 const [month,setMonth]=useState(monthToday);const [business,setBusiness]=useState<Business>('HACKER');
 const [dateMode,setDateMode]=useState<DateMode>('month');const [selectedDay,setSelectedDay]=useState('');const [customFrom,setCustomFrom]=useState(dateToday);const [customTo,setCustomTo]=useState(dateToday);
 const [company,setCompany]=useState('');const [department,setDepartment]=useState('');
 const [data,setData]=useState<Payload|null>(null);const [error,setError]=useState('');const [loading,setLoading]=useState(true);
 const [previousData,setPreviousData]=useState<Payload|null>(null);
 const [selected,setSelected]=useState('');const [person,setPerson]=useState('');const [channel,setChannel]=useState('');const [reload,setReload]=useState(0);
 const [fundKind,setFundKind]=useState<FundKind|null>(null);const [fundRows,setFundRows]=useState<FundRow[]>([]);const [fundLoading,setFundLoading]=useState(false);const [fundError,setFundError]=useState('');
 const isCompanyDashboard=level==='company'&&!showDailyDetails;
 const todayForPicker=dateToday();const monthDays=useMemo(()=>daysForMonth(month,todayForPicker),[month,todayForPicker]);
 useEffect(()=>{let live=true;setLoading(true);setError('');setSelected('');setPerson('');
  setChannel('');
  const params=new URLSearchParams();
  if(dateMode==='month')params.set('month',month);
  else if(dateMode==='day'||dateMode==='3d'||dateMode==='custom'){
   const from=dateMode==='day'?`${month}-${selectedDay}`:dateMode==='3d'?shiftDate(dateToday(),-2):customFrom;
   const to=dateMode==='day'?`${month}-${selectedDay}`:dateMode==='3d'?dateToday():customTo;
   if(!from||!to||from>to){setError('请选择正确的日期范围');setLoading(false);return()=>{live=false;};}
   params.set('range','custom');params.set('sourceDateFrom',from);params.set('sourceDateTo',to);
  }else params.set('range',dateMode);
  if(showDailyDetails)params.set('dailyDetails','1');
  const currentRequest=requestJson<Payload>(`/api/org/reporting?${params}`);
  const wantsComparison=level==='company'&&!showDailyDetails&&dateMode==='month';
  const previousRequest=wantsComparison?requestJson<Payload>(`/api/org/reporting?${new URLSearchParams({range:'custom',...previousMonthRange(month,dateToday())})}`):Promise.resolve(null);
  void Promise.all([currentRequest,previousRequest]).then(([current,previous])=>{if(live){setData(current);setPreviousData(previous);}}).catch(e=>{if(live)setError(e instanceof Error?e.message:'读取失败');}).finally(()=>{if(live)setLoading(false);});
  return()=>{live=false;};
 },[month,selectedDay,dateMode,customFrom,customTo,reload,showDailyDetails,level]);
 const groups=(data?.groups??[]).filter(g=>g.groupType===business&&(!company||(g.company?.id??'none')===company)&&(!department||g.department.id===department));
 const previousGroups=(previousData?.groups??[]).filter(g=>g.groupType===business&&(!company||(g.company?.id??'none')===company)&&(!department||g.department.id===department));
 const groupScopeKey=groups.map(group=>group.id).join(',');
 const companies=useMemo(()=>[...new Map((data?.groups??[]).map(g=>[g.company?.id??'none',g.company?.name??'未归属公司'])).entries()],[data]);
 const departments=useMemo(()=>[...new Map((data?.groups??[]).filter(g=>!company||(g.company?.id??'none')===company).map(g=>[g.department.id,g.department.name])).entries()],[data,company]);
 const today=data?.groups[0]?.period.today??dateToday();const historical=(data?.range?.to??`${month}-01`)<'2026-09-01';
 const end=data?.groups[0]?.period.to??'';const stockLabel=end&&end<today?'截止日在群':'当前在群';
 const selectedGroup=groups.find(g=>g.id===selected);const members=(data?.members??[]).filter(m=>m.groupId===selected);
 const selectedMember=members.find(m=>m.id===person);
 const dailyScope=(data?.dailyDetails??[]).filter(row=>row.groupType===business&&(!company||(row.company?.id??'none')===company)&&(!department||row.department.id===department)&&(!selected||row.groupId===selected)&&(!person||row.member.id===person));
 const channels=useMemo(()=>[...new Set(dailyScope.map(row=>row.channel.name))].sort((a,b)=>a.localeCompare(b,'zh-CN')),[dailyScope]);
 const dailyRows=dailyScope.filter(row=>!channel||row.channel.name===channel);
 const selectedChannelId=dailyScope.find(row=>row.channel.name===channel)?.channel.id??'';
 useEffect(()=>{
  if(!showDailyDetails||!fundKind||!data?.range?.from||!data.range.to)return;
  let live=true;setFundLoading(true);setFundError('');
  const params=new URLSearchParams({from:data.range.from,to:data.range.to});
  if(selected)params.set('groupId',selected);else if(groupScopeKey)params.set('groupIds',groupScopeKey);if(selectedChannelId)params.set('channelId',selectedChannelId);
  void requestJson<{rows:FundRow[]}>(`/api/finance/ledger?${params}`).then(value=>{if(live)setFundRows(value.rows);}).catch(caught=>{if(live){setFundRows([]);setFundError(caught instanceof Error?caught.message:'资金明细读取失败');}}).finally(()=>{if(live)setFundLoading(false);});
  return()=>{live=false;};
 },[showDailyDetails,fundKind,data?.range?.from,data?.range?.to,selected,selectedChannelId,reload,groupScopeKey]);
 const visibleFundRows=fundRows.filter(row=>groups.some(group=>group.id===row.groupId)&&(fundKind==='ALL'||row.kind===fundKind)&&(!person||row.owner.id===person));
 const t=(key:keyof RealMetrics)=>sum(groups,key);
 const main: Array<[string,keyof RealMetrics]> = business==='HACKER' ? [['添加数据','added'],['有效数据','effective'],['回复','replied'],['进群','joined']] : [['接粉','added'],['回复','replied'],['添加律师','lawyerAdded'],['注册','registered']];
 const columns: Array<[string,keyof RealMetrics]> = business==='HACKER' ? [['添加','added'],['有效','effective'],['回复','replied'],['进群','joined'],['注册','registered'],['开单','ordered']] : [['接粉','added'],['回复','replied'],['添加律师','lawyerAdded'],['添加专家','lawyerExpertAdded'],['注册','registered'],['开单','ordered']];
 const dailyColumns: Array<[string,keyof RealMetrics,"count"|"money"]> = business==='HACKER' ? [
  ['添加','added','count'],['撞粉','collision','count'],['低金额','lowAmount','count'],['无WS','noWs','count'],['人工无效','manualInvalid','count'],['有效','effective','count'],['回复','replied','count'],['进群','joined','count'],['正常退群','leftNormal','count'],['异常退群','leftAbnormal','count'],['在群','inGroup','count'],['推专家','pushed','count'],['注册','registered','count'],['开单','ordered','count'],['首充','initialDepositCents','money'],['续充','rechargeCents','money'],['出金','withdrawalCents','money'],['净业绩','netCents','money'],
 ] : [
  ['接粉','added','count'],['回复','replied','count'],['接粉小金额','lowAmount','count'],['真实案件','lawyerRealCase','count'],['添加律师','lawyerAdded','count'],['添加专家','lawyerExpertAdded','count'],['推客服','customerServicePush','count'],['注册','registered','count'],['开单','ordered','count'],['银行卡充值','bankDepositCents','money'],['加密货币充值','cryptoDepositCents','money'],['出金','withdrawalCents','money'],['净业绩','netCents','money'],
 ];
 const resetSelection=()=>{setSelected('');setPerson('');setChannel('');};
 return <div className={styles.page}>
  <section className={`${styles.toolbar} ${isCompanyDashboard?styles.compactToolbar:''}`} aria-label="汇总筛选">
   <div className={styles.heading}><div><h2>{title}</h2><p>{showDailyDetails?'先选时间和业务，再按小组、成员、渠道核对每日数据。':'选择统计时间和业务后，可继续展开小组与组员数据。'}</p></div><button className="btn" onClick={()=>setReload(n=>n+1)} disabled={loading}>刷新数据</button></div>
   {isCompanyDashboard&&<div className={styles.quickRanges} role="group" aria-label="快捷时间">{([['today','今天'],['3d','近3天'],['7d','近7天'],['month','本月'],['lastMonth','上月']] as const).map(([mode,label])=><button type="button" key={mode} aria-pressed={dateMode===mode} onClick={()=>{setDateMode(mode);setSelectedDay('');}}>{label}</button>)}<button type="button" aria-pressed={dateMode==='custom'} onClick={()=>setDateMode('custom')}>自定义</button></div>}
   <div className={styles.filters}>
    {!isCompanyDashboard&&showDailyDetails&&<label>时间范围<select aria-label="时间范围" value={dateMode} onChange={e=>setDateMode(e.target.value as DateMode)}><option value="today">今天</option><option value="yesterday">昨天</option><option value="month">选择月份</option><option value="lastMonth">上个月</option><option value="custom">自定义日期</option></select></label>}
    {(isCompanyDashboard||(!showDailyDetails||dateMode==='month'))&&<label>统计月份<input aria-label="统计月份" type="month" value={month} max={today.slice(0,7)} onChange={e=>{if(e.target.value){setMonth(e.target.value);setDateMode(selectedDay?'day':'month');}}}/></label>}
    {isCompanyDashboard&&<label>统计日期<select aria-label="统计日期" value={selectedDay} onChange={e=>{setSelectedDay(e.target.value);setDateMode(e.target.value?'day':'month');}}><option value="">整月</option>{monthDays.map(day=><option key={day} value={day}>{Number(day)}日</option>)}</select></label>}
    {(showDailyDetails||isCompanyDashboard)&&dateMode==='custom'&&<><label>开始日期<input aria-label="开始日期" type="date" value={customFrom} max={today} onChange={e=>setCustomFrom(e.target.value)}/></label><label>结束日期<input aria-label="结束日期" type="date" value={customTo} min={customFrom} max={today} onChange={e=>setCustomTo(e.target.value)}/></label></>}
    {level==='company'&&<label>公司<select aria-label="公司筛选" value={company} onChange={e=>{setCompany(e.target.value);setDepartment('');resetSelection();}}><option value="">全部公司</option>{companies.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>}
    {level!=='group'&&<label>部门<select aria-label="部门筛选" value={department} onChange={e=>{setDepartment(e.target.value);resetSelection();}}><option value="">全部部门</option>{departments.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>}
    <div className={styles.business} role="group" aria-label="业务类型">{(['HACKER','LAWYER'] as const).map(b=><button key={b} aria-pressed={business===b} onClick={()=>{setBusiness(b);resetSelection();}}>{b==='HACKER'?'黑客组':'律师组'}</button>)}</div>
    {isCompanyDashboard&&<details className={styles.scopeHelp}><summary>统计口径</summary><div className={styles.explanation}><strong>{data?.range?.label??(historical?`${month.replace('-','年')}月历史日报`:business==='HACKER'?'按号码自动统计':'按手填日报统计')}</strong><span>{historical?'数量和资金读取当时保存的日报，在群读取截止日最后保存的存量。':business==='HACKER'?'数量和资金按实际发生日期汇总；在群按客户号码计算，不叠加8月旧存量。':'保留律师组原有填报方式，与黑客组分开核对。'}</span></div></details>}
   </div>
   {!isCompanyDashboard&&<div className={styles.explanation}><strong>{data?.range?.label??(historical?`${month.replace('-','年')}月历史日报`:business==='HACKER'?'按号码自动统计':'按手填日报统计')}</strong><span>{historical?'数量和资金读取当时保存的日报，在群读取截止日最后保存的存量。':business==='HACKER'?'数量和资金按实际发生日期汇总；在群按客户号码计算，不叠加8月旧存量。':'保留律师组原有填报方式，与黑客组分开核对。'}</span></div>}
  </section>
  {loading?<div role="status" className={styles.message}>正在读取数据…</div>:error?<div role="alert" className={styles.message}>{error}<button className="btn" onClick={()=>setReload(n=>n+1)}>重试</button></div>:level==='company'&&!showDailyDetails?<HeadquartersOverview groups={groups} previousGroups={previousGroups} business={business} from={data?.range?.from??''} to={end} selectedGroup={selectedGroup} members={members} onViewGroup={(id)=>{setSelected(id);setPerson('');}} onCloseGroup={resetSelection}/>:<>
   <div className={styles.cards}>{main.map(([label,key])=><section key={key} className={styles.stat}><span>{label}</span><strong>{t(key).toLocaleString()}</strong><small>{data?.range?.label??month} · 所选业务</small></section>)}</div>
   <div className={styles.funds}>{([['首充','initialDepositCents','INITIAL'],['续充','rechargeCents','RECHARGE'],['出金','withdrawalCents','WITHDRAWAL'],['净业绩','netCents','ALL']] as const).map(([label,key,kind])=><div key={key}><span>{label}</span>{showDailyDetails?<button aria-expanded={fundKind===kind} onClick={()=>setFundKind(fundKind===kind?null:kind)}>{money(t(key))}</button>:<strong>{money(t(key))}</strong>}</div>)}</div>
   {showDailyDetails&&fundKind&&<section className={styles.detail} aria-label="客户资金登记"><div className={styles.sectionTitle}><div><h3>{fundKind==='INITIAL'?'首充':fundKind==='RECHARGE'?'续充':fundKind==='WITHDRAWAL'?'出金':'全部资金'}登记</h3><p>只显示核账字段；统计汇总仍以已生效日报为准</p></div><button className="btn" onClick={()=>setFundKind(null)}>收起</button></div>{fundLoading?<div className={styles.message}>正在读取资金登记…</div>:fundError?<div role="alert" className={styles.message}>{fundError}</div>:<div className={styles.tableScroll}><table><thead><tr><th>发生日期 / 组织</th><th>客户号码</th><th>类型</th><th>归属成员</th><th>渠道</th><th>方式</th><th>录入人</th><th>金额</th></tr></thead><tbody>{visibleFundRows.map(row=><tr key={row.id}><th>{row.date}<small>{row.companyName} · {row.departmentName} · {row.groupName}</small></th><td>{row.phone}</td><td>{row.kind==='INITIAL'?'首充':row.kind==='RECHARGE'?'续充':'出金'}</td><td>{row.owner.name}</td><td>{row.channel.name}</td><td>{row.depositMethod==='CRYPTO'?'加密货币':row.depositMethod==='BANK'?'银行卡':'—'}</td><td>{row.enteredBy.name}</td><td>{money(row.amountCents)}</td></tr>)}{!visibleFundRows.length&&<tr><td colSpan={8} className={styles.empty}>当前筛选范围没有对应资金登记</td></tr>}</tbody></table></div>}</section>}
   <section className={styles.detail}>
    <div className={styles.sectionTitle}><div><h3>小组明细</h3><p>{groups.length}个小组 · 点击小组查看组员，再点击组员核对完整指标</p></div>{business==='HACKER'&&<div className={styles.stock}><span>{stockLabel}</span><strong>{t('inGroup')}人</strong><small>截至 {end}</small></div>}</div>
    <div className={styles.tableScroll}><table><thead><tr><th>小组 / 所属组织</th>{columns.map(([label,key])=><th key={key}>{label}</th>)}<th>净业绩</th></tr></thead><tbody>
     {groups.map(g=><tr key={g.id} data-selected={selected===g.id}><th><button aria-expanded={selected===g.id} onClick={()=>{setSelected(selected===g.id?'':g.id);setPerson('');}}>{g.name}</button><small>{g.company?.name??'未归属公司'} · {g.department.name}</small></th>{columns.map(([,key])=><td key={key}>{g.totals[key]??0}</td>)}<td>{money(g.totals.netCents)}</td></tr>)}
     {!groups.length&&<tr><td colSpan={columns.length+2} className={styles.empty}>当前范围没有{business==='HACKER'?'黑客组':'律师组'}。请选择其他业务或组织。</td></tr>}
    </tbody></table></div>
   </section>
   {selectedGroup&&<section className={styles.detail} aria-label="组员明细"><div className={styles.sectionTitle}><div><h3>{selectedGroup.name} · 组员明细</h3><p>统计区间 {selectedGroup.period.from} 至 {selectedGroup.period.to}</p></div><button className="btn" onClick={resetSelection}>收起明细</button></div>
    <div className={styles.tableScroll}><table><thead><tr><th>组员</th>{columns.map(([label,key])=><th key={key}>{label}</th>)}<th>净业绩</th></tr></thead><tbody>{members.map(m=><tr key={m.id}><th><button aria-expanded={person===m.id} onClick={()=>setPerson(person===m.id?'':m.id)}>{m.name}</button></th>{columns.map(([,key])=><td key={key}>{m.totals[key]??0}</td>)}<td>{money(m.totals.netCents)}</td></tr>)}{!members.length&&<tr><td colSpan={columns.length+2}>此区间暂无组员记录</td></tr>}</tbody></table></div>
    <details className={styles.allMetrics} key={person || selected} open={Boolean(selectedMember) || undefined}><summary>查看{selectedMember?selectedMember.name:'全组'}完整指标</summary><RealMetricMatrix title={selectedMember?selectedMember.name:selectedGroup.name} groupType={business} note={historical?'历史日报原始指标；下方“当前在群”表示所选截止日存量。':`统计截至 ${end}`} columns={[{id:selectedMember?.id??selectedGroup.id,name:selectedMember?.name??selectedGroup.name,metrics:selectedMember?.totals??selectedGroup.totals,rates:{}}]}/></details>
   </section>}
   {showDailyDetails&&<section className={styles.detail} aria-label="每日完整明细">
    <div className={styles.sectionTitle}><div><h3>每日完整明细</h3><p>{data?.range?.from} 至 {data?.range?.to} · 每行对应一天、一个小组、一名成员和一个渠道，共 {dailyRows.length} 条</p></div>{data?.range&&groups.length>0&&<a className="btn" href={`/api/exports/member-performance?from=${encodeURIComponent(data.range.from)}&to=${encodeURIComponent(data.range.to)}&groupIds=${encodeURIComponent(groups.map(group=>group.id).join(','))}`}>导出当前明细</a>}</div>
    <div className={styles.detailFilters}>
     <label>小组<select aria-label="每日明细小组" value={selected} onChange={e=>{setSelected(e.target.value);setPerson('');setChannel('');}}><option value="">全部小组</option>{groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
     <label>成员<select aria-label="每日明细成员" value={person} disabled={!selected} onChange={e=>{setPerson(e.target.value);setChannel('');}}><option value="">全部成员</option>{members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
     <label>渠道<select aria-label="每日明细渠道" value={channel} onChange={e=>setChannel(e.target.value)}><option value="">全部渠道</option>{channels.map(name=><option key={name} value={name}>{name}</option>)}</select></label>
     {(selected||person||channel)&&<button className="btn" onClick={resetSelection}>清除明细筛选</button>}
    </div>
    <div className={`${styles.tableScroll} ${styles.dailyTable}`}><table><thead><tr><th>日期 / 组织</th><th>成员</th><th>渠道</th>{dailyColumns.map(([label,key])=><th key={key}>{label}</th>)}</tr></thead><tbody>
     {dailyRows.map(row=><tr key={`${row.date}-${row.groupId}-${row.member.id}-${row.channel.id}`}><th>{row.date}<small>{row.company?.name??'未归属公司'} · {row.department.name} · {row.groupName}</small></th><td>{row.member.name}</td><td>{row.channel.name}</td>{dailyColumns.map(([,key,kind])=><td key={key}>{kind==='money'?money(row.totals[key]??0):(row.totals[key]??0).toLocaleString()}</td>)}</tr>)}
     {!dailyRows.length&&<tr><td colSpan={dailyColumns.length+3} className={styles.empty}>当前筛选范围没有已保存的每日数据</td></tr>}
    </tbody></table></div>
   </section>}
   <section className={styles.rates}><strong>{business==='HACKER'?'黑客组比率':'律师组比率'}</strong><span>回复率 {rate(t('replied'),business==='HACKER'?t('effective'):t('added'))}</span>{business==='HACKER'&&<span>进群率 {rate(t('joined'),t('effective'))}</span>}<span>开单 / 注册 {rate(t('ordered'),t('registered'))}</span><small>按同一期间汇总计算，分母为0显示“—”</small></section>
  </>}
 </div>;
}

type OverviewGroup = Pick<Group,"id"|"name"|"leadName"|"department"|"totals">;
const totalOf=(groups:OverviewGroup[], key:keyof RealMetrics)=>groups.reduce((value,group)=>value+(group.totals[key]??0),0);
const decimal=(value:number,base:number)=>base>0?value/base:null;
const displayRate=(value:number|null)=>value===null?'—':`${(value*100).toFixed(1)}%`;
const difference=(now:number,then:number)=>{
 if(!then)return '—'; const value=(now-then)/Math.abs(then); return `${value>=0?'+':''}${(value*100).toFixed(1)}%`;
};

/** Head-office view: show the business funnel first, then let management compare groups on one screen. */
function HeadquartersOverview({groups,previousGroups,business,from,to,selectedGroup,members,onViewGroup,onCloseGroup}:{groups:OverviewGroup[];previousGroups:OverviewGroup[];business:Business;from:string;to:string;selectedGroup:OverviewGroup|undefined;members:Member[];onViewGroup:(id:string)=>void;onCloseGroup:()=>void}) {
 const metric=(key:keyof RealMetrics)=>totalOf(groups,key);
 const previous=(key:keyof RealMetrics)=>totalOf(previousGroups,key);
 const added=metric('added'), effective=metric('effective'), replied=metric('replied'), joined=metric('joined'), pushed=metric('pushed'), registered=metric('registered'), ordered=metric('ordered');
 const responseBase=business==='HACKER'?effective:added;
 const groupBase=business==='HACKER'?effective:added;
 const groupValue=business==='HACKER'?joined:metric('lawyerAdded');
 const expertBase=business==='HACKER'?joined:metric('lawyerAdded');
 const expertValue=business==='HACKER'?pushed:metric('lawyerExpertAdded');
 const responseRate=decimal(replied,responseBase), groupRate=decimal(groupValue,groupBase), expertRate=decimal(expertValue,expertBase);
 const departments=[...new Map(groups.map(group=>[group.department.id,group.department.name])).entries()];
 const countColumns: Array<[string,keyof RealMetrics]> = business==='HACKER'
  ? [['添加','added'],['有效','effective'],['回复','replied'],['进群','joined'],['推专家','pushed'],['注册','registered'],['开单','ordered']]
  : [['接粉','added'],['回复','replied'],['添加律师','lawyerAdded'],['添加专家','lawyerExpertAdded'],['注册','registered'],['开单','ordered']];
 const fundColumns: Array<[string,keyof RealMetrics]> = [['首充金额','initialDepositCents'],['续充金额','rechargeCents'],['出金金额','withdrawalCents'],['净业绩','netCents']];
 return <div className={styles.hqDashboard}>
  <section className={styles.reportSheet} aria-label="经营汇总表">
   <div className={styles.reportCaption}><h3>经营汇总</h3><span>{from} 至 {to} · {groups.length} 个小组 · 截止日在群 {metric('inGroup').toLocaleString()} 人</span></div>
   <div className={styles.tableScroll}><table className={styles.summaryTable}><thead><tr><th>数据指标</th>{countColumns.map(([label,key])=><th key={key}>{label}</th>)}</tr></thead><tbody>
    <tr><th>本期数量</th>{countColumns.map(([,key])=><td key={key}>{metric(key).toLocaleString()}</td>)}</tr>
    {previousGroups.length>0&&<tr><th>较上月同期</th>{countColumns.map(([,key])=><td key={key}>{difference(metric(key),previous(key))}</td>)}</tr>}
   </tbody></table></div>
   <div className={styles.reportRatios}><span>回复率 <strong>{displayRate(responseRate)}</strong></span><span>{business==='HACKER'?'进群率':'添加律师率'} <strong>{displayRate(groupRate)}</strong></span><span>{business==='HACKER'?'推专家率':'添加专家率'} <strong>{displayRate(expertRate)}</strong></span><span>开单 / 注册 <strong>{displayRate(decimal(ordered,registered))}</strong></span></div>
   <div className={styles.tableScroll}><table className={styles.summaryTable}><thead><tr><th>资金指标</th>{fundColumns.map(([label,key])=><th key={key}>{label}</th>)}</tr></thead><tbody><tr><th>本期金额</th>{fundColumns.map(([,key])=><td key={key}>{money(metric(key))}</td>)}</tr>{previousGroups.length>0&&<tr><th>较上月同期</th>{fundColumns.map(([,key])=><td key={key}>{difference(metric(key),previous(key))}</td>)}</tr>}</tbody></table></div>
  </section>
  <section className={styles.hqTablePanel}><div className={styles.hqTitle}><div><h3>小组经营情况</h3><p>按部门和小组展示关键指标；点击“查看”可继续核对组员完整明细。</p></div></div><div className={styles.tableScroll}><table className={styles.hqTable}><thead><tr><th>部门</th><th>小组</th><th>小组长</th><th>添加</th><th>回复率</th><th>{business==='HACKER'?'进群率':'添加律师率'}</th><th>{business==='HACKER'?'推专家率':'添加专家率'}</th><th>首充金额</th><th>净业绩</th><th>较上月同期</th><th>查看</th></tr></thead><tbody>{departments.flatMap(([id,name])=>{
   const rows=groups.filter(group=>group.department.id===id); const subtotal={...rows[0],id:`subtotal-${id}`,name:`${name}小计`,leadName:'—',totals:{...rows.reduce((all,row)=>{for(const key of Object.keys(all) as Array<keyof RealMetrics>)all[key]+=row.totals[key]??0;return all;},{added:0,collision:0,lowAmount:0,noWs:0,effective:0,replied:0,joined:0,leftNormal:0,leftAbnormal:0,inGroup:0,pushed:0,registered:0,ordered:0,depositCents:0,withdrawalCents:0,netCents:0} as RealMetrics)}}; return [subtotal,...rows].map((group,index)=>{
    const old=previousGroups.find(value=>value.id===group.id); const gResponse=decimal(group.totals.replied,business==='HACKER'?group.totals.effective:group.totals.added); const gGroup=decimal(business==='HACKER'?group.totals.joined:(group.totals.lawyerAdded??0),group.totals.added); const gExpert=decimal(business==='HACKER'?group.totals.pushed:(group.totals.lawyerExpertAdded??0),business==='HACKER'?group.totals.joined:(group.totals.lawyerAdded??0));
    return <tr className={index===0?styles.departmentTotal:undefined} key={group.id}><td>{index===0?name:''}</td><td>{group.name}</td><td>{group.leadName??'待安排'}</td><td>{group.totals.added.toLocaleString()}</td><td>{displayRate(gResponse)}</td><td>{displayRate(gGroup)}</td><td>{displayRate(gExpert)}</td><td>{money(group.totals.initialDepositCents??0)}</td><td>{money(group.totals.netCents)}</td><td className={(difference(group.totals.netCents,old?.totals.netCents??0)).startsWith('-')?styles.down:styles.up}>{index===0?'—':difference(group.totals.netCents,old?.totals.netCents??0)}</td><td>{index===0?'':<button type="button" onClick={()=>onViewGroup(group.id)}>查看</button>}</td></tr>;
   }); })}{!groups.length&&<tr><td colSpan={11} className={styles.empty}>当前范围没有可展示的小组数据</td></tr>}</tbody></table></div></section>
  {selectedGroup&&<section className={styles.hqTablePanel} aria-label="小组组员明细"><div className={styles.hqTitle}><div><h3>{selectedGroup.name} · 组员明细</h3><p>用于继续核对每位成员的关键数据。</p></div><button type="button" className="btn" onClick={onCloseGroup}>收起明细</button></div><div className={styles.tableScroll}><table className={styles.hqTable}><thead><tr><th>组员</th><th>添加</th><th>回复率</th><th>{business==='HACKER'?'进群率':'添加律师率'}</th><th>{business==='HACKER'?'推专家率':'添加专家率'}</th><th>首充金额</th><th>净业绩</th></tr></thead><tbody>{members.map(member=>{const response=decimal(member.totals.replied,business==='HACKER'?member.totals.effective:member.totals.added);const groupRate=decimal(business==='HACKER'?member.totals.joined:(member.totals.lawyerAdded??0),member.totals.added);const expertRate=decimal(business==='HACKER'?member.totals.pushed:(member.totals.lawyerExpertAdded??0),business==='HACKER'?member.totals.joined:(member.totals.lawyerAdded??0));return <tr key={member.id}><th>{member.name}</th><td>{member.totals.added.toLocaleString()}</td><td>{displayRate(response)}</td><td>{displayRate(groupRate)}</td><td>{displayRate(expertRate)}</td><td>{money(member.totals.initialDepositCents??0)}</td><td>{money(member.totals.netCents)}</td></tr>;})}{!members.length&&<tr><td colSpan={7} className={styles.empty}>本统计周期暂无组员数据</td></tr>}</tbody></table></div></section>}
 </div>;
}
