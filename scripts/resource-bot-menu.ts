import { readBotConfig } from "../src/lib/resource-bot/config";
import { syncResourceBotMenu } from "../src/lib/resource-bot/commands";

async function main() {
  const config = await readBotConfig();
  if (!config) throw Error("Missing configuration");
  await syncResourceBotMenu(config);
  console.log("Resource bot scoped commands and private menu verified.");
}
main().catch(() => {
  console.error("Resource bot menu update failed; no credentials logged.");
  process.exitCode = 1;
});
