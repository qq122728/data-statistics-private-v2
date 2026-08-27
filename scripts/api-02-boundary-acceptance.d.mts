export const EXECUTION_CONFIRMATION: "API02_LOCAL_BOUNDARY_ACCEPTANCE";
export const MAX_CONCURRENCY: 8;
export const MAX_ITERATIONS: 10;

export type AcceptanceCase = {
  method: "POST" | "PATCH" | "PUT";
  path: string;
  bodyBytes: number;
  rows: number | null;
};

export const acceptanceCases: readonly AcceptanceCase[];

export type AcceptanceOptions = {
  help?: boolean;
  target: string;
  execute: boolean;
  confirm?: string;
  concurrency: number;
  iterations: number;
  report?: string;
};

export type AcceptanceResult = {
  iteration: number;
  path: string;
  method: string;
  kind: "boundary" | "over";
  bodyBytes: number;
  status: number;
  latencyMs: number;
  passed: boolean;
};

export type AcceptanceReport = {
  schemaVersion: number;
  startedAt: string;
  endedAt: string;
  target: string;
  concurrency: number;
  iterations: number;
  requestCount: number;
  passed: boolean;
  latencyMs: { min: number; p50: number; p95: number; max: number };
  results: AcceptanceResult[];
  privacy: string;
};

export function parseOptions(argv: string[]): AcceptanceOptions;
export function validateTarget(rawTarget: string): string;
export function jsonProbeOfExactBytes(byteLength: number): string;
export function buildPlan(target: string, concurrency?: number, iterations?: number): Record<string, unknown>;
export function executeAcceptance(options: Pick<AcceptanceOptions, "target" | "concurrency" | "iterations">): Promise<AcceptanceReport>;
export function writeNewPrivateReport(path: string, report: unknown): void;
