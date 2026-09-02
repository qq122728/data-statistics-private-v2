import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ error: "资源部渠道审核收件箱已停用" }, { status: 410 });
}
