import { NextResponse } from "next/server";
import { AuthenticationError, requireUser } from "../../../../lib/auth";

export async function PATCH(
  _request: Request,
  _context: { params: Promise<{ rowId: string }> },
) {
  try {
    await requireUser();
  } catch (error) {
    if (error instanceof AuthenticationError)
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    throw error;
  }
  return NextResponse.json(
    { error: "旧老客户自由表已停用，请在客户协作进度中维护客户" },
    { status: 410 },
  );
}
