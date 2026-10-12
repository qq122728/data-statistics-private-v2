import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";
const out = "outputs/resource-bot/runtime";
await mkdir(out, { recursive: true });
await build({
  entryPoints: ["scripts/resource-bot.ts"],
  bundle: true,
  platform: "node",
  packages: "external",
  format: "cjs",
  outfile: out + "/worker.cjs",
});
await build({
  entryPoints: ["scripts/resource-bot-menu.ts"],
  bundle: true,
  platform: "node",
  packages: "external",
  format: "cjs",
  outfile: out + "/menu.cjs",
});
await build({
  entryPoints: ["scripts/resource-hermes-bridge.ts"], bundle: true, platform: "node",
  packages: "external", format: "cjs", outfile: out + "/bridge.cjs",
});
for (const name of ["package.json", "package-lock.json"])
  await copyFile("integrations/resource-bot/" + name, out + "/" + name);
console.log("Built standalone resource bot runtime in " + out);
await build({
  entryPoints: ["scripts/resource-daily-report.ts"], bundle: true, platform: "node",
  packages: "external", format: "cjs", outfile: out + "/daily.cjs",
});
