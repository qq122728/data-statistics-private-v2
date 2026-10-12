import { PrismaClient } from "@prisma/client";
import { resolve } from "node:path";

const expected = `file:${resolve(process.cwd(), "prisma/dev.db")}`;
const url = process.env.DATABASE_URL || expected;
if (url !== expected && url !== "file:./dev.db") throw new Error("这个演示脚本只允许写入本项目的本地 SQLite 数据库");
const db = new PrismaClient({ datasourceUrl: expected });
const today = new Date().toISOString().slice(0, 10);
const month = today.slice(0, 7);
const examples = [
  { phone: "9000000101", channelId: "demo-fb-m", buyer: "QQ", data: { replied: true, joinedOn: `${month}-04`, expertOn: `${month}-06`, registeredOn: `${month}-08`, firstDepositOn: `${month}-09`, firstDeposit: 500, investmentTotal: 500 } },
  { phone: "9000000102", channelId: "demo-fb-m", buyer: "QQ", data: { replied: true, joinedOn: `${month}-05` } },
  { phone: "9000000103", channelId: "demo-fb-m", buyer: "QQ", data: { replied: false } },
  { phone: "9000000201", channelId: "demo-fb-m", buyer: "阳仔", data: { replied: true, joinedOn: `${month}-04`, expertOn: `${month}-07`, registeredOn: `${month}-09`, firstDepositOn: `${month}-10`, firstDeposit: 1000, investmentTotal: 1250, __investmentBaseCents: 0, __recharges: JSON.stringify([{ id: "local-demo-recharge", kind: "recharge", amountCents: 25000, date: `${month}-11`, method: "bank", actorId: "demo-expert", createdAt: new Date().toISOString() }]) } },
  { phone: "9000000202", channelId: "demo-fb-m", buyer: "阳仔", data: { replied: true, joinedOn: `${month}-05`, registeredOn: `${month}-09` } },
  { phone: "9000000301", channelId: "demo-fb-q", buyer: "QQ", data: { replied: true, joinedOn: `${month}-07` } },
  { phone: "9000000401", channelId: "demo-channel-sms", buyer: "短信商甲", data: { replied: true, joinedOn: `${month}-06`, expertOn: `${month}-08`, firstDepositOn: `${month}-11`, firstDeposit: 300, investmentTotal: 300 } },
];

try {
  const group = await db.teamGroup.findUnique({ where: { id: "demo-group" } });
  if (!group) throw new Error("请先运行 npm run seed:local-demo");
  for (const [id, name] of [["demo-fb-m", "FB-M"], ["demo-fb-q", "FB-Q"]]) {
    await db.channel.upsert({ where: { id_groupId: { id, groupId: group.id } }, update: { active: true, name }, create: { id, groupId: group.id, name, normalizedName: name.toLowerCase(), channelType: "ADS", active: true } });
    await db.resourceChannelAccess.upsert({ where: { userId_channelId: { userId: "demo-resource-ads", channelId: id } }, update: {}, create: { userId: "demo-resource-ads", channelId: id } });
  }
  for (const item of examples) {
    const data = { phone: item.phone, channelId: item.channelId, intakeOn: `${month}-03`, quality: "有效", ...item.data };
    await db.customerSheetRow.upsert({ where: { groupId_phone: { groupId: group.id, phone: item.phone } }, update: { data: JSON.stringify(data) }, create: { groupId: group.id, phone: item.phone, ownerId: "demo-reception", data: JSON.stringify(data) } });
    const buyer = await db.trafficBuyer.upsert({ where: { channelId_name: { channelId: item.channelId, name: item.buyer } }, update: { active: true }, create: { channelId: item.channelId, name: item.buyer } });
    await db.resourceBuyerPhone.upsert({ where: { channelId_phone: { channelId: item.channelId, phone: item.phone } }, update: { buyerId: buyer.id }, create: { channelId: item.channelId, phone: item.phone, buyerId: buyer.id, sourceDate: `${month}-03`, groupId: group.id, createdById: "demo-resource-ads" } });
  }
  console.log(`本地来源演示数据就绪：FB-M / FB-Q / 短信，QQ / 阳仔 / 短信商甲，${examples.length} 个虚构号码。`);
} finally { await db.$disconnect(); }
