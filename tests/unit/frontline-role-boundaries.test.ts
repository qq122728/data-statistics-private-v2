import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as auth from "../../src/lib/auth";
import { db } from "../../src/lib/db";
import { GET as getHistory } from "../../src/app/api/history/route";
import { POST as importLeads } from "../../src/app/api/leads/route";
import { POST as addHistoricalGroupCustomer } from "../../src/app/api/group-customers/historical/route";
import { POST as addHistoricalExpertCustomer } from "../../src/app/api/expert-customers/historical/route";
import { loadCanonicalMetricEvents } from "../../src/lib/analytics/canonical-events";
import {
  DELETE as deleteLead,
  PATCH as updateLead,
} from "../../src/app/api/leads/[leadId]/route";
import { GET as getDownstreamProgress } from "../../src/app/api/leads/[leadId]/downstream-progress/route";
import { PATCH as voidFinance } from "../../src/app/api/customer-finance/[eventId]/route";
import { POST as createFinance } from "../../src/app/api/customer-finance/route";
import { POST as createOrder } from "../../src/app/api/customer-orders/route";

const isolatedDatabase = vi.hoisted(() => ({ directory: "", databaseUrl: "" }));

vi.mock("../../src/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const { execFileSync } = await import("node:child_process");
  const { closeSync, mkdtempSync, openSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = mkdtempSync(join(tmpdir(), "frontline-boundaries-"));
  const databasePath = join(directory, "test.db");
  closeSync(openSync(databasePath, "w"));
  const databaseUrl = `file:${databasePath}`;
  execFileSync(
    process.execPath,
    [join(process.cwd(), "node_modules/prisma/build/index.js"), "migrate", "deploy"],
    { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: databaseUrl } },
  );
  isolatedDatabase.directory = directory;
  isolatedDatabase.databaseUrl = databaseUrl;
  return {
    db: new PrismaClient({ datasourceUrl: databaseUrl }),
    getOrCreateSourceBatch: (
      key: { groupId: string; channelId: string; sourceDate: string },
      client: InstanceType<typeof PrismaClient>,
    ) => client.sourceBatch.upsert({
      where: { groupId_channelId_sourceDate: key },
      update: {},
      create: key,
    }),
  };
});

const suffix = randomUUID();
const ids = {
  groupA: `boundary-group-a-${suffix}`,
  groupB: `boundary-group-b-${suffix}`,
  channelA: `boundary-channel-a-${suffix}`,
  channelB: `boundary-channel-b-${suffix}`,
  receptionA: `boundary-reception-a-${suffix}`,
  receptionB: `boundary-reception-b-${suffix}`,
  admin: `boundary-admin-${suffix}`,
  leadA: `boundary-lead-a-${suffix}`,
  groupOperatorA: `boundary-group-operator-a-${suffix}`,
  expertA: `boundary-expert-a-${suffix}`,
  expertB: `boundary-expert-b-${suffix}`,
  groupOperatorAccount: `boundary-group-account-${suffix}`,
  expertAccount: `boundary-expert-account-${suffix}`,
  receptionDevice: `boundary-reception-device-${suffix}`,
  leadCustomerA: "",
  leadCustomerB: "",
  leadCustomerC: "",
};

beforeAll(async () => {
  await db.teamGroup.createMany({
    data: [
      { id: ids.groupA, name: "权限一组" },
      { id: ids.groupB, name: "权限二组" },
    ],
  });
  await db.channel.createMany({
    data: [
      {
        id: ids.channelA,
        groupId: ids.groupA,
        name: "权限渠道一",
        normalizedName: "权限渠道一",
      },
      {
        id: ids.channelB,
        groupId: ids.groupB,
        name: "权限渠道二",
        normalizedName: "权限渠道二",
      },
    ],
  });
  await db.user.createMany({
    data: [
      { id: ids.receptionA, username: ids.receptionA, name: "接粉一", role: "RECEPTION", groupId: ids.groupA },
      { id: ids.receptionB, username: ids.receptionB, name: "接粉二", role: "RECEPTION", groupId: ids.groupB },
      { id: ids.admin, username: ids.admin, name: "管理员", role: "ADMIN" },
      { id: ids.leadA, username: ids.leadA, name: "组长一", role: "LEAD", groupId: ids.groupA },
      { id: ids.groupOperatorA, username: ids.groupOperatorA, name: "炒群一", role: "GROUP_OPERATOR", groupId: ids.groupA },
      { id: ids.expertA, username: ids.expertA, name: "专家一", role: "EXPERT", groupId: ids.groupA },
      { id: ids.expertB, username: ids.expertB, name: "专家二", role: "EXPERT", groupId: ids.groupA },
    ],
  });
  await db.deviceAccount.createMany({
    data: [
      { id: ids.groupOperatorAccount, groupId: ids.groupA, ownerId: ids.groupOperatorA, accountType: "NORMAL_WS", provider: "WhatsApp", accountNumber: `group-${suffix}` },
      { id: ids.expertAccount, groupId: ids.groupA, ownerId: ids.expertA, accountType: "NORMAL_WS", provider: "WhatsApp", accountNumber: `expert-${suffix}` },
    ],
  });
  await db.device.create({
    data: {
      id: ids.receptionDevice,
      groupId: ids.groupA,
      memberId: ids.receptionA,
      code: `接粉设备-${suffix}`,
    },
  });
  const [batchA, batchB] = await Promise.all([
    db.sourceBatch.create({ data: { groupId: ids.groupA, channelId: ids.channelA, sourceDate: "2026-08-14" } }),
    db.sourceBatch.create({ data: { groupId: ids.groupB, channelId: ids.channelB, sourceDate: "2026-08-14" } }),
  ]);
  const [leadA, leadB, leadC] = await Promise.all([
    db.leadCustomer.create({ data: { phone: "13800000001", customerName: "甲组已有客户", batchId: batchA.id, ownerId: ids.receptionA } }),
    db.leadCustomer.create({ data: { phone: "13800000002", customerName: "乙组机密客户", batchId: batchB.id, ownerId: ids.receptionB } }),
    db.leadCustomer.create({ data: { phone: "13800000003", batchId: batchA.id, ownerId: ids.receptionA, groupStatus: "JOINED", joinedOn: "2026-08-14" } }),
  ]);
  ids.leadCustomerA = leadA.id;
  ids.leadCustomerB = leadB.id;
  ids.leadCustomerC = leadC.id;
});

afterAll(async () => {
  vi.restoreAllMocks();
  await db.$disconnect();
  if (isolatedDatabase.directory) {
    const { rm } = await import("node:fs/promises");
    await rm(isolatedDatabase.directory, { recursive: true, force: true });
  }
});

async function signInAs(id: string) {
  vi.spyOn(auth, "requireUser").mockResolvedValue(
    await db.user.findUniqueOrThrow({ where: { id } }),
  );
}

const leadContext = (leadId: string) => ({ params: Promise.resolve({ leadId }) });

function historicalExpertRequest(phone: string) {
  return new Request("http://localhost/api/expert-customers/historical", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      phone,
      customerName: "待补录客户",
      receptionOwnerId: ids.receptionA,
      groupOperatorOwnerId: ids.groupOperatorA,
      expertOwnerId: ids.expertA,
      contactedOn: "2026-08-11",
      joinedOn: "2026-08-12",
      expertIntroducedOn: "2026-08-13",
      expertStage: "MATERIALS",
      stageChangedOn: "2026-08-14",
    }),
  });
}

describe.sequential("frontline role boundaries", () => {
  it.each(["groupOperatorA", "expertA"] as const)(
    "blocks %s from the generic customer write and delete endpoints",
    async (actorKey) => {
      await signInAs(ids[actorKey]);
      const update = await updateLead(
        new Request("http://localhost/api/leads/target", {
          method: "PATCH",
          body: JSON.stringify({ action: "note", notes: "越权内容" }),
        }),
        leadContext(ids.leadCustomerB),
      );
      const remove = await deleteLead(
        new Request("http://localhost/api/leads/target", { method: "DELETE" }),
        leadContext(ids.leadCustomerB),
      );
      expect(update.status).toBe(403);
      expect(remove.status).toBe(403);
      await expect(
        db.leadCustomer.findUniqueOrThrow({ where: { id: ids.leadCustomerB } }),
      ).resolves.toMatchObject({ notes: null });
    },
  );

  it("does not let a group operator who also receives customers delete another receptionist's untouched customer", async () => {
    const sourceLead = await db.leadCustomer.findUniqueOrThrow({
      where: { id: ids.leadCustomerA },
      select: { batchId: true },
    });
    const transientLead = await db.leadCustomer.create({
      data: {
        phone: `136${String(Date.now()).slice(-8)}`,
        batchId: sourceLead.batchId,
        ownerId: ids.receptionA,
      },
    });
    await db.userRoleAssignment.create({
      data: { userId: ids.groupOperatorA, role: "RECEPTION" },
    });

    try {
      vi.restoreAllMocks();
      vi.spyOn(auth, "requireUser").mockResolvedValue(
        await db.user.findUniqueOrThrow({
          where: { id: ids.groupOperatorA },
          include: { roleAssignments: { select: { role: true } } },
        }),
      );

      const response = await deleteLead(
        new Request("http://localhost/api/leads/target", { method: "DELETE" }),
        leadContext(transientLead.id),
      );

      expect(response.status).toBe(403);
      await expect(db.leadCustomer.findUnique({ where: { id: transientLead.id } })).resolves.not.toBeNull();
    } finally {
      await db.userRoleAssignment.deleteMany({
        where: { userId: ids.groupOperatorA, role: "RECEPTION" },
      });
      await db.leadCustomer.deleteMany({ where: { id: transientLead.id } });
    }
  });

  it("lets a dual frontline account follow its own in-group customer without a manual collaboration assignment", async () => {
    const sourceLead = await db.leadCustomer.findUniqueOrThrow({
      where: { id: ids.leadCustomerA },
      select: { batchId: true },
    });
    const ownLead = await db.leadCustomer.create({
      data: {
        phone: `137${String(Date.now()).slice(-8)}`,
        batchId: sourceLead.batchId,
        ownerId: ids.groupOperatorA,
        groupStatus: "JOINED",
        joinedOn: "2026-08-14",
      },
    });
    await db.userRoleAssignment.create({
      data: { userId: ids.groupOperatorA, role: "RECEPTION" },
    });

    try {
      vi.restoreAllMocks();
      vi.spyOn(auth, "requireUser").mockResolvedValue(
        await db.user.findUniqueOrThrow({
          where: { id: ids.groupOperatorA },
          include: { roleAssignments: { select: { role: true } } },
        }),
      );

      const response = await updateLead(
        new Request("http://localhost/api/leads/target", {
          method: "PATCH",
          body: JSON.stringify({ action: "updateGroupProgress", occurredOn: "2026-08-14", progressNote: "本人接粉后已在群内跟进" }),
        }),
        leadContext(ownLead.id),
      );

      expect(response.status).toBe(200);
    } finally {
      await db.userRoleAssignment.deleteMany({
        where: { userId: ids.groupOperatorA, role: "RECEPTION" },
      });
      await db.leadCustomer.deleteMany({ where: { id: ownLead.id } });
    }
  });

  it("blocks group operators from creating historical customers", async () => {
    vi.restoreAllMocks();
    vi.spyOn(auth, "requireUser").mockResolvedValue(
      await db.user.findUniqueOrThrow({
        where: { id: ids.groupOperatorA },
        include: { roleAssignments: { select: { role: true } } },
      }),
    );

    const response = await addHistoricalGroupCustomer();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "历史客户请由专家或组长在“专家管理”中统一录入" });
  });

  it("returns 401 when an unauthenticated user tries to import a historical expert customer", async () => {
    vi.restoreAllMocks();
    vi.spyOn(auth, "requireUser").mockRejectedValue(new auth.AuthenticationError());

    const response = await addHistoricalExpertCustomer(historicalExpertRequest("13900000001"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "请先登录" });
  });

  it.each([
    ["ordinary user", ids.receptionA],
    ["administrator", ids.admin],
  ])("returns 403 when an authenticated %s lacks the assigned role", async (_label, userId) => {
    vi.restoreAllMocks();
    await signInAs(userId);

    const response = await addHistoricalExpertCustomer(historicalExpertRequest("13900000002"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "只有组长或专家可以补录历史专家客户" });
  });

  it("shows necessary duplicate details only for a customer in the actor's own group", async () => {
    vi.restoreAllMocks();
    await signInAs(ids.expertA);

    const response = await addHistoricalExpertCustomer(historicalExpertRequest("13800000001"));
    const payload = await response.json() as { error: string };

    expect(response.status).toBe(409);
    expect(payload.error).toContain("本组客户库");
    expect(payload.error).toContain("甲组已有客户");
  });

  it("does not expose another group's customer details in the response or audit log", async () => {
    vi.restoreAllMocks();
    await signInAs(ids.expertA);
    const auditCountBefore = await db.auditLog.count();

    const response = await addHistoricalExpertCustomer(historicalExpertRequest("13800000002"));
    const payload = await response.json() as { error: string };

    expect(response.status).toBe(409);
    expect(payload).toEqual({ error: "该手机号已存在" });
    expect(JSON.stringify(payload)).not.toContain("乙组机密客户");
    expect(JSON.stringify(payload)).not.toContain(ids.leadCustomerB);
    expect(JSON.stringify(payload)).not.toContain(ids.groupB);
    await expect(db.auditLog.count()).resolves.toBe(auditCountBefore);
  });

  it("lets an expert import a historical ordered customer with separate reception and group ownership, and blocks duplicates", async () => {
    vi.restoreAllMocks();
    vi.spyOn(auth, "requireUser").mockResolvedValue(
      await db.user.findUniqueOrThrow({
        where: { id: ids.expertA },
        include: { roleAssignments: { select: { role: true } } },
      }),
    );
    const phone = `132${String(Date.now()).slice(-8)}`;
    const request = () => new Request("http://localhost/api/expert-customers/historical", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        phone,
        customerName: "专家历史已开单客户",
        historicalSourceName: "旧投流台账",
        // 历史归属按当时实际人员填写，不能被今天的岗位限制；两人可兼任或已换岗。
        receptionOwnerId: ids.groupOperatorA,
        groupOperatorOwnerId: ids.receptionA,
        expertOwnerId: ids.expertB,
        contactedOn: "2026-08-11",
        joinedOn: "2026-08-12",
        expertIntroducedOn: "2026-08-13",
        expertStage: "ORDERED",
        stageChangedOn: "2026-08-15",
        registeredOn: "2026-08-14",
        openedOn: "2026-08-15",
        initialDepositCents: 75_000,
        initialDepositMethod: "CRYPTO",
        notes: "专家补录历史首充",
      }),
    });

    const response = await addHistoricalExpertCustomer(request());
    expect(response.status).toBe(201);
    const payload = await response.json() as { leadId: string; orderId: string };
    await expect(db.leadCustomer.findUniqueOrThrow({ where: { id: payload.leadId }, include: { customerOrder: true, batch: true } })).resolves.toMatchObject({
      ownerId: ids.groupOperatorA,
      attributionOwnerId: ids.groupOperatorA,
      groupOperatorOwnerId: ids.receptionA,
      expertOwnerId: ids.expertB,
      expertWorkflowStage: "ORDERED",
      isHistoricalRecord: true,
      customerOrder: { initialDepositCents: 75_000, openedOn: "2026-08-15" },
      batch: { isHistoricalRecord: true },
    });
    const facts = await loadCanonicalMetricEvents({
      groupIds: [ids.groupA],
      sourceDateFrom: "2026-08-01",
      sourceDateTo: "2026-08-23",
      occurredOnTo: "2026-08-23",
    });
    const historicalFacts = facts.filter((fact) => fact.id.startsWith(`${payload.leadId}:`));
    expect(historicalFacts.map((fact) => fact.kind).sort()).toEqual(["ORDER", "RECHARGE"]);
    await expect(addHistoricalExpertCustomer(request())).resolves.toMatchObject({ status: 409 });
  });

  it("lets a group lead use the same historical-expert entry and assign an in-group expert", async () => {
    vi.restoreAllMocks();
    vi.spyOn(auth, "requireUser").mockResolvedValue(
      await db.user.findUniqueOrThrow({
        where: { id: ids.leadA },
        include: { roleAssignments: { select: { role: true } } },
      }),
    );
    const response = await addHistoricalExpertCustomer(
      new Request("http://localhost/api/expert-customers/historical", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          phone: `131${String(Date.now()).slice(-8)}`,
          customerName: "组长补录客户",
          historicalSourceName: "核对旧表",
          receptionOwnerId: ids.receptionA,
          groupOperatorOwnerId: ids.groupOperatorA,
          expertOwnerId: ids.expertA,
          contactedOn: "2026-08-11",
          joinedOn: "2026-08-12",
          expertIntroducedOn: "2026-08-13",
          expertStage: "MATERIALS",
          stageChangedOn: "2026-08-14",
          notes: "由组长统一补录",
        }),
      }),
    );

    expect(response.status).toBe(201);
    const payload = await response.json() as { leadId: string };
    await expect(db.leadCustomer.findUniqueOrThrow({ where: { id: payload.leadId } })).resolves.toMatchObject({
      expertOwnerId: ids.expertA,
      isHistoricalRecord: true,
    });
  });

  it("does not create a customer for a collision across different groups", async () => {
    await signInAs(ids.receptionA);
    const response = await importLeads(
      new Request("http://localhost/api/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceDate: "2026-08-16",
          channelId: ids.channelA,
          phones: "13800000002",
        }),
      }),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "没有可导入的有效客户；撞粉、低金额、无 WS 号码请在下方“扣粉登记”手动填写数量",
    });
    await expect(db.leadCustomer.count({ where: { phone: "13800000002" } })).resolves.toBe(1);
  });

  it("imports a customer row with its profile and a selected reception device", async () => {
    await signInAs(ids.receptionA);
    const phone = `139${String(Date.now()).slice(-8)}`;
    const response = await importLeads(
      new Request("http://localhost/api/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceDate: "2026-08-16",
          channelId: ids.channelA,
          rows: [{
            phone,
            customerName: "导入客户",
            deviceId: ids.receptionDevice,
            lossAmountCents: 500000,
            customerPlatform: "MT5",
            notes: "导入时已填写资料",
          }],
        }),
      }),
    );

    expect(response.status).toBe(201);
    await expect(db.leadCustomer.findUniqueOrThrow({ where: { phone } })).resolves.toMatchObject({
      ownerId: ids.receptionA,
      deviceId: ids.receptionDevice,
      customerName: "导入客户",
      lossAmountCents: 500000,
      customerPlatform: "MT5",
      notes: "导入时已填写资料",
    });
  });

  it("keeps the intake operator separate from the selected fan attribution owner", async () => {
    await db.userRoleAssignment.create({
      data: { userId: ids.groupOperatorA, role: "RECEPTION" },
    });
    try {
      vi.restoreAllMocks();
      vi.spyOn(auth, "requireUser").mockResolvedValue(
        await db.user.findUniqueOrThrow({
          where: { id: ids.groupOperatorA },
          include: { roleAssignments: { select: { role: true } } },
        }),
      );
      const phone = `136${String(Date.now()).slice(-8)}`;
      const response = await importLeads(
        new Request("http://localhost/api/leads", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sourceDate: "2026-08-16",
            channelId: ids.channelA,
            rows: [{ phone, attributionOwnerId: ids.expertA }],
          }),
        }),
      );

      expect(response.status).toBe(201);
      const lead = await db.leadCustomer.findUniqueOrThrow({ where: { phone } });
      expect(lead).toMatchObject({
        ownerId: ids.groupOperatorA,
        attributionOwnerId: ids.expertA,
      });
      await expect(db.metricEvent.findMany({
        where: { batchId: lead.batchId, kind: { in: ["NEW_FANS", "EFFECTIVE_FANS"] }, voidedAt: null },
        select: { enteredById: true, kind: true },
      })).resolves.toEqual(expect.arrayContaining([
        { enteredById: ids.expertA, kind: "NEW_FANS" },
        { enteredById: ids.expertA, kind: "EFFECTIVE_FANS" },
      ]));
    } finally {
      await db.userRoleAssignment.deleteMany({
        where: { userId: ids.groupOperatorA, role: "RECEPTION" },
      });
    }
  });

  it("does not create a customer below $5,000 and requires the manual invalid report", async () => {
    await signInAs(ids.receptionA);
    const phone = `137${String(Date.now()).slice(-8)}`;
    const response = await importLeads(
      new Request("http://localhost/api/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceDate: "2026-08-16",
          channelId: ids.channelA,
          rows: [{ phone, lossAmountCents: 499_999 }],
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(db.leadCustomer.findUnique({ where: { phone } })).resolves.toBeNull();
  });

  it("imports one valid customer for repeated rows and leaves the collision count for manual reporting", async () => {
    await signInAs(ids.receptionA);
    const phone = `135${String(Date.now()).slice(-8)}`;
    const response = await importLeads(
      new Request("http://localhost/api/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceDate: "2026-08-17",
          channelId: ids.channelA,
          rows: [{ phone }, { phone }, { phone }],
        }),
      }),
    );
    expect(response.status).toBe(201);
    await expect(db.leadCustomer.findUnique({ where: { phone } })).resolves.toMatchObject({ phone });
    await expect(db.leadException.count({ where: { phone, kind: "DUPLICATE_IN_PASTE" } })).resolves.toBe(0);
  });

  it("removes an untouched mistaken entry and reverses its import statistics", async () => {
    await signInAs(ids.receptionA);
    const phone = `136${String(Date.now()).slice(-8)}`;
    const imported = await importLeads(
      new Request("http://localhost/api/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceDate: "2026-08-18",
          channelId: ids.channelA,
          rows: [{ phone, customerName: "误录客户" }],
        }),
      }),
    );
    expect(imported.status).toBe(201);
    const payload = await imported.json() as { batch: { id: string } };
    const lead = await db.leadCustomer.findUniqueOrThrow({ where: { phone } });

    expect((await deleteLead(new Request("http://localhost/api/leads/target", { method: "DELETE" }), leadContext(lead.id))).status).toBe(200);
    await expect(db.leadCustomer.findUnique({ where: { id: lead.id } })).resolves.toBeNull();
    const corrections = await db.metricEvent.findMany({
      where: { batchId: payload.batch.id, enteredById: ids.receptionA, derivedFromLedger: true, kind: { in: ["NEW_FANS", "EFFECTIVE_FANS"] } },
      select: { kind: true, quantity: true },
    });
    expect(corrections.filter((event) => event.kind === "NEW_FANS").reduce((sum, event) => sum + (event.quantity ?? 0), 0)).toBe(0);
    expect(corrections.filter((event) => event.kind === "EFFECTIVE_FANS").reduce((sum, event) => sum + (event.quantity ?? 0), 0)).toBe(0);
    await expect(db.auditLog.findFirst({ where: { entityId: lead.id, action: "LEAD_ENTRY_DELETED" } })).resolves.toMatchObject({ actorId: ids.receptionA });
  });

  it("does not allow a low-amount row to enter the customer library", async () => {
    await signInAs(ids.receptionA);
    const phone = `139${String(Date.now()).slice(-8)}`;
    const imported = await importLeads(
      new Request("http://localhost/api/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceDate: "2026-08-18",
          channelId: ids.channelA,
          rows: [{ phone, customerName: "错误导入的低金额", lossAmountCents: 120_000 }],
        }),
      }),
    );
    expect(imported.status).toBe(400);
    await expect(db.leadCustomer.findUnique({ where: { phone } })).resolves.toBeNull();
  });

  it("also blocks editing a customer to a phone owned by another company or group", async () => {
    await signInAs(ids.receptionA);
    const response = await updateLead(
      new Request("http://localhost/api/leads/target", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "updatePhone", phone: "13800000002" }),
      }),
      leadContext(ids.leadCustomerA),
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "该号码已归属 其他公司或小组，不能重复录入" });
    await expect(db.leadCustomer.findUniqueOrThrow({ where: { id: ids.leadCustomerA } })).resolves.toMatchObject({ phone: "13800000001" });
  });

  it.each(["groupOperatorA", "expertA"] as const)(
    "blocks %s from customer import and global history",
    async (actorKey) => {
      await signInAs(ids[actorKey]);
      expect(
        (
          await importLeads(
            new Request("http://localhost/api/leads", {
              method: "POST",
              body: JSON.stringify({}),
            }),
          )
        ).status,
      ).toBe(403);
      expect(
        (await getHistory(new Request("http://localhost/api/history"))).status,
      ).toBe(403);
    },
  );

  it("keeps the group operator read-only for finance", async () => {
    await signInAs(ids.groupOperatorA);
    expect(
      (
        await voidFinance(
          new Request("http://localhost/api/customer-finance/missing", {
            method: "PATCH",
            body: JSON.stringify({ action: "void", reason: "越权" }),
          }),
          { params: Promise.resolve({ eventId: "missing" }) },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await createFinance(
          new Request("http://localhost/api/customer-finance", {
            method: "POST",
            body: JSON.stringify({
              customerOrderId: "missing",
              occurredOn: "2026-08-15",
              kind: "WITHDRAWAL",
              amountCents: 100,
            }),
          }),
        )
      ).status,
    ).toBe(403);
  });

  it("keeps reception ownership and lead group boundaries in place", async () => {
    await signInAs(ids.receptionA);
    expect(
      (
        await updateLead(
          new Request("http://localhost/api/leads/target", {
            method: "PATCH",
            body: JSON.stringify({ action: "note", notes: "越权内容" }),
          }),
          leadContext(ids.leadCustomerB),
        )
      ).status,
    ).toBe(403);

    vi.restoreAllMocks();
    await signInAs(ids.leadA);
    expect(
      (
        await updateLead(
          new Request("http://localhost/api/leads/target", {
            method: "PATCH",
            body: JSON.stringify({ action: "note", notes: "越权内容" }),
          }),
          leadContext(ids.leadCustomerB),
        )
      ).status,
    ).toBe(403);
  });

  it("rechecks a session account inside the write transaction", async () => {
    await signInAs(ids.receptionA);
    const before = await db.leadCustomer.findUniqueOrThrow({
      where: { id: ids.leadCustomerA },
      select: { notes: true },
    });
    // The mocked session is deliberately still active. The write service must
    // consult the database again so a just-disabled account cannot slip through.
    await db.user.update({ where: { id: ids.receptionA }, data: { active: false } });
    try {
      const response = await updateLead(
        new Request("http://localhost/api/leads/target", {
          method: "PATCH",
          body: JSON.stringify({ action: "note", notes: "停用后越权写入" }),
        }),
        leadContext(ids.leadCustomerA),
      );
      expect(response.status).toBe(403);
      await expect(db.leadCustomer.findUniqueOrThrow({
        where: { id: ids.leadCustomerA },
        select: { notes: true },
      })).resolves.toEqual(before);
    } finally {
      await db.user.update({ where: { id: ids.receptionA }, data: { active: true } });
    }
  });

  it("keeps group departure and its correction with the group-follow-up role", async () => {
    await signInAs(ids.receptionA);
    const response = await updateLead(
      new Request("http://localhost/api/leads/target", {
        method: "PATCH",
        body: JSON.stringify({ action: "leaveGroup" }),
      }),
      leadContext(ids.leadCustomerA),
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "前台接粉只能录入号码、回复回访、确认入群和补充自己的备注",
    });
  });

  it("lets the group operator introduce and assign in one step, then separates expert contact from registration", async () => {
    await db.leadCustomer.update({
      where: { id: ids.leadCustomerA },
      data: {
        groupStatus: "JOINED",
        joinedOn: "2026-08-14",
      },
    });
    await db.groupOperatorReception.create({
      data: { groupOperatorId: ids.groupOperatorA, receptionistId: ids.receptionA },
    });
    await signInAs(ids.groupOperatorA);
    const introductionBeforeJoin = await updateLead(
      new Request("http://localhost/api/leads/target", {
        method: "PATCH",
        body: JSON.stringify({ action: "introduceExpert", occurredOn: "2026-08-13", expertOwnerId: ids.expertA }),
      }),
      leadContext(ids.leadCustomerA),
    );
    expect(introductionBeforeJoin.status).toBe(400);

    const introduction = await updateLead(
      new Request("http://localhost/api/leads/target", {
        method: "PATCH",
        body: JSON.stringify({ action: "introduceExpert", occurredOn: "2026-08-14", expertOwnerId: ids.expertA }),
      }),
      leadContext(ids.leadCustomerA),
    );
    expect(introduction.status).toBe(200);
    await expect(db.leadCustomer.findUniqueOrThrow({ where: { id: ids.leadCustomerA } })).resolves.toMatchObject({
      expertIntroducedOn: "2026-08-14",
      expertOwnerId: ids.expertA,
      expertContactedOn: null,
    });

    vi.restoreAllMocks();
    await signInAs(ids.expertA);
    const registrationBeforeContact = await updateLead(
      new Request("http://localhost/api/leads/target", {
        method: "PATCH",
        body: JSON.stringify({ action: "register", occurredOn: "2026-08-14" }),
      }),
      leadContext(ids.leadCustomerA),
    );
    expect(registrationBeforeContact.status).toBe(400);

    const expertCannotConfirmContact = await updateLead(
      new Request("http://localhost/api/leads/target", {
        method: "PATCH",
        body: JSON.stringify({ action: "markExpertContacted", occurredOn: "2026-08-14" }),
      }),
      leadContext(ids.leadCustomerA),
    );
    expect(expertCannotConfirmContact.status).toBe(403);

    vi.restoreAllMocks();
    await signInAs(ids.groupOperatorA);
    const groupCannotConfirmContact = await updateLead(
      new Request("http://localhost/api/leads/target", {
        method: "PATCH",
        body: JSON.stringify({ action: "markExpertContacted", occurredOn: "2026-08-13" }),
      }),
      leadContext(ids.leadCustomerA),
    );
    expect(groupCannotConfirmContact.status).toBe(403);

    vi.restoreAllMocks();
    await signInAs(ids.expertA);
    const reception = await updateLead(
      new Request("http://localhost/api/leads/target", {
        method: "PATCH",
        body: JSON.stringify({ action: "beginExpertReception", occurredOn: "2026-08-14", expertDeviceAccountId: ids.expertAccount, contactNote: "已开始接待" }),
      }),
      leadContext(ids.leadCustomerA),
    );
    expect(reception.status).toBe(200);
    const tracking = await updateLead(
      new Request("http://localhost/api/leads/target", {
        method: "PATCH",
        body: JSON.stringify({ action: "beginExpertTracking", occurredOn: "2026-08-14" }),
      }),
      leadContext(ids.leadCustomerA),
    );
    expect(tracking.status).toBe(200);
    const pendingRegistration = await updateLead(
      new Request("http://localhost/api/leads/target", {
        method: "PATCH",
        body: JSON.stringify({ action: "markPendingRegistration", occurredOn: "2026-08-14" }),
      }),
      leadContext(ids.leadCustomerA),
    );
    expect(pendingRegistration.status).toBe(200);

    vi.restoreAllMocks();
    await signInAs(ids.expertA);
    const registrationBeforeExpertContact = await updateLead(
      new Request("http://localhost/api/leads/target", {
        method: "PATCH",
        body: JSON.stringify({ action: "register", occurredOn: "2026-08-13" }),
      }),
      leadContext(ids.leadCustomerA),
    );
    expect(registrationBeforeExpertContact.status).toBe(400);

    const registration = await updateLead(
      new Request("http://localhost/api/leads/target", {
        method: "PATCH",
        body: JSON.stringify({ action: "register", occurredOn: "2026-08-14" }),
      }),
      leadContext(ids.leadCustomerA),
    );
    expect(registration.status).toBe(200);

    vi.restoreAllMocks();
    await signInAs(ids.expertA);
    const orderBeforeRegistration = await createOrder(
      new Request("http://localhost/api/customer-orders", {
        method: "POST",
        body: JSON.stringify({
          leadId: ids.leadCustomerA,
          batchId: (await db.leadCustomer.findUniqueOrThrow({ where: { id: ids.leadCustomerA } })).batchId,
          phone: "13800000001",
          openedOn: "2026-08-13",
          initialDepositCents: 10_000,
          initialDepositMethod: "BANK",
        }),
      }),
    );
    expect(orderBeforeRegistration.status).toBe(400);

    const order = await createOrder(
      new Request("http://localhost/api/customer-orders", {
        method: "POST",
        body: JSON.stringify({
          leadId: ids.leadCustomerA,
          batchId: (await db.leadCustomer.findUniqueOrThrow({ where: { id: ids.leadCustomerA } })).batchId,
          phone: "13800000001",
          openedOn: "2026-08-14",
          initialDepositCents: 10_000,
          initialDepositMethod: "BANK",
        }),
      }),
    );
    expect(order.status).toBe(201);
  });

  it("lets the assigned expert manually record the device number when starting reception", async () => {
    vi.restoreAllMocks();
    await signInAs(ids.groupOperatorA);
    const introduction = await updateLead(
      new Request("http://localhost/api/leads/target", {
        method: "PATCH",
        body: JSON.stringify({ action: "introduceExpert", occurredOn: "2026-08-14", expertOwnerId: ids.expertA }),
      }),
      leadContext(ids.leadCustomerC),
    );
    expect(introduction.status).toBe(200);
    vi.restoreAllMocks();
    await signInAs(ids.expertA);
    const response = await updateLead(
      new Request("http://localhost/api/leads/target", {
        method: "PATCH",
        body: JSON.stringify({ action: "beginExpertReception", occurredOn: "2026-08-14", expertDeviceAccountNumber: "历史专家号-001" }),
      }),
      leadContext(ids.leadCustomerC),
    );
    expect(response.status).toBe(200);
    await expect(db.leadCustomer.findUniqueOrThrow({ where: { id: ids.leadCustomerC } })).resolves.toMatchObject({
      expertOwnerId: ids.expertA,
      expertDeviceAccountId: null,
      expertDeviceAccountNumber: "历史专家号-001",
    });
  });

  it("lets the lead and assigned expert edit expert follow-up details", async () => {
    await signInAs(ids.expertA);
    const expertUpdate = await updateLead(
      new Request("http://localhost/api/leads/target", {
        method: "PATCH",
        body: JSON.stringify({
          action: "updateExpertDetails",
          occurredOn: "2026-08-15",
          customerName: "专家客户",
          expertNotes: "专家已联系",
          deviceAccountId: ids.expertAccount,
          nextPlan: "明天跟进续充",
          nextFollowUpOn: "2026-08-16",
        }),
      }),
      leadContext(ids.leadCustomerA),
    );
    expect(expertUpdate.status).toBe(200);
    await expect(
      db.leadCustomer.findUniqueOrThrow({ where: { id: ids.leadCustomerA } }),
    ).resolves.toMatchObject({
      customerName: "专家客户",
      expertNotes: "专家已联系",
      expertDeviceAccountId: ids.expertAccount,
      expertDeviceAccountNumber: `expert-${suffix}`,
      nextPlan: "明天跟进续充",
      nextFollowUpOn: "2026-08-16",
    });
    await expect(db.leadActivity.findFirst({
      where: { leadId: ids.leadCustomerA, actorId: ids.expertA, kind: "PLAN_UPDATED" },
      orderBy: { createdAt: "desc" },
    })).resolves.toMatchObject({ note: expect.stringContaining("专家情况：专家已联系") });

    vi.restoreAllMocks();
    await signInAs(ids.leadA);
    const leadUpdate = await updateLead(
      new Request("http://localhost/api/leads/target", {
        method: "PATCH",
        body: JSON.stringify({
          action: "updateExpertDetails",
          occurredOn: "2026-08-15",
          customerName: "组长修正姓名",
          expertNotes: "组长补充专家情况",
          nextPlan: "继续跟进入金",
          nextFollowUpOn: null,
        }),
      }),
      leadContext(ids.leadCustomerA),
    );
    expect(leadUpdate.status).toBe(200);

    vi.restoreAllMocks();
    await signInAs(ids.receptionA);
    const receptionUpdate = await updateLead(
      new Request("http://localhost/api/leads/target", {
        method: "PATCH",
        body: JSON.stringify({ action: "updateExpertDetails", customerName: "越权修改" }),
      }),
      leadContext(ids.leadCustomerA),
    );
    expect(receptionUpdate.status).toBe(403);
  });

  it("stores one group progress entry per customer per day and lets same-day saves update it", async () => {
    await signInAs(ids.groupOperatorA);
    const otherAccount = await updateLead(
      new Request("http://localhost/api/leads/target", {
        method: "PATCH",
        body: JSON.stringify({ action: "updateGroupProgress", occurredOn: "2026-08-15", progressNote: "错误账号", deviceAccountId: ids.expertAccount }),
      }),
      leadContext(ids.leadCustomerA),
    );
    expect(otherAccount.status).toBe(403);
    const firstSave = await updateLead(
      new Request("http://localhost/api/leads/target", {
        method: "PATCH",
        body: JSON.stringify({ action: "updateGroupProgress", occurredOn: "2026-08-15", progressNote: "客户今天在群内有互动", deviceAccountId: ids.groupOperatorAccount }),
      }),
      leadContext(ids.leadCustomerA),
    );
    expect(firstSave.status).toBe(200);

    const secondSave = await updateLead(
      new Request("http://localhost/api/leads/target", {
        method: "PATCH",
        body: JSON.stringify({ action: "updateGroupProgress", occurredOn: "2026-08-15", progressNote: "客户已回复问题，明天继续跟进" }),
      }),
      leadContext(ids.leadCustomerA),
    );
    expect(secondSave.status).toBe(200);
    await expect(db.leadActivity.findMany({
      where: { leadId: ids.leadCustomerA, kind: "GROUP_PROGRESS_UPDATED", occurredOn: "2026-08-15" },
    })).resolves.toMatchObject([{ note: "客户已回复问题，明天继续跟进" }]);
    await expect(db.leadCustomer.findUniqueOrThrow({ where: { id: ids.leadCustomerA } })).resolves.toMatchObject({
      groupDeviceAccountId: ids.groupOperatorAccount,
      groupDeviceAccountNumber: `group-${suffix}`,
    });

    vi.restoreAllMocks();
    await signInAs(ids.expertA);
    const expertSave = await updateLead(
      new Request("http://localhost/api/leads/target", {
        method: "PATCH",
        body: JSON.stringify({ action: "updateGroupProgress", occurredOn: "2026-08-16", progressNote: "专家越权填写" }),
      }),
      leadContext(ids.leadCustomerA),
    );
    expect(expertSave.status).toBe(403);
  });

  it("lets only the original reception owner read downstream daily progress", async () => {
    vi.restoreAllMocks();
    await signInAs(ids.receptionA);
    const own = await getDownstreamProgress(
      new Request("http://localhost/api/leads/target/downstream-progress"),
      leadContext(ids.leadCustomerA),
    );
    expect(own.status).toBe(200);
    const payload = await own.json();
    expect(payload.customer.phone).toBe("13800000001");
    expect(payload.groupProgress).toEqual(expect.arrayContaining([
      expect.objectContaining({ note: "客户已回复问题，明天继续跟进" }),
    ]));
    expect(payload.expertProgress).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "PLAN_UPDATED" }),
    ]));

    vi.restoreAllMocks();
    await signInAs(ids.receptionB);
    const otherReception = await getDownstreamProgress(
      new Request("http://localhost/api/leads/target/downstream-progress"),
      leadContext(ids.leadCustomerA),
    );
    expect(otherReception.status).toBe(404);

    vi.restoreAllMocks();
    await signInAs(ids.expertA);
    const expert = await getDownstreamProgress(
      new Request("http://localhost/api/leads/target/downstream-progress"),
      leadContext(ids.leadCustomerA),
    );
    expect(expert.status).toBe(403);
  });

  it("lets the assigned expert and group lead manage finance while reception stays read-only", async () => {
    const order = await db.customerOrder.findFirstOrThrow({
      where: { leadId: ids.leadCustomerA, voidedAt: null },
    });

    await signInAs(ids.expertA);
    const expertFinance = await createFinance(
      new Request("http://localhost/api/customer-finance", {
        method: "POST",
        body: JSON.stringify({
          customerOrderId: order.id,
          occurredOn: "2026-08-15",
          kind: "RECHARGE",
          amountCents: 2_000,
          continuationNumber: 1,
          depositMethod: "CRYPTO",
        }),
      }),
    );
    expect(expertFinance.status).toBe(201);
    const expertEventId = ((await expertFinance.json()).events as Array<{ id: string }>)[0].id;

    vi.restoreAllMocks();
    await signInAs(ids.leadA);
    const leadFinance = await createFinance(
      new Request("http://localhost/api/customer-finance", {
        method: "POST",
        body: JSON.stringify({
          customerOrderId: order.id,
          occurredOn: "2026-08-15",
          kind: "WITHDRAWAL",
          amountCents: 500,
        }),
      }),
    );
    expect(leadFinance.status).toBe(201);

    vi.restoreAllMocks();
    await signInAs(ids.receptionA);
    const receptionFinance = await createFinance(
      new Request("http://localhost/api/customer-finance", {
        method: "POST",
        body: JSON.stringify({
          customerOrderId: order.id,
          occurredOn: "2026-08-15",
          kind: "RECHARGE",
          amountCents: 1_000,
          continuationNumber: 2,
          depositMethod: "BANK",
        }),
      }),
    );
    expect(receptionFinance.status).toBe(403);

    vi.restoreAllMocks();
    await signInAs(ids.receptionB);
    expect(
      (
        await createFinance(
          new Request("http://localhost/api/customer-finance", {
            method: "POST",
            body: JSON.stringify({
              customerOrderId: order.id,
              occurredOn: "2026-08-15",
              kind: "WITHDRAWAL",
              amountCents: 100,
            }),
          }),
        )
      ).status,
    ).toBe(403);

    vi.restoreAllMocks();
    await signInAs(ids.expertA);
    expect(
      (
        await voidFinance(
          new Request(`http://localhost/api/customer-finance/${expertEventId}`, {
            method: "PATCH",
            body: JSON.stringify({ action: "void", reason: "专家发现录入错误" }),
          }),
          { params: Promise.resolve({ eventId: expertEventId }) },
        )
      ).status,
    ).toBe(200);
  });

  it("blocks reception from expert, registration, order, and finance writes", async () => {
    await signInAs(ids.receptionA);
    const expertAction = await updateLead(
      new Request("http://localhost/api/leads/target", {
        method: "PATCH",
        body: JSON.stringify({ action: "register", occurredOn: "2026-08-15" }),
      }),
      leadContext(ids.leadCustomerA),
    );
    const order = await createOrder(
      new Request("http://localhost/api/customer-orders", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
    const finance = await createFinance(
      new Request("http://localhost/api/customer-finance", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
    expect(expertAction.status).toBe(403);
    expect(order.status).toBe(403);
    expect(finance.status).toBe(403);
  });
});
