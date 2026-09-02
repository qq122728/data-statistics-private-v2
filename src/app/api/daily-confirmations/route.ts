import { NextResponse } from "next/server";

function gone() {
  return NextResponse.json({ error: "每日数据确认流程已停用，员工保存后直接进入正式统计" }, { status: 410 });
}

export async function GET(_request: Request) {
  return gone();
}

export async function POST(_request: Request) {
  return gone();
}
