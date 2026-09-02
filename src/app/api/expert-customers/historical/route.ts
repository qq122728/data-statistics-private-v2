import { NextResponse } from "next/server";
import { AuthenticationError, requireUser } from "../../../../lib/auth";

/** 已由统一客户协作表的“新增专家客户”替代，保留 410 防止旧客户端继续写。 */
export async function POST(_request: Request) {
  let actor;
  try {
    actor = await requireUser();
  } catch (error) {
    if (error instanceof AuthenticationError)
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    throw error;
  }
  void actor;
  return NextResponse.json(
    { error: "旧专家历史补录接口已停用，请使用客户协作进度中的“新增专家客户”" },
    { status: 410 },
  );
}
