import {describe,expect,it} from "vitest";
import {extractChatNumbers,localConversationDraft} from "../../packages/customer-sheet/chat-import";

describe("AI 助手文字导入",()=>{
 it("识别号码列表末尾同一行的阶段、日期、渠道和负责人",()=>{
  const text="491111111111\n492222222222\n10月14日添加有效粉 渠道：FB-M 接粉负责人：小娟 炒群负责人：牛牛 待进群";
  const numbers=extractChatNumbers(text);
  expect(numbers?.count).toBe(2);
  const draft=localConversationDraft(numbers!.instructions,"2026-10-14","current",[
   {id:"owner",name:"小娟",roles:["RECEPTION"]},
   {id:"operator",name:"牛牛",roles:["GROUP_OPERATOR"]},
  ],[{id:"channel",name:"FB-M"}]);
  expect(draft.stage).toBe("pending");
  expect(draft.defaults).toMatchObject({intakeOn:"2026-10-14",channelId:"channel",ownerId:"owner",operatorId:"operator"});
 });

 it("单独补充待进群也能恢复导入阶段",()=>{
  expect(localConversationDraft("待进群","2026-10-14","current",[],[]).stage).toBe("pending");
 });
});
