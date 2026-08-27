export function entryError(result: unknown, fallback = "保存失败"): string {
  if (!result || typeof result !== "object") return fallback;
  const response = result as { error?: unknown; fields?: Record<string, unknown> };
  const fieldError = Object.values(response.fields ?? {}).flat().find((message) => typeof message === "string");
  return typeof fieldError === "string" ? fieldError : typeof response.error === "string" ? response.error : fallback;
}

export function entryFieldErrors(result: unknown): Record<string, string> {
  if (!result || typeof result !== "object") return {};
  const fields = (result as { fields?: unknown }).fields;
  if (!fields || typeof fields !== "object") return {};
  return Object.fromEntries(Object.entries(fields).flatMap(([field, messages]) => {
    const message = Array.isArray(messages) ? messages.find((item) => typeof item === "string") : undefined;
    const localField = field.replace(/^(?:rows|batches)\./, "");
    return typeof message === "string" ? [[localField, message]] : [];
  }));
}

export type EventFieldOrigin = { rowIndex: number; valueField: string };

export function entryEventFieldErrors(result: unknown, origins: EventFieldOrigin[]): Record<string, string> {
  return Object.fromEntries(Object.entries(entryFieldErrors(result)).map(([field, message]) => {
    const match = /^(\d+)\.(.+)$/.exec(field);
    if (!match) return [field, message];
    const origin = origins[Number(match[1])];
    if (!origin) return [field, message];
    const apiField = match[2];
    const localField = apiField === "batchId" || apiField === "occurredOn" ? apiField : origin.valueField;
    return [`${origin.rowIndex}.${localField}`, message];
  }));
}

import type { ReactNode } from "react";
