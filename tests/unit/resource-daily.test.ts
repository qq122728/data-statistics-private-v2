import { describe, it, expect, vi } from "vitest";
import { dailyReportText, dispatchResourceDaily, type DeliveryState } from "../../src/lib/resource-bot/daily";
import { analyzeResources, type AnalysisRow } from "../../src/lib/resource-bot/analysis";
import type { BotConfig } from "../../src/lib/resource-bot/config";
const config: BotConfig = { revision:"r",token:"test",botId:1,username:"resource",name:"resource",enabled:true,chatId:"-123",chatTitle:"资源群",activatedAt:0,updatedBy:"test" };
const row: AnalysisRow = {id:"r",phone:"00123456",group:"A",channel:"FB",channelId:"fb",type:"ADS",buyer:"QQ",country:"DE",material:"",attributed:true,data:{intakeOn:"2026-09-01",repliedOn:"2026-10-11",joinedOn:"2026-10-12",firstDepositOn:"2026-10-12",firstDeposit:100}};
const extras = { pending:0,ambiguous:0,spendRecords:0,importCount:0 };
const analysis = () => analyzeResources([row],{from:"2026-10-01",to:"2026-10-12"},extras);
const due = [{groupId:"g1",groupName:"A",date:"2026-10-12",ready:true},{groupId:"g2",groupName:"B",date:"2026-10-12",ready:true}];
function setup() { return {config,due,state:{sent:{}} as DeliveryState,analyze:vi.fn(async()=>analysis()),save:vi.fn(async()=>{}),send:vi.fn(async(_chatId: string, _text: string)=>({message_id:7}))}; }
describe("resource close-of-day delivery",()=>{
 it("merges groups from the same existing report window, keeps exact shift date and destination",async()=>{
  const x=setup();await dispatchResourceDaily(x);
  expect(x.analyze).toHaveBeenCalledWith("2026-10-12",["g1","g2"]);
  expect(x.send).toHaveBeenCalledTimes(1);expect(x.send.mock.calls[0][0]).toBe("-123");
  expect(Object.values(x.state.sent).every(v=>v.status==="sent"&&v.messageId===7)).toBe(true);
  await dispatchResourceDaily(x);expect(x.send).toHaveBeenCalledTimes(1);
 });
 it("does not resend after an uncertain send, even on restart",async()=>{
  const x=setup();x.send=vi.fn(async(_chatId: string, _text: string)=>{throw Error("timeout")});await expect(dispatchResourceDaily(x)).rejects.toThrow(/未确认/);
  expect(Object.values(x.state.sent).every(v=>v.status==="uncertain")).toBe(true);
  await dispatchResourceDaily(x);expect(x.send).toHaveBeenCalledTimes(1);
 });
 it("persists the claim before any external send and fails closed on state write failure",async()=>{
  const x=setup();x.save=vi.fn(async()=>{throw Error("disk")});await expect(dispatchResourceDaily(x)).rejects.toThrow("disk");expect(x.send).not.toHaveBeenCalled();
 });
 it("preview is side effect free, and empty/disabled/not-due groups never send",async()=>{
  const x=setup();await dispatchResourceDaily({...x,dryRun:true});expect(x.send).not.toHaveBeenCalled();expect(x.save).not.toHaveBeenCalled();expect(x.state.sent).toEqual({});
  await dispatchResourceDaily({...x,config:{...config,enabled:false}});
  await dispatchResourceDaily({...x,due:due.map(r=>({...r,ready:false}))});
  await dispatchResourceDaily({...x,analyze:async()=>analyzeResources([],{from:"2026-10-01",to:"2026-10-12"},extras)});
  expect(x.send).not.toHaveBeenCalled();
 });
 it("reports today's activity separately from month totals without missing-data nags",()=>{
  const text=dailyReportText(analysis(),["A","B"]);
  expect(text).toMatch(/今日发生\n回复 0｜进群 1/);expect(text).toMatch(/本月累计.*\n回复 1｜进群 1/);
  expect(text).not.toMatch(/资料缺失|消耗未登记|未归属|未启用自动推送/);expect(text.length).toBeLessThan(4000);
 });
 it("a different bot/group binding never inherits another destination's sent marker",async()=>{
  const x=setup();await dispatchResourceDaily(x);await dispatchResourceDaily({...x,config:{...config,chatId:"-456"}});expect(x.send).toHaveBeenCalledTimes(2);expect(x.send.mock.calls[1][0]).toBe("-456");
 });
});
