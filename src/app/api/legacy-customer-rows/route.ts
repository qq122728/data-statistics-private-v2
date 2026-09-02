import { NextResponse } from "next/server";
import { AuthenticationError, requireUser } from "../../../lib/auth";

async function retiredResponse() {
  try {
    await requireUser();
  } catch (error) {
    if (error instanceof AuthenticationError)
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    throw error;
  }
  return NextResponse.json(
    { error: "旧老客户自由表已停用，请使用客户协作进度中的老客户导入或新增专家客户" },
    { status: 410 },
  );
}

export async function GET() {
  return retiredResponse();
}

export async function POST() {
  return retiredResponse();
}
