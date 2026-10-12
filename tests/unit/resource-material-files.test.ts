import { describe, expect, it } from "vitest";
import { detectMaterialType, materialFilePath, materialRange, readMaterialForm, MaterialFileError, MAX_MATERIAL_BYTES } from "../../src/lib/resource-material-files";

describe("private material file validation", () => {
  it("validates the actual signature and rejects disguised documents and AVIF", () => {
    expect(detectMaterialType(Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]), "图.png")).toEqual({ mime: "image/png", ext: "png" });
    expect(detectMaterialType(Buffer.from("\0\0\0\x18ftypmp42\0\0\0\0"), "clip.mp4").mime).toBe("video/mp4");
    expect(() => detectMaterialType(Buffer.from("<html><script>alert(1)</script>"), "clip.mp4")).toThrow(MaterialFileError);
    expect(() => detectMaterialType(Buffer.from("\0\0\0\x18ftypavif\0\0\0\0"), "clip.mp4")).toThrow(MaterialFileError);
    expect(() => materialFilePath("../../.env")).toThrow(MaterialFileError);
  });
  it("supports seek and suffix ranges and rejects invalid ranges", () => {
    expect(materialRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
    expect(materialRange("bytes=800-", 1000)).toEqual({ start: 800, end: 999 });
    expect(materialRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
    expect(materialRange("bytes=900-2000", 1000)).toEqual({ start: 900, end: 999 });
    for (const range of ["bytes=-0", "bytes=1000-", "bytes=30-20", "bytes=0-10,20-30", "bytes=-", "anything"]) expect(() => materialRange(range, 1000)).toThrow(MaterialFileError);
  });
  it("bounds multipart bodies including chunked requests without Content-Length", async () => {
    const large = new Request("http://localhost", { method: "POST", headers: { "content-length": String(MAX_MATERIAL_BYTES + 2 * 1024 * 1024) }, body: "x" });
    await expect(readMaterialForm(large)).rejects.toMatchObject({ status: 413 });
    const body = new ReadableStream({ start(controller) { for(let i=0;i<52;i++) controller.enqueue(new Uint8Array(1024*1024)); controller.close(); } });
    const request = new Request("http://localhost", { method: "POST", body, duplex: "half" } as RequestInit);
    await expect(readMaterialForm(request)).rejects.toMatchObject({ status: 413 });
  });
});
