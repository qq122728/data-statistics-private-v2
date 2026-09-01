import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthenticationError, requireUser } from "../../../../lib/auth";
import { interpretWithServerModel } from "../../../../lib/ai-assistant/interpret";
import { statisticsDate } from "../../../../lib/statistics-date";

const inputSchema = z.object({ message: z.string().trim().min(1).max(1000) }).strict();

export async function POST(request: Request) {
  try {
    const actor = await requireUser();
    if (!actor.groupId) return NextResponse.json({ error: "当前账号没有绑定小组" }, { status: 403 });
    const input = inputSchema.safeParse(await request.json().catch(() => null));
    if (!input.success) return NextResponse.json({ error: "请输入要填写、查询或纠正的内容" }, { status: 400 });
    const intent = await interpretWithServerModel(input.data.message, { today: statisticsDate() });
    if (!intent) return NextResponse.json({ configured: false, intent: null });
    return NextResponse.json({ configured: true, intent });
  } catch (error) {
    if (error instanceof AuthenticationError) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    console.error("AI assistant interpretation failed", error);
    return NextResponse.json({ error: "AI暂时没有理解这句话，请换一种简单说法" }, { status: 502 });
  }
}
