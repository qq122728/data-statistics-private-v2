#!/usr/bin/env node

import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const [sourcePath, templatePath, outputPath] = process.argv.slice(2);
if (!sourcePath || !templatePath || !outputPath) {
  throw new Error("usage: render-pgbackrest-config.mjs <secret-env> <template> <output>");
}

const required = [
  "PGBACKREST_PG1_PATH",
  "PGBACKREST_REPO1_PATH",
  "PGBACKREST_S3_BUCKET",
  "PGBACKREST_S3_ENDPOINT",
  "PGBACKREST_S3_REGION",
  "PGBACKREST_S3_URI_STYLE",
  "PGBACKREST_S3_KEY",
  "PGBACKREST_S3_KEY_SECRET",
  "PGBACKREST_REPO1_CIPHER_PASS",
];

function parseEnv(text) {
  const result = new Map();
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) throw new Error(`invalid secret env line ${index + 1}`);
    const name = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (value.includes("\n") || value.includes("\r")) throw new Error(`newline rejected for ${name}`);
    result.set(name, value);
  }
  return result;
}

const secrets = parseEnv(await readFile(resolve(sourcePath), "utf8"));
for (const name of required) {
  const value = secrets.get(name);
  if (!value || value.startsWith("replace-with-")) throw new Error(`missing production value for ${name}`);
}
if (!new Set(["host", "path"]).has(secrets.get("PGBACKREST_S3_URI_STYLE"))) {
  throw new Error("PGBACKREST_S3_URI_STYLE must be host or path");
}
if (secrets.get("PGBACKREST_REPO1_CIPHER_PASS").length < 32) {
  throw new Error("PGBACKREST_REPO1_CIPHER_PASS must contain at least 32 characters from the secret manager");
}

let rendered = await readFile(resolve(templatePath), "utf8");
for (const name of required) {
  rendered = rendered.replaceAll(`\${${name}}`, secrets.get(name));
}
if (/\$\{PGBACKREST_[A-Z0-9_]+\}/.test(rendered)) throw new Error("unresolved pgBackRest placeholder");

const absoluteOutput = resolve(outputPath);
const temporary = `${absoluteOutput}.tmp-${process.pid}`;
await writeFile(temporary, rendered, { mode: 0o640, flag: "wx" });
await chmod(temporary, 0o640);
await rename(temporary, absoluteOutput);
process.stdout.write(`wrote pgBackRest config under ${dirname(absoluteOutput)} (credentials redacted)\n`);
