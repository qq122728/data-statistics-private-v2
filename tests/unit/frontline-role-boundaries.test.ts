import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as auth from "../../src/lib/auth";
import { db } from "../../src/lib/db";
import { GET as getHistory } from "../../src/app/api/history/route";
import { POST as importLeads } from "../../src/app/api/leads/route";
import { POST as addHistoricalGroupCustomer } from "../../src/app/api/group-customers/historical/route";
import { POST as addHistoricalExpertCustomer } from "../../src/app/api/expert-customers/historical/route";
import {
  DELETE as deleteLead,
  PATCH as updateLead,
} from "../../src/app/api/leads/[leadId]/route";
import { GET as getDownstreamProgress } from "../../src/app/api/leads/[leadId]/downstream-progress/route";
import { PATCH as patchSharedCustomer } from "../../src/app/api/lead/customer-reporting/[leadId]/route";
import { PATCH as voidFinance } from "../../src/app/api/customer-finance/[eventId]/route";
import { POST as createFinance } from "../../src/app/api/customer-finance/route";
import { POST as createOrder } from "../../src/app/api/customer-orders/route";
import { normalizeCustomerPhone } from "../../src/lib/entry-ledger";

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
    db.leadCustomer.create({ data: { phone: normalizeCustomerPhone("13800000001"), customerName: "甲组已有客户", batchId: batchA.id, ownerId: ids.receptionA } }),
    db.leadCustomer.create({ data: { phone: normalizeCustomerPhone("13800000002"), customerName: "乙组机密客户", batchId: batchB.id, ownerId: ids.receptionB } }),
    db.leadCustomer.create({ data: { phone: normalizeCustomerPhone("13800000003"), batchId: batchA.id, ownerId: ids.receptionA, groupOperatorOwnerId: ids.groupOperatorA, groupStatus: "JOINED", joinedOn: "2026-08-14" } }),
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

async function signInWithAssignments(id: string) {
  vi.spyOn(auth, "requireUser").mockResolvedValue(
    await db.user.findUniqueOrThrow({
      where: { id },
      include: { roleAssignments: { select: { role: true } } },
    }),
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
        groupOperatorOwnerId: ids.groupOperatorA,
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

  it("只被选为负责人但没有对应岗位权限时不能修改炒群或专家进度", async () => {
    const sourceLead = await db.leadCustomer.findUniqueOrThrow({
      where: { id: ids.leadCustomerA },
      select: { batchId: true },
    });
    const customer = await db.leadCustomer.create({
      data: {
        phone: `135${String(Date.now()).slice(-8)}`,
        batchId: sourceLead.batchId,
        ownerId: ids.receptionA,
        attributionOwnerId: ids.groupOperatorA,
        groupOperatorOwnerId: ids.receptionA,
        expertOwnerId: ids.receptionA,
        groupStatus: "JOINED",
        joinedOn: "2026-08-14",
        expertIntroducedOn: "2026-08-14",
      },
    });
    try {
      vi.restoreAllMocks();
      await signInAs(ids.receptionA);
      const groupProgress = await updateLead(
        new Request("http://localhost/api/leads/target", {
          method: "PATCH",
          body: JSON.stringify({ action: "updateGroupProgress", occurredOn: "2026-08-15", progressNote: "已在群内继续跟进" }),
        }),
        leadContext(customer.id),
      );
      const expertProgress = await updateLead(
        new Request("http://localhost/api/leads/target", {
          method: "PATCH",
          body: JSON.stringify({ action: "updateExpertDetails", occurredOn: "2026-08-15", expertNotes: "已与客户沟通资料" }),
        }),
        leadContext(customer.id),
      );
      const sharedGroupProgress = await patchSharedCustomer(
        new Request("http://localhost/api/lead/customer-reporting/target", {
          method: "PATCH",
          body: JSON.stringify({ action: "setDeviceCode", code: "不应保存" }),
        }),
        { params: Promise.resolve({ leadId: customer.id }) },
      );

      expect(groupProgress.status).toBe(403);
      expect(expertProgress.status).toBe(403);
      expect(sharedGroupProgress.status).toBe(403);
      await signInAs(ids.groupOperatorA);
      const sharedCustomerInfo = await patchSharedCustomer(
        new Request("http://localhost/api/lead/customer-reporting/target", {
          method: "PATCH",
          body: JSON.stringify({ action: "setCustomerName", customerName: "不应保存" }),
        }),
        { params: Promise.resolve({ leadId: customer.id }) },
      );
      expect(sharedCustomerInfo.status).toBe(403);
      await expect(db.leadCustomer.findUniqueOrThrow({ where: { id: customer.id } })).resolves.toMatchObject({
        attributionOwnerId: ids.groupOperatorA,
        groupOperatorOwnerId: ids.receptionA,
        expertOwnerId: ids.receptionA,
      });
    } finally {
      await db.leadCustomer.deleteMany({ where: { id: customer.id } });
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
  ])("returns 410 for an authenticated %s because the old endpoint is retired", async (_label, userId) => {
    vi.restoreAllMocks();
    await signInAs(userId);

    const response = await addHistoricalExpertCustomer(historicalExpertRequest("13900000002"));

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({ error: "旧专家历史补录接口已停用，请使用客户协作进度中的“新增专家客户”" });
  });

  it("retires the old historical expert endpoint without exposing same-group duplicate details", async () => {
    vi.restoreAllMocks();
    await signInAs(ids.expertA);

    const response = await addHistoricalExpertCustomer(historicalExpertRequest("13800000001"));
    const payload = await response.json() as { error: string };

    expect(response.status).toBe(410);
    expect(payload.error).toContain("旧专家历史补录接口已停用");
    expect(payload.error).not.toContain("甲组已有客户");
  });

  it("retires the old historical expert endpoint without exposing cross-group details", async () => {
    vi.restoreAllMocks();
    await signInAs(ids.expertA);
    const auditCountBefore = await db.auditLog.count();

    const response = await addHistoricalExpertCustomer(historicalExpertRequest("13800000002"));
    const payload = await response.json() as { error: string };

    expect(response.status).toBe(410);
    expect(payload.error).toContain("旧专家历史补录接口已停用");
    expect(JSON.stringify(payload)).not.toContain("乙组机密客户");
    expect(JSON.stringify(payload)).not.toContain(ids.leadCustomerB);
    expect(JSON.stringify(payload)).not.toContain(ids.groupB);
    await expect(db.auditLog.count()).resolves.toBe(auditCountBefore);
  });

  it("closes the old historical ordered and finance entry without creating customer facts", async () => {
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

    const beforeOrders = await db.customerOrder.count();
    const beforeMetrics = await db.metricEvent.count();
    const response = await addHistoricalExpertCustomer(request());
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("旧专家历史补录接口已停用") });
    await expect(db.leadCustomer.findUnique({ where: { phone: normalizeCustomerPhone(phone) } })).resolves.toBeNull();
    await expect(db.customerOrder.count()).resolves.toBe(beforeOrders);
    await expect(db.metricEvent.count()).resolves.toBe(beforeMetrics);
  });

  it("also redirects group leads from the retired historical endpoint to the unified entry", async () => {
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

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("新增专家客户") });
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
      error: "没有可导入的有效客户；撞粉、低金额、无 WS 号码请在“每日数据填写”中单独填写数量",
    });
    await expect(db.leadCustomer.count({ where: { phone: normalizeCustomerPhone("13800000002") } })).resolves.toBe(1);
  });

  it("keeps same-group collision ownership private from an unrelated receptionist", async () => {
    await db.userRoleAssignment.create({ data: { userId: ids.groupOperatorA, role: "RECEPTION" } });
    try {
      await signInWithAssignments(ids.groupOperatorA);
      const freshPhone = `134${String(Date.now()).slice(-8)}`;
      const response = await importLeads(
        new Request("http://localhost/api/leads", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sourceDate: "2026-08-16",
            channelId: ids.channelA,
            rows: [{ phone: "13800000001" }, { phone: freshPhone }],
          }),
        }),
      );
      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toMatchObject({
        collisions: [{ phone: normalizeCustomerPhone("13800000001"), ownerName: "已存在客户" }],
      });
    } finally {
      await db.userRoleAssignment.deleteMany({ where: { userId: ids.groupOperatorA, role: "RECEPTION" } });
    }
  });

  it("rejects an attribution owner who does not have reception permission", async () => {
    await signInAs(ids.receptionA);
    const response = await importLeads(
      new Request("http://localhost/api/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceDate: "2026-08-16",
          channelId: ids.channelA,
          rows: [{ phone: `133${String(Date.now()).slice(-8)}`, attributionOwnerId: ids.expertA }],
        }),
      }),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("接粉权限") });
  });

  it("imports a customer row with its profile and a selected reception device", async () => {
    await signInAs(ids.receptionA);
    const digits = `139${String(Date.now()).slice(-8)}`;
    const phone = `${digits.slice(0, 3)} ${digits.slice(3, 7)} ${digits.slice(7)}`;
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
    await expect(db.leadCustomer.findUniqueOrThrow({ where: { phone: normalizeCustomerPhone(phone) } })).resolves.toMatchObject({
      ownerId: ids.receptionA,
      deviceId: ids.receptionDevice,
      customerName: "导入客户",
      lossAmountCents: 500000,
      customerPlatform: "MT5",
      notes: "导入时已填写资料",
    });
  });

  it("keeps the intake operator separate from the selected fan attribution owner", async () => {
    await db.userRoleAssignment.createMany({ data: [
      { userId: ids.groupOperatorA, role: "RECEPTION" },
      { userId: ids.expertA, role: "RECEPTION" },
    ] });
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
      const lead = await db.leadCustomer.findUniqueOrThrow({ where: { phone: normalizeCustomerPhone(phone) } });
      expect(lead).toMatchObject({
        ownerId: ids.expertA,
        attributionOwnerId: ids.expertA,
      });
      await expect(db.metricEvent.findMany({
        where: { batchId: lead.batchId, kind: { in: ["NEW_FANS", "EFFECTIVE_FANS"] }, voidedAt: null },
        select: { enteredById: true, kind: true },
      })).resolves.toEqual([]);
    } finally {
      await db.userRoleAssignment.deleteMany({
        where: { userId: { in: [ids.groupOperatorA, ids.expertA] }, role: "RECEPTION" },
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
    await expect(db.leadCustomer.findUnique({ where: { phone: normalizeCustomerPhone(phone) } })).resolves.toMatchObject({ phone: normalizeCustomerPhone(phone) });
    await expect(db.leadException.count({ where: { phone: normalizeCustomerPhone(phone), kind: "DUPLICATE_IN_PASTE" } })).resolves.toBe(0);
  });

  it("removes an untouched mistaken entry without touching independent statistics", async () => {
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
    const lead = await db.leadCustomer.findUniqueOrThrow({ where: { phone: normalizeCustomerPhone(phone) } });

    expect((await deleteLead(new Request("http://localhost/api/leads/target", { method: "DELETE" }), leadContext(lead.id))).status).toBe(200);
    await expect(db.leadCustomer.findUnique({ where: { id: lead.id } })).resolves.toBeNull();
    const corrections = await db.metricEvent.findMany({
      where: { batchId: payload.batch.id, enteredById: ids.receptionA, derivedFromLedger: true, kind: { in: ["NEW_FANS", "EFFECTIVE_FANS"] } },
      select: { kind: true, quantity: true },
    });
    expect(corrections).toEqual([]);
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
    await expect(db.leadCustomer.findUniqueOrThrow({ where: { id: ids.leadCustomerA } })).resolves.toMatchObject({ phone: normalizeCustomerPhone("13800000001") });
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

  it("blocks finance endpoints before lookup when the member has no expert permission", async () => {
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

  it("blocks direct API edits by reception after the customer is handed to group follow-up", async () => {
    const source = await db.leadCustomer.findUniqueOrThrow({
      where: { id: ids.leadCustomerA },
      select: { batchId: true },
    });
    const handedOff = await db.leadCustomer.create({
      data: {
        phone: `91${String(Date.now()).slice(-4)}`,
        batchId: source.batchId,
        ownerId: ids.receptionA,
        groupOperatorOwnerId: ids.groupOperatorA,
        replyStatus: "REPLIED",
        repliedOn: "2026-08-14",
        groupStatus: "JOINED",
        joinedOn: "2026-08-14",
        notes: "交棒前备注",
      },
    });
    await signInAs(ids.receptionA);
    const attempts = [
      { action: "updatePhone", phone: "12" },
      { action: "updateProfile", customerName: "越权姓名", deviceCode: "越权设备" },
      { action: "classifyReception", receptionCategory: "LOW_AMOUNT" },
      { action: "note", notes: "交棒后越权备注" },
      { action: "assignDevice", deviceCode: "越权设备" },
      { action: "voidErroneousEntry", reason: "越权作废" },
    ];
    for (const body of attempts) {
      const response = await updateLead(
        new Request("http://localhost/api/leads/target", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        leadContext(handedOff.id),
      );
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({ error: "当前岗位不能处理该客户或执行此操作" });
    }
    await expect(db.leadCustomer.findUniqueOrThrow({ where: { id: handedOff.id } })).resolves.toMatchObject({
      phone: handedOff.phone,
      customerName: null,
      notes: "交棒前备注",
      invalid: false,
      deviceId: null,
    });
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
        groupOperatorOwnerId: ids.groupOperatorA,
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

    const introductionToNonExpert = await updateLead(
      new Request("http://localhost/api/leads/target", {
        method: "PATCH",
        body: JSON.stringify({ action: "introduceExpert", occurredOn: "2026-08-14", expertOwnerId: ids.receptionA }),
      }),
      leadContext(ids.leadCustomerA),
    );
    expect(introductionToNonExpert.status).toBe(400);
    await expect(introductionToNonExpert.json()).resolves.toMatchObject({ error: "只能选择本组有专家权限的在职成员或组长" });

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

  it("lets one reception account with expert permission open an assigned customer's order", async () => {
    const tripleRoleId = `boundary-triple-role-${suffix}`;
    const batch = await db.sourceBatch.findFirstOrThrow({ where: { groupId: ids.groupA } });
    await db.user.create({
      data: {
        id: tripleRoleId,
        username: tripleRoleId,
        name: "三岗员工",
        role: "RECEPTION",
        groupId: ids.groupA,
        roleAssignments: {
          create: [{ role: "RECEPTION" }, { role: "GROUP_OPERATOR" }, { role: "EXPERT" }],
        },
      },
    });
    const customer = await db.leadCustomer.create({
      data: {
        phone: `6${String(Date.now()).slice(-5)}`,
        batchId: batch.id,
        ownerId: tripleRoleId,
        groupOperatorOwnerId: tripleRoleId,
        expertOwnerId: tripleRoleId,
        groupStatus: "JOINED",
        joinedOn: "2026-08-14",
        expertIntroducedOn: "2026-08-14",
        registeredOn: "2026-08-14",
      },
    });

    vi.restoreAllMocks();
    await signInWithAssignments(tripleRoleId);
    const response = await createOrder(
      new Request("http://localhost/api/customer-orders", {
        method: "POST",
        body: JSON.stringify({
          leadId: customer.id,
          batchId: batch.id,
          phone: customer.phone,
          openedOn: "2026-08-30",
          initialDepositCents: 25_000,
          initialDepositMethod: "CRYPTO",
        }),
      }),
    );

    expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
    const order = await db.customerOrder.findUniqueOrThrow({ where: { leadId: customer.id } });
    await expect(db.customerFinanceEvent.findMany({
      where: { customerOrderId: order.id },
      select: { kind: true, amountCents: true },
    })).resolves.toEqual([{ kind: "RECHARGE", amountCents: 25_000 }]);
  });

  it("lets a legacy inferred tracking customer advance and records a compatible tracking start", async () => {
    const batch = await db.sourceBatch.findFirstOrThrow({ where: { groupId: ids.groupA } });
    const legacy = await db.leadCustomer.create({
      data: {
        phone: "699991",
        customerName: "旧版追踪客户",
        batchId: batch.id,
        ownerId: ids.receptionA,
        groupStatus: "JOINED",
        joinedOn: "2026-08-12",
        expertIntroducedOn: "2026-08-13",
        expertContactedOn: "2026-08-14",
        expertOwnerId: ids.expertA,
        expertWorkflowStage: null,
        expertTrackingStartedAt: null,
      },
    });

    vi.restoreAllMocks();
    await signInAs(ids.expertA);
    const response = await updateLead(
      new Request("http://localhost/api/leads/target", {
        method: "PATCH",
        body: JSON.stringify({ action: "markPendingRegistration", occurredOn: "2026-08-15" }),
      }),
      leadContext(legacy.id),
    );

    expect(response.status).toBe(200);
    await expect(db.leadCustomer.findUniqueOrThrow({ where: { id: legacy.id } })).resolves.toMatchObject({
      expertWorkflowStage: "PENDING_REGISTRATION",
      expertTrackingStartedAt: new Date("2026-08-14T12:00:00.000Z"),
    });
  });

  it("rolls expert correction state back together instead of leaving a stale stage", async () => {
    vi.restoreAllMocks();
    await signInAs(ids.leadA);
    const undoContact = await updateLead(
      new Request("http://localhost/api/leads/target", {
        method: "PATCH",
        body: JSON.stringify({ action: "undoExpertContacted", occurredOn: "2026-08-14", reason: "设备号录错" }),
      }),
      leadContext(ids.leadCustomerC),
    );
    expect(undoContact.status).toBe(200);
    await expect(db.leadCustomer.findUniqueOrThrow({ where: { id: ids.leadCustomerC } })).resolves.toMatchObject({
      expertContactedOn: null,
      expertWorkflowStage: "QUEUED",
      expertTrackingStartedAt: null,
      expertDeviceAccountId: null,
      expertDeviceAccountNumber: null,
    });

    vi.restoreAllMocks();
    await signInAs(ids.groupOperatorA);
    const undoIntroduction = await updateLead(
      new Request("http://localhost/api/leads/target", {
        method: "PATCH",
        body: JSON.stringify({ action: "undoIntroduceExpert", occurredOn: "2026-08-14", reason: "推错专家" }),
      }),
      leadContext(ids.leadCustomerC),
    );
    expect(undoIntroduction.status).toBe(200);
    await expect(db.leadCustomer.findUniqueOrThrow({ where: { id: ids.leadCustomerC } })).resolves.toMatchObject({
      expertIntroducedOn: null,
      expertOwnerId: null,
      expertWorkflowStage: null,
      expertTrackingStartedAt: null,
    });
  });

  it("只让组长和有专家权限的成员维护专家情况", async () => {
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

  it("keeps every same-day group progress revision with its operator", async () => {
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
    const progressHistory = await db.leadActivity.findMany({
      where: { leadId: ids.leadCustomerA, kind: "GROUP_PROGRESS_UPDATED", occurredOn: "2026-08-15" },
      select: { note: true, actorId: true },
    });
    expect(progressHistory).toHaveLength(2);
    expect(progressHistory).toEqual(expect.arrayContaining([
      { note: "客户今天在群内有互动", actorId: ids.groupOperatorA },
      { note: "客户已回复问题，明天继续跟进", actorId: ids.groupOperatorA },
    ]));
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
    expect(payload.customer.phone).toBe(normalizeCustomerPhone("13800000001"));
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

  it("只让组长和有专家权限的成员登记资金流水", async () => {
    const order = await db.customerOrder.findFirstOrThrow({
      where: { leadId: ids.leadCustomerA, voidedAt: null },
    });
    const metricCountBefore = await db.metricEvent.count({ where: { customerOrderId: order.id } });

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
    await expect(db.customerFinanceEvent.findUniqueOrThrow({ where: { id: expertEventId } })).resolves.toMatchObject({
      customerOrderId: order.id,
      kind: "RECHARGE",
      amountCents: 2_000,
      continuationNumber: 1,
    });
    const duplicateContinuation = await createFinance(
      new Request("http://localhost/api/customer-finance", {
        method: "POST",
        body: JSON.stringify({
          customerOrderId: order.id,
          occurredOn: "2026-08-15",
          kind: "RECHARGE",
          amountCents: 9_999,
          continuationNumber: 1,
          depositMethod: "BANK",
        }),
      }),
    );
    expect(duplicateContinuation.status).toBe(400);

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
    await expect(db.customerFinanceEvent.count({ where: { customerOrderId: order.id, voidedAt: null } })).resolves.toBeGreaterThanOrEqual(3);
    await expect(db.metricEvent.count({ where: { customerOrderId: order.id } })).resolves.toBe(metricCountBefore);

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
    await signInAs(ids.expertB);
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
    ).toBe(400);

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

  it("blocks expert workflow, order and finance writes for members without expert permission", async () => {
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
