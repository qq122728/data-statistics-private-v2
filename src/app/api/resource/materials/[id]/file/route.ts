import { NextResponse } from "next/server";
import { open } from "node:fs/promises";
import { buyerAccess } from "../../../../../../lib/resource-buyer-access";
import { db } from "../../../../../../lib/db";
import { recordAudit } from "../../../../../../lib/audit";
import { MaterialFileError, materialFilePath, materialRange, readMaterialForm, storeMaterialFile, removeMaterialFile } from "../../../../../../lib/resource-material-files";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
const noStore = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(request: Request, context: Context) {
  const scope = await buyerAccess(); if (scope instanceof NextResponse) return scope;
  const { id } = await context.params;
  const material = await db.resourceBuyerMaterial.findUnique({ where: { id } });
  if (!material || !scope.channelIds.includes(material.channelId)) return NextResponse.json({ error: "无权访问该素材" }, { status: 403 });
  if (!material.fileKey || !material.fileMime) return NextResponse.json({ error: "该素材没有上传文件" }, { status: 404 });
  let handle;
  try {
    handle = await open(materialFilePath(material.fileKey), "r");
    const { size } = await handle.stat();
    let range;
    try { range = materialRange(request.headers.get("range"), size); }
    catch { await handle.close(); return new Response(null, { status: 416, headers: { ...noStore, "Content-Range": `bytes */${size}` } }); }
    const start = range?.start ?? 0, end = range?.end ?? size - 1;
    const length = end - start + 1;
    const bytes = Buffer.alloc(length); let offset = 0;
    while (offset < length) { const result = await handle.read(bytes, offset, length - offset, start + offset); if (!result.bytesRead) break; offset += result.bytesRead; }
    await handle.close(); handle = undefined;
    const download = new URL(request.url).searchParams.has("download");
    return new Response(bytes, { status: range ? 206 : 200, headers: {
      ...noStore, "Content-Type": material.fileMime, "Content-Length": String(offset), "Accept-Ranges": "bytes",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(material.fileName || "material")}`,
      ...(range ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
    } });
  } catch (error) {
    if (handle) await handle.close();
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return NextResponse.json({ error: "素材文件已丢失，请重新上传" }, { status: 404 });
    throw error;
  }
}

export async function PUT(request: Request, context: Context) {
  const scope = await buyerAccess(); if (scope instanceof NextResponse) return scope;
  const { id } = await context.params;
  const material = await db.resourceBuyerMaterial.findUnique({ where: { id } });
  if (!scope.canWrite || !material || !scope.channels.some(channel => channel.id === material.channelId && channel.channelType === "ADS")) return NextResponse.json({ error: "无权修改该素材" }, { status: 403 });
  let stored: Awaited<ReturnType<typeof storeMaterialFile>> = null;
  try {
    const form = await readMaterialForm(request);
    stored = await storeMaterialFile(form.get("file"));
    if (!stored) throw new MaterialFileError("请选择要上传的视频或图片");
    await db.$transaction(async tx => {
      const saved = await tx.resourceBuyerMaterial.updateMany({ where: { id, fileKey: material.fileKey }, data: stored! });
      if (saved.count !== 1) throw new MaterialFileError("素材刚被其他人修改，请刷新后重试", 409);
      await recordAudit(tx, { actorId: scope.actorId, action: "RESOURCE_BUYER_MATERIAL_FILE_UPDATED", entityType: "ResourceBuyerMaterial", entityId: id, summary: { channelId: material.channelId, fileBytes: stored!.fileBytes } });
    });
    await removeMaterialFile(material.fileKey);
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch (error) {
    await removeMaterialFile(stored?.fileKey);
    if (error instanceof MaterialFileError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("素材文件保存失败", error);
    return NextResponse.json({ error: "文件保存失败，请重试" }, { status: 500 });
  }
}
