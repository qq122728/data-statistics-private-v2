import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthenticationError, requireUser } from "../../../../lib/auth";
import { readLimitedJson, RequestBodyTooLargeError, tooLargeResponse } from "../../../../lib/request-limits";

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(1_000),
}).strict();

const inputSchema = z.object({
  messages: z.array(messageSchema).min(1).max(12),
}).strict().superRefine((value, context) => {
  const total = value.messages.reduce((sum, message) => sum + message.content.length, 0);
  if (total > 6_000) context.addIssue({ code: "custom", path: ["messages"], message: "对话内容过长，请简化后再发送" });
});

const READ_ONLY_SYSTEM_PROMPT = [
  "你是员工网页里的中文 AI 助手，可以进行日常闲聊、解释概念、帮助组织文字和回答一般问题。",
  "当前是严格只读闲聊模式。你没有数据库、客户表、账号、文件、网络工具或任何写入工具。",
  "不得声称已经查询、修改、新增、删除、保存或纠正了任何业务数据。",
  "如果用户要求查询真实数据，或修改、新增、删除、纠正数据，请明确说明闲聊不会执行，并请用户返回 AI 助手的正式业务入口操作。",
  "不要索要客户完整手机号、密码、API 密钥或其他敏感信息。",
  "回答尽量简短、自然、好理解。",
].join("\n");

export async function POST(request: Request) {
  try {
    await requireUser();
  } catch (error) {
    if (error instanceof AuthenticationError) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    throw error;
  }

  try {
    const input = inputSchema.parse(await readLimitedJson(request, 16 * 1024));
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "AI 闲聊尚未配置" }, { status: 503 });
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
        temperature: 0.7,
        thinking: { type: "disabled" },
        max_tokens: 800,
        stream: false,
        messages: [{ role: "system", content: READ_ONLY_SYSTEM_PROMPT }, ...input.messages],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) return NextResponse.json({ error: `AI 闲聊暂时不可用（HTTP ${response.status}）` }, { status: 502 });
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string | null } }> };
    const reply = payload.choices?.[0]?.message?.content?.trim();
    if (!reply) return NextResponse.json({ error: "AI 没有返回内容" }, { status: 502 });
    return NextResponse.json({ reply: reply.slice(0, 4_000), mode: "READ_ONLY_CHAT" });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return tooLargeResponse(error);
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message ?? "对话内容不正确" }, { status: 400 });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "对话内容不是有效 JSON" }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error && error.name === "TimeoutError" ? "AI 回复超时，请稍后重试" : "AI 闲聊暂时不可用" }, { status: 502 });
  }
}
