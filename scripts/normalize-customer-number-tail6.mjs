import { PrismaClient } from "@prisma/client";
import { inspectCustomerNumberRows } from "./normalize-customer-number-tail6-lib.mjs";

const databaseUrl = process.env.MIGRATION_DATABASE_URL ?? "";
if (!databaseUrl.startsWith("postgresql://") && !databaseUrl.startsWith("postgres://")) {
  throw new Error("安全拦截：客户号码转换只能使用 MIGRATION_DATABASE_URL 连接 PostgreSQL。");
}

const apply = process.env.CONFIRM_CUSTOMER_NUMBER_TAIL6 === "YES";
const db = new PrismaClient({ datasourceUrl: databaseUrl });

try {
  const [customers, orders] = await Promise.all([
    db.leadCustomer.findMany({ select: { id: true, phone: true } }),
    db.customerOrder.findMany({ select: { id: true, phone: true } }),
  ]);
  const customerCheck = inspectCustomerNumberRows(customers);
  const orderCheck = inspectCustomerNumberRows(orders);
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", customers: customerCheck, orders: orderCheck }));

  if (customerCheck.invalidCount || orderCheck.invalidCount) {
    throw new Error("检测到少于6位数字的旧客户号码，未修改数据库。");
  }
  if (customerCheck.collisionGroupCount || orderCheck.collisionGroupCount) {
    throw new Error("末6位转换后存在重复客户，必须人工处理后再运行；未修改数据库。");
  }
  if (!apply) {
    console.log("只读检查通过。确认已经完成数据库备份后，设置 CONFIRM_CUSTOMER_NUMBER_TAIL6=YES 再执行。");
  } else {
    const result = await db.$transaction(async (tx) => {
      const ordersChanged = await tx.$executeRawUnsafe(`
        UPDATE "CustomerOrder"
        SET phone = right(regexp_replace(phone, '[^0-9]', '', 'g'), 6)
        WHERE phone <> right(regexp_replace(phone, '[^0-9]', '', 'g'), 6)
      `);
      const customersChanged = await tx.$executeRawUnsafe(`
        UPDATE "LeadCustomer"
        SET phone = right(regexp_replace(phone, '[^0-9]', '', 'g'), 6)
        WHERE phone <> right(regexp_replace(phone, '[^0-9]', '', 'g'), 6)
      `);
      const exceptionsChanged = await tx.$executeRawUnsafe(`
        UPDATE "LeadException"
        SET phone = right(regexp_replace(phone, '[^0-9]', '', 'g'), 6)
        WHERE length(regexp_replace(phone, '[^0-9]', '', 'g')) >= 6
          AND phone <> right(regexp_replace(phone, '[^0-9]', '', 'g'), 6)
      `);
      return { customersChanged, ordersChanged, exceptionsChanged };
    });
    console.log(JSON.stringify({ completed: true, ...result }));
  }
} finally {
  await db.$disconnect();
}
