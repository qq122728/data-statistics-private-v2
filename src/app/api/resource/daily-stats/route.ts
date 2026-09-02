import { NextResponse } from "next/server";

function gone() {
  return NextResponse.json({ error: "资源部日报审批已停用，员工保存后直接进入正式统计" }, { status: 410 });
}

export async function GET() {
  return gone();
}

export async function PATCH(_request: Request) {
  return gone();
}
