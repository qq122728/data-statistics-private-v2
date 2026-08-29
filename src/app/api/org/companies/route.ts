import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { recordAudit } from "../../../../lib/audit";
import { db } from "../../../../lib/db";
import { canCreateCompany } from "../../../../lib/org-permissions";
import { API_LIMITS } from "../../../../lib/request-limits";
import { authorizationDenied } from "../../../../lib/security-events";
import { requireOrgManagerRequest } from "../_auth";

type CompanyRequest = { name?: unknown };

/** 阶段5a：新建公司（需求文档5.6，只有总公司管理员能做）。 */
export async function POST(request: Request) {
  const access = await requireOrgManagerRequest();
  if ("response" in access) return access.response;
  if (!canCreateCompany(access.actor)) return authorizationDenied(access.actor, "只有总公司管理员可以新建公司");

  const body = (await request.json()) as CompanyRequest;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > API_LIMITS.accountDisplayNameCharacters) {
    return NextResponse.json({ error: "公司名称必须在 1 到 100 个字之间" }, { status: 400 });
  }

  try {
    const company = await db.$transaction(async (client) => {
      const created = await client.company.create({ data: { id: randomUUID(), name } });
      await recordAudit(client, {
        actorId: access.actor.id,
        action: "COMPANY_CREATED",
        entityType: "Company",
        entityId: created.id,
        summary: { changedFields: ["name"], name: created.name },
      });
      return created;
    });
    return NextResponse.json(company, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "公司名称已经存在" }, { status: 409 });
    }
    throw error;
  }
}
