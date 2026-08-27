import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, open, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const PART_BYTES = 45 * 1024 * 1024;

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少 ${name}`);
  return value;
}

async function createDatabaseDump(directory) {
  const databaseUrl = required("DATABASE_URL");
  if (databaseUrl.startsWith("postgresql://") || databaseUrl.startsWith("postgres://")) {
    const parsed = new URL(databaseUrl);
    const output = join(directory, "database.dump");
    await exec("pg_dump", ["--format=custom", "--no-owner", "--no-privileges", "--file", output], {
      env: {
        ...process.env,
        PGHOST: parsed.hostname,
        PGPORT: parsed.port || "5432",
        PGUSER: decodeURIComponent(parsed.username),
        PGPASSWORD: decodeURIComponent(parsed.password),
        PGDATABASE: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
      },
      maxBuffer: 1024 * 1024,
    });
    return output;
  }
  if (databaseUrl.startsWith("file:")) {
    const rawPath = databaseUrl.slice("file:".length).split("?")[0];
    const source = resolve(process.cwd(), "prisma", rawPath);
    const output = join(directory, "database.sqlite");
    await exec("sqlite3", [source, `.backup '${output.replaceAll("'", "''")}'`]);
    return output;
  }
  throw new Error("只支持 PostgreSQL 或 SQLite 备份");
}

async function encryptDump(source, directory) {
  const encrypted = join(directory, `${basename(source)}.aes`);
  await exec("openssl", [
    "enc", "-aes-256-cbc", "-salt", "-pbkdf2", "-iter", "200000",
    "-in", source, "-out", encrypted, "-pass", "env:BACKUP_ENCRYPTION_PASSWORD",
  ], { env: { ...process.env, BACKUP_ENCRYPTION_PASSWORD: required("BACKUP_ENCRYPTION_PASSWORD") } });
  return encrypted;
}

async function checksum(path) {
  const hash = createHash("sha256");
  const file = await open(path, "r");
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    for (;;) {
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    await file.close();
  }
  return hash.digest("hex");
}

async function sendParts(path, sha256) {
  const token = required("TELEGRAM_BOT_TOKEN");
  const chatId = required("TELEGRAM_BOSS_CHAT_ID");
  const { size } = await stat(path);
  const total = Math.max(1, Math.ceil(size / PART_BYTES));
  const file = await open(path, "r");
  try {
    for (let index = 0; index < total; index += 1) {
      const offset = index * PART_BYTES;
      const bytes = Math.min(PART_BYTES, size - offset);
      const buffer = Buffer.alloc(bytes);
      await file.read(buffer, 0, bytes, offset);
      const filename = total === 1 ? basename(path) : `${basename(path)}.part${String(index + 1).padStart(3, "0")}`;
      const form = new FormData();
      form.set("chat_id", chatId);
      form.set("document", new Blob([buffer]), filename);
      form.set("caption", `每日加密数据备份 ${index + 1}/${total}\nSHA-256: ${sha256}`);
      const response = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(180_000),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.description || `备份发送失败（HTTP ${response.status}）`);
    }
  } finally {
    await file.close();
  }
}

const directory = await mkdtemp(join(tmpdir(), "boss-backup-"));
try {
  const dump = await createDatabaseDump(directory);
  const encrypted = await encryptDump(dump, directory);
  const sha256 = await checksum(encrypted);
  await sendParts(encrypted, sha256);
  process.stdout.write(JSON.stringify({ sent: true, sha256 }) + "\n");
} finally {
  await rm(directory, { recursive: true, force: true });
}
