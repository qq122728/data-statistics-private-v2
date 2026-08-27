#!/usr/bin/env node

import { constants as fsConstants, closeSync, openSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const EXECUTION_CONFIRMATION = "API02_LOCAL_BOUNDARY_ACCEPTANCE";
export const MAX_CONCURRENCY = 8;
export const MAX_ITERATIONS = 10;

export const acceptanceCases = Object.freeze([
  { method: "POST", path: "/api/batches", bodyBytes: 256 * 1024, rows: 100 },
  { method: "POST", path: "/api/events", bodyBytes: 256 * 1024, rows: 100 },
  { method: "POST", path: "/api/customer-finance", bodyBytes: 128 * 1024, rows: 100 },
  { method: "POST", path: "/api/customer-orders", bodyBytes: 128 * 1024, rows: 100 },
  { method: "PATCH", path: "/api/history", bodyBytes: 64 * 1024, rows: 100 },
  { method: "PUT", path: "/api/lead/collaborations", bodyBytes: 128 * 1024, rows: 500 },
  { method: "POST", path: "/api/notifications", bodyBytes: 128 * 1024, rows: 500 },
  { method: "POST", path: "/api/leads", bodyBytes: 2 * 1024 * 1024, rows: 2_000 },
  { method: "POST", path: "/api/auth/login", bodyBytes: 8 * 1024, rows: null },
  { method: "POST", path: "/api/auth/change-password", bodyBytes: 8 * 1024, rows: null },
]);

function usage() {
  return `Usage:
  node scripts/api-02-boundary-acceptance.mjs --target http://127.0.0.1:3000
  node scripts/api-02-boundary-acceptance.mjs --target http://127.0.0.1:8080 \\
    --execute --confirm ${EXECUTION_CONFIRMATION} [--concurrency 1] [--iterations 1] [--report /absolute/new-file.json]

Without --execute this command only prints the request plan. It never accepts
credentials, cookies, authorization headers, or custom request bodies.`;
}

function integerOption(value, name, maximum) {
  if (!/^\d+$/.test(value ?? "")) throw new Error(`${name} must be an integer`);
  const parsed = Number(value);
  if (parsed < 1 || parsed > maximum) throw new Error(`${name} must be between 1 and ${maximum}`);
  return parsed;
}

export function parseOptions(argv) {
  const options = { execute: false, concurrency: 1, iterations: 1 };
  const valueOptions = new Set(["--target", "--confirm", "--concurrency", "--iterations", "--report"]);
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--execute") {
      options.execute = true;
      continue;
    }
    if (option === "--help") return { help: true };
    if (!valueOptions.has(option)) throw new Error("unknown option; refusing unrecognized input");
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
    index += 1;
    if (option === "--target") options.target = value;
    else if (option === "--confirm") options.confirm = value;
    else if (option === "--concurrency") options.concurrency = integerOption(value, option, MAX_CONCURRENCY);
    else if (option === "--iterations") options.iterations = integerOption(value, option, MAX_ITERATIONS);
    else if (option === "--report") options.report = value;
  }
  if (!options.target) throw new Error("--target is required even for plan mode");
  options.target = validateTarget(options.target);
  if (!options.execute && options.confirm) throw new Error("--confirm is only valid with --execute");
  if (options.execute && options.confirm !== EXECUTION_CONFIRMATION) {
    throw new Error(`execution requires --confirm ${EXECUTION_CONFIRMATION}`);
  }
  if (options.report && !options.execute) throw new Error("--report is only valid with --execute");
  if (options.report && !options.report.startsWith("/")) throw new Error("--report must be an absolute path");
  return options;
}

export function validateTarget(rawTarget) {
  let target;
  try {
    target = new URL(rawTarget);
  } catch {
    throw new Error("--target must be a valid URL");
  }
  if (!new Set(["http:", "https:"]).has(target.protocol)) throw new Error("target protocol must be http or https");
  if (target.username || target.password) throw new Error("credentials are forbidden in --target");
  if (target.pathname !== "/" || target.search || target.hash) throw new Error("--target must contain only an origin, without path/query/fragment");
  const hostname = target.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "::1") {
    throw new Error("--target must use localhost, 127.0.0.1, or ::1");
  }
  return target.origin;
}

async function assertTargetStillLoopback(target) {
  const hostname = new URL(target).hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname)) return;
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => address !== "127.0.0.1" && address !== "::1")) {
    throw new Error("localhost resolved outside loopback; refusing to send requests");
  }
}

export function jsonProbeOfExactBytes(byteLength) {
  const prefix = '{"probe":"';
  const suffix = '"}';
  const paddingLength = byteLength - Buffer.byteLength(prefix) - Buffer.byteLength(suffix);
  if (paddingLength < 0) throw new Error("byte limit is too small for the generated probe");
  const body = `${prefix}${"x".repeat(paddingLength)}${suffix}`;
  if (Buffer.byteLength(body) !== byteLength) throw new Error("generated probe has the wrong byte length");
  return body;
}

function percentile(values, fraction) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)];
}

async function runRequest(target, testCase, kind) {
  const bodyBytes = testCase.bodyBytes + (kind === "over" ? 1 : 0);
  const started = performance.now();
  const response = await fetch(`${target}${testCase.path}`, {
    method: testCase.method,
    redirect: "manual",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "api-02-local-boundary-acceptance/1",
    },
    body: jsonProbeOfExactBytes(bodyBytes),
    signal: AbortSignal.timeout(15_000),
  });
  // Do not read or print response bodies: they can contain deployment details.
  await response.body?.cancel();
  const latencyMs = Number((performance.now() - started).toFixed(2));
  const passed = kind === "over" ? response.status === 413 : response.status !== 413 && response.status < 500;
  return { path: testCase.path, method: testCase.method, kind, bodyBytes, status: response.status, latencyMs, passed };
}

async function runPool(tasks, concurrency) {
  const results = new Array(tasks.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < tasks.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await tasks[index]();
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

export function buildPlan(target, concurrency = 1, iterations = 1) {
  return {
    mode: "plan-only-no-requests",
    target,
    concurrency,
    iterations,
    cases: acceptanceCases.map(({ method, path, bodyBytes, rows }) => ({
      method,
      path,
      maximumBodyBytes: bodyBytes,
      maximumRows: rows,
      probes: [bodyBytes, bodyBytes + 1],
    })),
    codeEvidenceCommand: "npm run test:api-02:acceptance",
    note: "HTTP probes contain only a generated probe field. Protected-route row limits and pre-database rejection are verified by the code evidence command; authenticated accepted business writes remain manual.",
  };
}

export async function executeAcceptance(options) {
  await assertTargetStillLoopback(options.target);
  const tasks = [];
  for (let iteration = 1; iteration <= options.iterations; iteration += 1) {
    for (const testCase of acceptanceCases) {
      for (const kind of ["boundary", "over"]) {
        tasks.push(async () => ({ iteration, ...(await runRequest(options.target, testCase, kind)) }));
      }
    }
  }
  const startedAt = new Date().toISOString();
  const results = await runPool(tasks, options.concurrency);
  const endedAt = new Date().toISOString();
  const latencies = results.map(({ latencyMs }) => latencyMs);
  return {
    schemaVersion: 1,
    startedAt,
    endedAt,
    target: options.target,
    concurrency: options.concurrency,
    iterations: options.iterations,
    requestCount: results.length,
    passed: results.every(({ passed }) => passed),
    latencyMs: {
      min: Math.min(...latencies),
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      max: Math.max(...latencies),
    },
    results,
    privacy: "No credentials, cookies, authorization headers, custom bodies, response bodies, or response headers were accepted or recorded.",
  };
}

export function writeNewPrivateReport(path, report) {
  const descriptor = openSync(path, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW, 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8" });
  } finally {
    closeSync(descriptor);
  }
}

async function main() {
  let options;
  try {
    options = parseOptions(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      return;
    }
    if (!options.execute) {
      console.log(JSON.stringify(buildPlan(options.target, options.concurrency, options.iterations), null, 2));
      return;
    }
    const report = await executeAcceptance(options);
    if (options.report) writeNewPrivateReport(options.report, report);
    console.log(JSON.stringify({
      passed: report.passed,
      target: report.target,
      requestCount: report.requestCount,
      latencyMs: report.latencyMs,
      reportCreated: Boolean(options.report),
    }, null, 2));
    if (!report.passed) process.exitCode = 1;
  } catch (error) {
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    console.error(usage());
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
