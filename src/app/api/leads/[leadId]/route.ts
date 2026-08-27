import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { AuthenticationError, requireUser } from "../../../../lib/auth";
import { customerDeleteRoles, hasAnyRole } from "../../../../lib/role-access";
import { canUseCustomerWorkflow } from "../../../../lib/customer-workflow/actions";
import { customerWorkflowInputSchema } from "../../../../lib/customer-workflow/input";
import { API_LIMITS } from "../../../../lib/request-limits";
import { deleteCustomerWorkflow, executeCustomerWorkflow } from "../../../../lib/customer-workflow/service";
import { localDateYYYYMMDD } from "../../../../lib/dates";
import { getSystemSettings } from "../../../../lib/settings";
import { resolveUserBusinessTimezone } from "../../../../lib/business-time";
import { entryDateError } from "../../../../lib/entry-date-validation";
import { authorizationDenied } from "../../../../lib/security-events";

export async function PATCH(request: Request, { params }: { params: Promise<{ leadId: string }> }) {
  let user;
  try { user = await requireUser(); }
  catch (error) {
    if (error instanceof AuthenticationError) return NextResponse.json({ error: error.message }, { status: 401 });
    throw error;
  }
  if (!user.active || !canUseCustomerWorkflow(user.role))
    return authorizationDenied(user, "当前岗位不能在此修改客户");

  try {
    const input = customerWorkflowInputSchema.parse(await request.json());
    const { leadId } = await params;
    if (leadId.length > API_LIMITS.identifierCharacters) return NextResponse.json({ error: "客户参数过长" }, { status: 400 });
    const settings = await getSystemSettings();
    const timezone = await resolveUserBusinessTimezone(user, settings.timezone);
    const today = localDateYYYYMMDD(new Date(), timezone);
    const occurredOn = input.occurredOn ?? today;
    const dateError = entryDateError(occurredOn, today, "业务日期");
    if (dateError) return NextResponse.json({ error: dateError }, { status: 400 });

    const result = await executeCustomerWorkflow(user, leadId, input, occurredOn);

    if ("error" in result)
      return result.status === 403
        ? authorizationDenied(user, result.error)
        : NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message ?? "请检查填写内容" }, { status: 400 });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "请求内容不是有效 JSON" }, { status: 400 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
      return NextResponse.json({ error: "该手机号已在总公司客户库中存在，不能重复录入" }, { status: 409 });
    throw error;
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ leadId: string }> }) {
  let user;
  try { user = await requireUser(); }
  catch (error) {
    if (error instanceof AuthenticationError) return NextResponse.json({ error: error.message }, { status: 401 });
    throw error;
  }
  if (!hasAnyRole(user, customerDeleteRoles))
    return authorizationDenied(user, "当前岗位不能删除客户");

  const { leadId } = await params;
  if (leadId.length > API_LIMITS.identifierCharacters) return NextResponse.json({ error: "客户参数过长" }, { status: 400 });
  const result = await deleteCustomerWorkflow(user, leadId);
  if ("error" in result)
    return result.status === 403
      ? authorizationDenied(user, result.error)
      : NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ deleted: true });
}
