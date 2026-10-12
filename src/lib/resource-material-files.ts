import { randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { resolve, join, extname } from "node:path";

export const MAX_MATERIAL_BYTES = 50 * 1024 * 1024;
export class MaterialFileError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function materialFilePath(key: string) {
  if (!/^[a-f0-9-]{36}\.(mp4|mov|webm|jpg|png|webp|gif)$/.test(key)) throw new MaterialFileError("文件不存在", 404);
  return join(resolve(process.env.RESOURCE_MATERIAL_DIR || "storage/resource-materials"), key);
}
// Enforce the limit even without Content-Length (chunked requests).
export async function readMaterialForm(request: Request) {
  const limit = MAX_MATERIAL_BYTES + 1024 * 1024;
  if (Number(request.headers.get("content-length")) > limit) throw new MaterialFileError("视频不能超过 50 MB，图片不能超过 10 MB", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new MaterialFileError("请提交素材资料");
  const parts: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new MaterialFileError("上传内容过大，请压缩文件后重试", 413); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return await new Response(Buffer.concat(parts), { headers: { "Content-Type": request.headers.get("content-type") || "" } }).formData(); }
  catch { throw new MaterialFileError("上传内容无法读取，请重新选择文件"); }
}
export function detectMaterialType(bytes: Buffer, name: string) {
  const ext = extname(name).toLowerCase();
  if (bytes.length >= 12) {
    if ([".mp4", ".mov"].includes(ext) && bytes.toString("ascii", 4, 8) === "ftyp") {
      const brand = bytes.toString("ascii", 8, 12);
      if (["isom", "iso2", "mp41", "mp42", "avc1", "M4V ", "qt  ", "MSNV", "dash", "iso5", "iso6"].includes(brand)) return { mime: ext === ".mov" ? "video/quicktime" : "video/mp4", ext: ext.slice(1) };
    }
    if (ext === ".webm" && bytes.subarray(0, 4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3])) && bytes.subarray(0, 4096).includes(Buffer.from("webm"))) return { mime: "video/webm", ext: "webm" };
    if ([".jpg", ".jpeg"].includes(ext) && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return { mime: "image/jpeg", ext: "jpg" };
    if (ext === ".png" && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return { mime: "image/png", ext: "png" };
    if (ext === ".webp" && bytes.toString("ascii",0,4) === "RIFF" && bytes.toString("ascii",8,12) === "WEBP") return { mime: "image/webp", ext: "webp" };
    if (ext === ".gif" && ["GIF87a", "GIF89a"].includes(bytes.toString("ascii",0,6))) return { mime: "image/gif", ext: "gif" };
  }
  throw new MaterialFileError("文件格式不支持或内容不正确。请上传 MP4、MOV、WebM 视频，或 JPG、PNG、WebP、GIF 图片");
}
export async function storeMaterialFile(value: FormDataEntryValue | null) {
  if (!(value instanceof File) || !value.size) return null;
  if (value.size > MAX_MATERIAL_BYTES) throw new MaterialFileError("视频不能超过 50 MB", 413);
  const bytes = Buffer.from(await value.arrayBuffer());
  const type = detectMaterialType(bytes, value.name);
  if (type.mime.startsWith("image/") && bytes.length > 10 * 1024 * 1024) throw new MaterialFileError("图片不能超过 10 MB", 413);
  const key = `${randomUUID()}.${type.ext}`;
  const path = materialFilePath(key);
  await mkdir(resolve(path, ".."), { recursive: true, mode: 0o700 });
  await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
  return { fileKey: key, fileName: value.name.split(/[\\/]/).pop()!.replace(/[\x00-\x1f\x7f]/g, "").slice(0, 180) || `素材.${type.ext}`, fileMime: type.mime, fileBytes: bytes.length };
}
export async function removeMaterialFile(key: string | null | undefined) {
  if (key) await unlink(materialFilePath(key)).catch(error => { if (error.code !== "ENOENT") console.error("素材文件清理失败", error.code); });
}
export function materialRange(range: string | null, size: number): { start: number; end: number } | null {
  if (!range) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2])) throw new MaterialFileError("读取范围不正确", 416);
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) throw new MaterialFileError("读取范围不正确", 416);
  return { start, end };
}
