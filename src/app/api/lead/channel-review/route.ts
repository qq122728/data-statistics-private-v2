import { NextResponse } from "next/server";

function gone() {
  return NextResponse.json({ error: "渠道送审流程已停用，请直接查看渠道数据汇总" }, { status: 410 });
}

export async function GET() {
  return gone();
}

export async function POST(_request: Request) {
  return gone();
}
