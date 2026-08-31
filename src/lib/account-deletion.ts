import { Prisma } from "@prisma/client";
import { recordAudit } from "./audit";
import { db } from "./db";

export type DeleteEmptyAccountResult =
  | { deleted: true }
  | { deleted: false; error: string; status: 404 | 409 };

/**
 * 只永久删除尚未产生业务引用的误开账号。数据库外键是最后一道保险：任何客户、日报、
 * 资金、设备、通知、审核或本人操作日志都会让删除失败。登录会话属于临时访问凭证，
 * 不算业务历史，因此在同一事务里先清理；若后续删除失败，事务会连会话清理一起回滚。
 */
export async function deleteEmptyAccount(input: {
  actorId: string;
  targetId: string;
  targetName: string;
}): Promise<DeleteEmptyAccountResult> {
  try {
    return await db.$transaction(async (tx) => {
      const target = await tx.user.findUnique({ where: { id: input.targetId }, select: { id: true } });
      if (!target) return { deleted: false, error: "账号不存在", status: 404 as const };
      await tx.session.deleteMany({ where: { userId: input.targetId } });
      await tx.user.delete({ where: { id: input.targetId } });
      await recordAudit(tx, {
        actorId: input.actorId,
        action: "ACCOUNT_DELETED",
        entityType: "User",
        entityId: input.targetId,
        summary: { name: input.targetName, reason: "误开空账号永久删除" },
      });
      return { deleted: true as const };
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      return { deleted: false, error: "该账号已经产生业务或操作记录，不能永久删除；请改为停用账号", status: 409 };
    }
    throw error;
  }
}
