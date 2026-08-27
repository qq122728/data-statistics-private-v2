export const INITIAL_USERNAME_MAX_LENGTH = 200;
export const INITIAL_PASSWORD_MIN_LENGTH = 12;
export const INITIAL_PASSWORD_MAX_LENGTH = 256;

export function validateInitialPasswordEntries(entries) {
  if (!Array.isArray(entries) || !entries.length) {
    throw new Error("密码文件中至少需要一组账号和 12 位以上的新密码。");
  }

  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length !== 2) {
      throw new Error("密码条目格式不正确，已拒绝整批轮换。");
    }
    const [username, password] = entry;
    if (typeof username !== "string" || !username.trim()) {
      throw new Error("密码文件中存在空账号名，已拒绝整批轮换。");
    }
    if (username.length > INITIAL_USERNAME_MAX_LENGTH) {
      throw new Error(`账号名 ${JSON.stringify(username)} 超过 ${INITIAL_USERNAME_MAX_LENGTH} 位，已拒绝整批轮换。`);
    }
    if (typeof password !== "string") {
      throw new Error(`账号 ${JSON.stringify(username)} 的密码必须是字符串，已拒绝整批轮换。`);
    }
    if (password.length < INITIAL_PASSWORD_MIN_LENGTH) {
      throw new Error(`账号 ${JSON.stringify(username)} 的密码少于 ${INITIAL_PASSWORD_MIN_LENGTH} 位，已拒绝整批轮换。`);
    }
    if (password.length > INITIAL_PASSWORD_MAX_LENGTH) {
      throw new Error(`账号 ${JSON.stringify(username)} 的密码超过 ${INITIAL_PASSWORD_MAX_LENGTH} 位，已拒绝整批轮换。`);
    }
  }

  if (!entries.some(([username]) => username === "admin")) {
    throw new Error("安全要求：密码文件必须包含 admin 账号，避免只轮换普通账号却遗留管理员默认密码。");
  }
  return entries;
}

export function parseInitialPasswordEntries(contents) {
  let passwords;
  try {
    passwords = JSON.parse(contents);
  } catch {
    throw new Error("密码文件必须是有效的 JSON 对象。");
  }

  if (!passwords || typeof passwords !== "object" || Array.isArray(passwords)) {
    throw new Error("密码文件必须是 JSON 对象，例如 {\"admin\":\"新的高强度密码\"}。");
  }

  return validateInitialPasswordEntries(Object.entries(passwords));
}

export async function rotateInitialAccountPasswords(db, existing, entries, hashPassword) {
  validateInitialPasswordEntries(entries);
  await db.$transaction(async (client) => {
    for (const [username, password] of entries) {
      const user = existing.find((item) => item.username === username);
      if (!user) throw new Error(`未找到账号：${username}。为避免误操作，未修改任何账号。`);
      await client.user.update({
        where: { id: user.id },
        data: {
          passwordHash: hashPassword(password),
          mustChangePassword: true,
        },
      });
      await client.session.deleteMany({ where: { userId: user.id } });
    }
  });
}
