import { afterEach, describe, expect, it, vi } from "vitest";
import * as auth from "../../src/lib/auth";
import { POST } from "../../src/app/api/ai/chat/route";

const originalKey = process.env.DEEPSEEK_API_KEY;

afterEach(() => {
  vi.restoreAllMocks();
  if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = originalKey;
});

describe("AI 只读闲聊", () => {
  it("要求登录且不会在未配置时假装回复", async () => {
    vi.spyOn(auth, "requireUser").mockRejectedValue(new auth.AuthenticationError());
    expect((await POST(new Request("http://localhost/api/ai/chat", { method: "POST", body: "{}" }))).status).toBe(401);

    vi.restoreAllMocks();
    vi.spyOn(auth, "requireUser").mockResolvedValue({ id: "member" } as never);
    delete process.env.DEEPSEEK_API_KEY;
    const response = await POST(new Request("http://localhost/api/ai/chat", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: "你好" }] }),
    }));
    expect(response.status).toBe(503);
  });

  it("只把对话交给无工具的只读模型", async () => {
    vi.spyOn(auth, "requireUser").mockResolvedValue({ id: "member" } as never);
    process.env.DEEPSEEK_API_KEY = "test-only-key";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "可以聊天，但我不会修改数据。" } }],
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const response = await POST(new Request("http://localhost/api/ai/chat", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: "帮我把客户删了" }] }),
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ reply: "可以聊天，但我不会修改数据。", mode: "READ_ONLY_CHAT" });

    const upstream = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(upstream.tools).toBeUndefined();
    expect(upstream.messages[0].content).toContain("严格只读闲聊模式");
    expect(upstream.messages[0].content).toContain("不得声称已经查询、修改、新增、删除、保存或纠正");
  });
});
