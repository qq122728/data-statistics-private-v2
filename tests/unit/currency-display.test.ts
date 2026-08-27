import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { formatUsd } from "../../src/lib/money";

async function frontendSources(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const sources = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return frontendSources(path);
    return [".ts", ".tsx"].includes(extname(entry.name))
      ? [await readFile(path, "utf8")]
      : [];
  }));
  return sources.flat();
}

describe("frontend currency display", () => {
  it("uses dollar signs for values and 美元 for field units", async () => {
    const root = fileURLToPath(new URL("../../src/", import.meta.url));
    const sources = (await Promise.all([
      frontendSources(join(root, "components")),
      frontendSources(join(root, "app")),
      readFile(join(root, "lib/metrics.ts"), "utf8").then((source) => [source]),
    ])).flat().join("\n");

    expect(sources).not.toMatch(/¥|人民币|（元）|\d(?:\.\d+)? 元|非负元金额/);
    expect(sources).not.toMatch(/（\$）|placeholder=["'`]金额 \$|placeholder=["'`]首充 \$/);
    expect(sources).toContain("（美元）");
    expect(formatUsd(0)).toBe("$0.00");
  });
});
