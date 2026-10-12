import { it, expect, vi } from "vitest";
const tx=vi.hoisted(()=>({channel:{findMany:vi.fn()},resourceBuyerPhone:{findMany:vi.fn()},customerSheetRow:{findMany:vi.fn()}}));
vi.mock("../../src/lib/db",()=>({db:{$transaction:(f:(v:typeof tx)=>unknown)=>f(tx)}}));
import { loadResourceAnalysis } from "../../src/lib/resource-bot/analysis-data";
import { querySchema } from "../../src/lib/resource-bot/query";
it("scheduled group filtering must not turn a globally ambiguous phone into a unique buyer match",async()=>{
 tx.channel.findMany.mockResolvedValue(["a","b"].map(groupId=>({id:"fb",name:"FB",channelType:"ADS",groupId,group:{name:groupId}})));
 tx.customerSheetRow.findMany.mockResolvedValue(["a","b"].map(groupId=>({id:groupId,phone:"12345678",groupId,data:JSON.stringify({channelId:"fb",intakeOn:"2026-10-01"})})));
 const attr={phone:"12345678",channelId:"fb",groupId:null,buyer:{name:"QQ"},material:null,country:"DE",sourceDate:"2026-10-01"};
 tx.resourceBuyerPhone.findMany.mockResolvedValue([attr]);
 const q=querySchema.parse({view:"analysis",type:"ALL",period:"custom",from:"2026-10-01",to:"2026-10-12"});
 expect((await loadResourceAnalysis(q,"2026-10-13",{groupIds:["a"]})).performance.recordCount).toBe(0);
 tx.resourceBuyerPhone.findMany.mockResolvedValue([{...attr,groupId:"a"}]);
 expect((await loadResourceAnalysis(q,"2026-10-13",{groupIds:["a"]})).performance.recordCount).toBe(1);
 expect((await loadResourceAnalysis(q,"2026-10-13",{groupIds:["b"]})).performance.recordCount).toBe(0);
});
