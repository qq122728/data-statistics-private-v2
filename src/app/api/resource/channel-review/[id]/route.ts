import { NextResponse } from "next/server";

export async function POST(_request: Request, _context: { params: Promise<{ id: string }> }) {
  return NextResponse.json({ error: "资源部渠道确认与异议流程已停用" }, { status: 410 });
}
