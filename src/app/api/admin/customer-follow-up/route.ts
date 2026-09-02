import { NextResponse } from "next/server";
import { requireAdminRequest } from "../_auth";

/**
 * 旧管理员客户跟进写入口已经与“管理账号只读”规则冲突。
 * 保留 410 响应一段时间，避免旧客户端把失败误判成保存成功。
 */
export async function PATCH(request: Request) {
  const access = await requireAdminRequest();
  if ("response" in access) return access.response;
  void request;
  return NextResponse.json(
    { error: "管理员客户跟进写入接口已停用；客户进度由实际负责人维护" },
    { status: 410 },
  );
}
