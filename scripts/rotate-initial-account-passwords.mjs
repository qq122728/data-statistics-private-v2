import { readFile } from "node:fs/promises";
import { randomBytes, scryptSync } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  parseInitialPasswordEntries,
  rotateInitialAccountPasswords,
} from "./rotate-initial-account-passwords-lib.mjs";

const passwordFile = process.env.INITIAL_ACCOUNT_PASSWORD_FILE;
const databaseUrl = process.env.DATABASE_URL ?? "";
if (!databaseUrl.startsWith("postgresql://") && !databaseUrl.startsWith("postgres://")) {
  throw new Error("安全拦截：线上初始账号轮换只能连接 PostgreSQL，拒绝在本机 SQLite 执行。");
}
if (process.env.CONFIRM_INITIAL_PASSWORD_ROTATION !== "YES") {
  throw new Error("安全拦截：这是线上账号轮换操作。确认后请设置 CONFIRM_INITIAL_PASSWORD_ROTATION=YES。");
}
if (!passwordFile) {
  throw new Error("请设置 INITIAL_ACCOUNT_PASSWORD_FILE，文件内容为 {\"账号\":\"新密码\"}，不要把密码直接写在命令历史里。");
}

const entries = parseInitialPasswordEntries(await readFile(passwordFile, "utf8"));

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

const db = new PrismaClient();
try {
  const existing = await db.user.findMany({
    where: { username: { in: entries.map(([username]) => username) } },
    select: { id: true, username: true },
  });
  const found = new Set(existing.map((user) => user.username));
  const missing = entries.map(([username]) => username).filter((username) => !found.has(username));
  if (missing.length) throw new Error(`未找到账号：${missing.join("、")}。为避免误操作，未修改任何账号。`);

  await rotateInitialAccountPasswords(db, existing, entries, hashPassword);
  console.log(`已轮换 ${entries.length} 个账号的临时密码，并使旧登录全部失效。这些账号下次登录必须先修改密码。`);
} finally {
  await db.$disconnect();
}
