import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { AuthenticationError, requireUser } from "../../../lib/auth";
import { db, getOrCreateSourceBatch, refreshAdvertisingBatchCost } from "../../../lib/db";
import { ChannelResolutionError, resolveOrCreateChannel } from "../../../lib/channels";
import { touchDailyEntryConfirmations } from "../../../lib/daily-confirmations";
import { recordMetricEvents } from "../../../lib/metric-events";
import { customerCodePrefixForChannel, parsePhoneImport, splitPhoneTokens } from "../../../lib/phone-import";
import { isCalendarDate, localDateYYYYMMDD } from "../../../lib/dates";
import { getSystemSettings } from "../../../lib/settings";
import { resolveUserBusinessTimezone } from "../../../lib/business-time";
import { entryDateError } from "../../../lib/entry-date-validation";
import { authorizationDenied } from "../../../lib/security-events";
import { splitCustomerImportRows } from "../../../lib/customer-import-eligibility";
import { hasAssignedRole } from "../../../lib/role-access";
import { API_LIMITS, RequestBodyTooLargeError, readLimitedJson, rowsLimitError, tooLargeResponse } from "../../../lib/request-limits";

const date = z.string().refine(isCalendarDate, "日期必须是实际存在的 YYYY-MM-DD");
const importCustomerRowSchema = z.object({
  phone: z.string().trim().min(1, "请输入客户编号").max(80, "客户编号不能超过 80 个字"),
  customerName: z.string().trim().max(80, "客户姓名不能超过 80 个字").optional(),
  customerEmail: z.string().trim().email("邮箱格式不正确").max(160, "邮箱不能超过 160 个字").optional().or(z.literal("")),
  deviceId: z.string().min(1).max(API_LIMITS.identifierCharacters).optional(),
  deviceCode: z.string().trim().min(1, "请输入设备号").max(50, "设备号不能超过 50 个字").optional(),
  lossAmountCents: z.number().int().min(0, "客户金额不能小于 0").nullable().optional(),
  customerPlatform: z.string().trim().max(80, "客户平台不能超过 80 个字").optional(),
  notes: z.string().trim().max(300, "备注不能超过 300 个字").optional(),
  attributionOwnerId: z.string().min(1, "请选择粉的归属").max(API_LIMITS.identifierCharacters).optional(),
}).superRefine((row, context) => {
  if (row.deviceId && row.deviceCode) {
    context.addIssue({ code: "custom", path: ["deviceId"], message: "设备号请选择设备库或手动填写其中一种" });
  }
});
type ImportCustomerRow = z.infer<typeof importCustomerRowSchema>;

const importSchema = z.object({
  sourceDate: date,
  channelId: z.string().min(1).max(API_LIMITS.identifierCharacters).optional(),
  channelName: z.string().trim().min(1).max(100).optional(),
  // 保留旧 phones 参数，避免旧版本浏览器或已保存的导入请求突然失效。
  phones: z.string().trim().min(1, "请粘贴至少一个客户编号").max(API_LIMITS.customerImportTextCharacters, "粘贴的客户编号过长").optional(),
  rows: z.array(importCustomerRowSchema).min(1, "请至少录入一位客户").max(API_LIMITS.customerImportRows, `一次最多导入 ${API_LIMITS.customerImportRows.toLocaleString("en-US")} 位客户`).optional(),
}).superRefine((input, context) => {
  if (Number(Boolean(input.channelId)) + Number(Boolean(input.channelName)) !== 1) {
    context.addIssue({ code: "custom", path: ["channelId"], message: "请选择渠道或输入新渠道名称" });
  }
  if (Number(Boolean(input.phones)) + Number(Boolean(input.rows?.length)) !== 1) {
    context.addIssue({ code: "custom", path: ["rows"], message: "请粘贴客户编号，或逐行填写客户资料" });
  }
});

export async function POST(request: Request) {
  let user;
  try { user = await requireUser(); }
  catch (error) {
    if (error instanceof AuthenticationError) return NextResponse.json({ error: error.message }, { status: 401 });
    throw error;
  }
  if (!hasAssignedRole(user, "RECEPTION"))
    return authorizationDenied(user, "只有前台接粉可以录入新号码");

  try {
    const input = importSchema.parse(await readLimitedJson(request, API_LIMITS.customerImportBodyBytes));
    if (input.phones) {
      const countError = rowsLimitError(splitPhoneTokens(input.phones).length, API_LIMITS.customerImportRows, "客户");
      if (countError) return NextResponse.json({ error: countError }, { status: 400 });
    }
    const settings = await getSystemSettings();
    const timezone = await resolveUserBusinessTimezone(user, settings.timezone);
    const sourceDateError = entryDateError(input.sourceDate, localDateYYYYMMDD(new Date(), timezone), "导入日期");
    if (sourceDateError) return NextResponse.json({ error: sourceDateError }, { status: 400 });
    const result = await db.$transaction(async (transaction) => {
      const channel = await resolveOrCreateChannel(transaction, {
        actor: user,
        channelId: input.channelId,
        channelName: input.channelName,
      });
      const customerCodeOptions = {
        customerCodePrefix: customerCodePrefixForChannel(channel.channelType),
        channelName: channel.name,
      } as const;
      const importRows: Array<ImportCustomerRow & { index: number }> = input.rows
        ? input.rows.map((row, index) => ({ ...row, index }))
        : parsePhoneImport(input.phones!, customerCodeOptions).rawPhones.map((phone, index) => ({ phone, index }));
      const invalidPhones: string[] = [];
      const normalizedRows: Array<(typeof importRows)[number] & { normalizedPhone: string }> = [];
      for (const row of importRows) {
        const parsed = parsePhoneImport(row.phone, customerCodeOptions);
        if (parsed.rawPhones.length !== 1 || parsed.invalidPhones.length || parsed.distinctPhones.length !== 1) {
          invalidPhones.push(row.phone);
          continue;
        }
        normalizedRows.push({ ...row, normalizedPhone: parsed.distinctPhones[0] });
      }
      if (invalidPhones.length) {
        throw new ChannelResolutionError("客户编号格式不正确，请修改后再导入；扣粉数据请在“扣粉登记”单独填写数量");
      }
      const distinctRows: typeof normalizedRows = [];
      const seenPhones = new Set<string>();
      const duplicateRows: typeof normalizedRows = [];
      for (const row of normalizedRows) {
        if (seenPhones.has(row.normalizedPhone)) {
          duplicateRows.push(row);
          continue;
        }
        seenPhones.add(row.normalizedPhone);
        distinctRows.push(row);
      }
      const distinctPhones = distinctRows.map((row) => row.normalizedPhone);
      if (!distinctPhones.length) throw new ChannelResolutionError("没有可导入的有效六码编号");
      const operatorAssignment = await transaction.groupOperatorReception.findUnique({
        where: { receptionistId: user.id },
        select: { groupOperatorId: true },
      });
      const existing = await transaction.leadCustomer.findMany({
        where: { phone: { in: distinctPhones } },
        select: {
          phone: true,
          id: true,
          ownerId: true,
          owner: { select: { name: true } },
          batch: { select: { groupId: true } },
        },
      });
      const existingByPhone = new Map(existing.map((lead) => [lead.phone, lead]));
      const existingPhones = new Set(existingByPhone.keys());
      const candidateRows = distinctRows.filter((row) => !existingPhones.has(row.normalizedPhone));
      const { importable: acceptedRows, lowAmount: lowAmountRows } = splitCustomerImportRows(candidateRows);
      if (!acceptedRows.length) {
        throw new ChannelResolutionError("没有可导入的有效客户；撞粉、低金额、无 WS 号码请在下方“扣粉登记”手动填写数量");
      }
      // 归属人可以不同于实际录入人，但必须是同一小组的在职成员，防止业绩串到别的公司或小组。
      const attributionOwnerIds = [...new Set(acceptedRows.map((row) => row.attributionOwnerId ?? user.id))];
      const attributionOwners = await transaction.user.findMany({
        where: { id: { in: attributionOwnerIds }, groupId: channel.groupId, active: true },
        select: { id: true },
      });
      if (attributionOwners.length !== attributionOwnerIds.length)
        throw new ChannelResolutionError("粉的归属只能选择本组在职成员");
      const batch = await getOrCreateSourceBatch({
        groupId: channel.groupId,
        channelId: channel.id,
        sourceDate: input.sourceDate,
        advertisingFanCount: acceptedRows.length,
      }, transaction);
      const selectedDeviceIds = [...new Set(acceptedRows.flatMap((row) => row.deviceId ? [row.deviceId] : []))];
      const selectedDevices = selectedDeviceIds.length
        ? await transaction.device.findMany({ where: { id: { in: selectedDeviceIds } } })
        : [];
      const selectedDeviceById = new Map(selectedDevices.map((device) => [device.id, device]));
      const manualDeviceByCode = new Map<string, { id: string; memberId: string | null; active: boolean; groupId: string }>();
      for (const code of [...new Set(acceptedRows.flatMap((row) => row.deviceCode ? [row.deviceCode] : []))]) {
        let device = await transaction.device.findUnique({ where: { groupId_code: { groupId: channel.groupId, code } } });
        if (!device) {
          device = await transaction.device.create({ data: { code, groupId: channel.groupId, memberId: user.id } });
        }
        manualDeviceByCode.set(code, device);
      }
      for (const row of acceptedRows) {
        const device = row.deviceId ? selectedDeviceById.get(row.deviceId) : row.deviceCode ? manualDeviceByCode.get(row.deviceCode) : null;
        if (!device) {
          if (row.deviceId) throw new ChannelResolutionError("选择的设备号不存在");
          continue;
        }
        if (!device.active || device.groupId !== channel.groupId)
          throw new ChannelResolutionError("选择的设备号不存在或已停用");
        if (device.memberId !== user.id)
          throw new ChannelResolutionError("只能选择或填写自己名下的前台接粉设备号");
      }
      if (acceptedRows.length) {
        await transaction.leadCustomer.createMany({
          data: acceptedRows.map((row) => ({
              phone: row.normalizedPhone,
              batchId: batch.id,
              ownerId: user.id,
              attributionOwnerId: row.attributionOwnerId ?? user.id,
              groupOperatorOwnerId: operatorAssignment?.groupOperatorId ?? (hasAssignedRole(user, "GROUP_OPERATOR") ? user.id : null),
              receptionCategory: "VALID",
              invalid: false,
              invalidReason: null,
              deviceId: row.deviceId ?? (row.deviceCode ? manualDeviceByCode.get(row.deviceCode)?.id : null),
              customerName: row.customerName?.trim() || null,
              customerEmail: row.customerEmail?.trim().toLowerCase() || null,
              lossAmountCents: row.lossAmountCents ?? null,
              customerPlatform: row.customerPlatform?.trim() || null,
              notes: row.notes?.trim() || null,
            })),
        });
      }
      // 撞粉由接粉员在“扣粉登记”手动填报，此处只提示，不建立无效客户、
      // 不写撞粉指标，也不让系统自动把提示变成正式数据。
      const duplicateInPasteCount = duplicateRows.length;
      const collisionCount = existing.length;
      const duplicateCount = duplicateInPasteCount + collisionCount;
      // 兼容旧报表的明细事件也按“粉的归属”分组；操作日志仍保留实际录入人。
      const attributionCounts = new Map<string, number>();
      for (const row of acceptedRows) {
        const attributionOwnerId = row.attributionOwnerId ?? user.id;
        attributionCounts.set(attributionOwnerId, (attributionCounts.get(attributionOwnerId) ?? 0) + 1);
      }
      await recordMetricEvents(transaction, [...attributionCounts.entries()].flatMap(([enteredById, quantity]) => [
        { batchId: batch.id, enteredById, occurredOn: input.sourceDate, kind: "NEW_FANS" as const, quantity, derivedFromLedger: true },
        { batchId: batch.id, enteredById, occurredOn: input.sourceDate, kind: "EFFECTIVE_FANS" as const, quantity, derivedFromLedger: true },
      ]));
      // 同一投流批次可由多位接粉员共同导入。每次导入后合计全批有效新增数，
      // 让所有人的号码使用同一笔自动更新的单粉成本。
      const refreshedBatch = batch.channelTypeSnapshot === "ADS"
        ? await refreshAdvertisingBatchCost(batch.id, transaction)
        : batch;
      await touchDailyEntryConfirmations(transaction, user.id, [input.sourceDate]);
      return {
        batch: refreshedBatch,
        imported: acceptedRows.length,
        duplicateCount: Math.max(0, duplicateCount),
        duplicateInPasteCount: Math.max(0, duplicateInPasteCount),
        collisionCount,
        lowAmountCount: lowAmountRows.length,
        collisions: existing.map((lead) => ({
          phone: lead.phone,
          ownerName: lead.batch.groupId === channel.groupId ? lead.owner.name : "其他公司或小组",
        })),
        submitted: acceptedRows.length,
      };
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return tooLargeResponse(error);
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message ?? "请检查导入内容" }, { status: 400 });
    if (error instanceof ChannelResolutionError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "请求内容不是有效 JSON" }, { status: 400 });
    // 两位接粉员同时提交同一号码时，数据库的唯一规则会拦住第二次写入。
    // 这里转换成可理解的撞粉提示，避免把正常业务场景显示成系统故障。
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
      return NextResponse.json({ error: "该号码刚被其他接粉员导入，已作为撞粉处理；请到“扣粉统计”手动登记撞粉数量后提交审核。", code: "PHONE_COLLISION" }, { status: 409 });
    throw error;
  }
}
