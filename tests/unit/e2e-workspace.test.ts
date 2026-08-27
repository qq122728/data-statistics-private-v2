import { access, mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error The runtime helper is intentionally plain ESM JavaScript.
import { nextDevArguments, prepareE2EWorkspace } from "../../scripts/start-e2e-server.mjs";

describe("prepareE2EWorkspace", () => {
  it("binds the isolated test server to the local machine", () => {
    expect(nextDevArguments("3011")).toEqual([
      "dev",
      "--webpack",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3011",
    ]);
  });

  it("copies the application into a temporary workspace without changing the source project", async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), "statistics-e2e-source-"));
    const moduleDirectory = join(sourceRoot, "node_modules");
    await mkdir(moduleDirectory);
    await mkdir(join(sourceRoot, "prisma"));
    await writeFile(join(sourceRoot, "next-env.d.ts"), "source declaration");
    await writeFile(join(sourceRoot, "page.tsx"), "export default function Page() {}\n");
    await writeFile(join(sourceRoot, "prisma", "dev.db"), "production data");

    const { workspacePath, cleanup } = await prepareE2EWorkspace(sourceRoot);

    try {
      expect(await readFile(join(sourceRoot, "next-env.d.ts"), "utf8")).toBe("source declaration");
      expect(await readFile(join(workspacePath, "page.tsx"), "utf8")).toBe("export default function Page() {}\n");
      expect((await readFile(join(workspacePath, "next-env.d.ts"), "utf8"))).toBe("source declaration");
      await expect(access(join(workspacePath, "prisma", "dev.db"))).rejects.toThrow();
      expect(await realpath(join(workspacePath, "prisma"))).not.toBe(await realpath(join(sourceRoot, "prisma")));
    } finally {
      await cleanup();
      await rm(sourceRoot, { recursive: true, force: true });
    }
  });
});
