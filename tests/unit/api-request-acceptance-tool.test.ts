import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import {
  EXECUTION_CONFIRMATION,
  acceptanceCases,
  buildPlan,
  executeAcceptance,
  jsonProbeOfExactBytes,
  parseOptions,
  validateTarget,
  writeNewPrivateReport,
} from "../../scripts/api-02-boundary-acceptance.mjs";
import { API_LIMITS } from "../../src/lib/request-limits";

const servers: ReturnType<typeof createServer>[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

describe("API-02 local boundary acceptance tool", () => {
  it("defaults to a request-free plan and requires an explicit target", () => {
    expect(() => parseOptions([])).toThrow("--target is required");
    const options = parseOptions(["--target", "http://127.0.0.1:3000"]);
    expect(options).toMatchObject({ execute: false, concurrency: 1, iterations: 1 });
    expect(buildPlan(options.target).mode).toBe("plan-only-no-requests");
    expect(buildPlan(options.target).cases).toHaveLength(acceptanceCases.length);
  });

  it("sends no request when the executable runs without --execute", async () => {
    let requests = 0;
    const server = createServer((_request, response) => {
      requests += 1;
      response.end();
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing test server address");

    const { stdout } = await execFileAsync(process.execPath, [
      "scripts/api-02-boundary-acceptance.mjs",
      "--target",
      `http://127.0.0.1:${address.port}`,
    ]);
    expect(JSON.parse(stdout).mode).toBe("plan-only-no-requests");
    expect(requests).toBe(0);
  });

  it("allows only credential-free loopback origins", () => {
    expect(validateTarget("http://localhost:3000")).toBe("http://localhost:3000");
    expect(validateTarget("http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
    expect(validateTarget("http://[::1]:3000")).toBe("http://[::1]:3000");
    expect(() => validateTarget("https://example.com")).toThrow("must use localhost");
    expect(() => validateTarget("http://user:secret@127.0.0.1:3000")).toThrow("credentials are forbidden");
    expect(() => validateTarget("http://127.0.0.1:3000/api?token=x")).toThrow("only an origin");
  });

  it("requires the exact confirmation and keeps load bounds small", () => {
    expect(() => parseOptions(["--target", "http://127.0.0.1:3000", "--execute"]))
      .toThrow(`--confirm ${EXECUTION_CONFIRMATION}`);
    expect(() => parseOptions(["--target", "http://127.0.0.1:3000", "--execute", "--confirm", EXECUTION_CONFIRMATION, "--concurrency", "9"]))
      .toThrow("between 1 and 8");
    const controlledMarker = "must-not-be-reflected-sensitive-marker";
    expect(() => parseOptions([controlledMarker])).toThrow("unknown option; refusing unrecognized input");
    try { parseOptions([controlledMarker]); } catch (error) {
      expect(String(error)).not.toContain(controlledMarker);
    }
  });

  it("keeps the acceptance route manifest aligned with application byte and row limits", () => {
    expect(acceptanceCases).toEqual([
      { method: "POST", path: "/api/batches", bodyBytes: API_LIMITS.batchBodyBytes, rows: API_LIMITS.batchRows },
      { method: "POST", path: "/api/events", bodyBytes: API_LIMITS.eventBodyBytes, rows: API_LIMITS.eventRows },
      { method: "POST", path: "/api/customer-finance", bodyBytes: API_LIMITS.customerFinanceBodyBytes, rows: API_LIMITS.customerFinanceRows },
      { method: "POST", path: "/api/customer-orders", bodyBytes: API_LIMITS.customerOrderBodyBytes, rows: API_LIMITS.customerOrderRows },
      { method: "PATCH", path: "/api/history", bodyBytes: API_LIMITS.historyBodyBytes, rows: API_LIMITS.historyEventIds },
      { method: "PUT", path: "/api/lead/collaborations", bodyBytes: API_LIMITS.collaborationBodyBytes, rows: API_LIMITS.collaborationRecipients },
      { method: "POST", path: "/api/notifications", bodyBytes: API_LIMITS.notificationBodyBytes, rows: API_LIMITS.notificationRecipients },
      { method: "POST", path: "/api/leads", bodyBytes: API_LIMITS.customerImportBodyBytes, rows: API_LIMITS.customerImportRows },
      { method: "POST", path: "/api/auth/login", bodyBytes: API_LIMITS.loginBodyBytes, rows: null },
      { method: "POST", path: "/api/auth/change-password", bodyBytes: API_LIMITS.loginBodyBytes, rows: null },
    ]);
  });

  it("generates exact byte boundaries without credential-shaped fields", () => {
    for (const size of [8 * 1024, 64 * 1024, 2 * 1024 * 1024]) {
      const body = jsonProbeOfExactBytes(size);
      expect(Buffer.byteLength(body)).toBe(size);
      expect(JSON.parse(body)).toEqual({ probe: "x".repeat(size - 12) });
      expect(body).not.toMatch(/password|token|cookie|authorization/i);
    }
  });

  it("checks every boundary and plus-one response without sending or recording secrets", async () => {
    const limits = new Map(acceptanceCases.map((item) => [item.path, item.bodyBytes]));
    const observedHeaders: Array<Record<string, string | string[] | undefined>> = [];
    const server = createServer((request, response) => {
      observedHeaders.push(request.headers);
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        const size = Buffer.concat(chunks).byteLength;
        const limit = limits.get(request.url ?? "")!;
        response.statusCode = size > limit ? 413 : request.url?.includes("/auth/") ? 400 : 401;
        response.end("response body must not be captured");
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing test server address");

    const report = await executeAcceptance({
      target: `http://127.0.0.1:${address.port}`,
      concurrency: 2,
      iterations: 1,
    });
    expect(report.passed).toBe(true);
    expect(report.requestCount).toBe(acceptanceCases.length * 2);
    expect(report.results.filter((result) => result.kind === "over").every((result) => result.status === 413)).toBe(true);
    expect(JSON.stringify(report)).not.toContain("response body must not be captured");
    for (const headers of observedHeaders) {
      expect(headers.authorization).toBeUndefined();
      expect(headers.cookie).toBeUndefined();
    }
  });

  it("creates a private report without overwriting an existing path", () => {
    const directory = mkdtempSync(join(tmpdir(), "api02-acceptance-"));
    const path = join(directory, "report.json");
    writeNewPrivateReport(path, { safe: true });
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ safe: true });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(() => writeNewPrivateReport(path, { safe: false })).toThrow();
  });
});
