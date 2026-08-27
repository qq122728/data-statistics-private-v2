import { NextResponse } from "next/server";
import { AuthenticationError, requireUser } from "../../../../lib/auth";
import { authorizationDenied } from "../../../../lib/security-events";

/**
 * 历史客户只允许从专家管理统一录入。
 *
 * 旧地址保留为明确的拒绝响应，避免仍停留在旧版页面的浏览器或脚本误以为
 * 可以继续由炒群员建档。
 */
export async function POST() {
  let actor;
  try {
    actor = await requireUser();
  } catch (error) {
    if (error instanceof AuthenticationError)
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    throw error;
  }

  return authorizationDenied(actor, "历史客户请由专家或组长在“专家管理”中统一录入");
}
