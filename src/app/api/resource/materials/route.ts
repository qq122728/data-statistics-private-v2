import { NextResponse } from "next/server";
import { buyerAccess } from "../../../../lib/resource-buyer-access";
import { db } from "../../../../lib/db";
import { recordAudit } from "../../../../lib/audit";
import { materialLink } from "../../../../lib/resource-material-link";
import { MaterialFileError, readMaterialForm, storeMaterialFile, removeMaterialFile } from "../../../../lib/resource-material-files";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const scope = await buyerAccess();
  if (scope instanceof NextResponse) return scope;
  if (!scope.canWrite) return NextResponse.json({ error: "只有对应资源负责人可以创建素材" }, { status: 403 });
  let stored: Awaited<ReturnType<typeof storeMaterialFile>> = null;
  try {
    const form = await readMaterialForm(request);
    const channelId = String(form.get("channelId") ?? "");
    if (!scope.channels.some(channel => channel.id === channelId && channel.channelType === "ADS")) throw new MaterialFileError("请选择有权限的投流渠道", 403);
    const buyerName = String(form.get("buyer") ?? "").trim();
    const name = String(form.get("name") ?? "").trim();
    if (!name || name.length > 100 || !buyerName || buyerName.length > 100) throw new MaterialFileError("投手和素材名称必填，最多 100 个字");
    let url: string | null;
    try { url = materialLink(form.get("url")); } catch (error) { throw new MaterialFileError((error as Error).message); }
    stored = await storeMaterialFile(form.get("file"));
    const material = await db.$transaction(async tx => {
      const buyer = await tx.trafficBuyer.upsert({ where: { channelId_name: { channelId, name: buyerName } }, update: { active: true }, create: { channelId, name: buyerName } });
      const created = await tx.resourceBuyerMaterial.create({ data: { channelId, buyerId: buyer.id, name, url, ...stored, createdById: scope.actorId } });
      await recordAudit(tx, { actorId: scope.actorId, action: "RESOURCE_BUYER_MATERIAL_CREATED", entityType: "ResourceBuyerMaterial", entityId: created.id, summary: { channelId, name, buyer: buyerName, hasLink: Boolean(url), fileBytes: stored?.fileBytes ?? 0 } });
      return created;
    });
    return NextResponse.json({ material }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    await removeMaterialFile(stored?.fileKey);
    if (error instanceof MaterialFileError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") return NextResponse.json({ error: "这个投手已有同名素材，请使用其他名称" }, { status: 409 });
    console.error("素材创建失败", error);
    return NextResponse.json({ error: "素材保存失败，请重试" }, { status: 500 });
  }
}
