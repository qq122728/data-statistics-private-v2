export const API_LIMITS = {
  batchRows: 100,
  eventRows: 100,
  customerFinanceRows: 100,
  customerOrderRows: 100,
  historyEventIds: 100,
  collaborationRecipients: 500,
  notificationRecipients: 500,
  customerImportRows: 2_000,
  identifierCharacters: 128,
  searchCharacters: 200,
  customerImportTextCharacters: 200_000,
  loginUsernameCharacters: 200,
  loginPasswordCharacters: 256,
  accountDisplayNameCharacters: 100,
  accountReasonCharacters: 500,
  loginBodyBytes: 8 * 1024,
  batchBodyBytes: 256 * 1024,
  eventBodyBytes: 256 * 1024,
  customerFinanceBodyBytes: 128 * 1024,
  customerOrderBodyBytes: 128 * 1024,
  historyBodyBytes: 64 * 1024,
  collaborationBodyBytes: 128 * 1024,
  notificationBodyBytes: 128 * 1024,
  customerImportBodyBytes: 2 * 1024 * 1024,
} as const;

export class RequestBodyTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`请求内容不能超过 ${maxBytes} 字节`);
    this.name = "RequestBodyTooLargeError";
  }
}

/** Read JSON with a byte ceiling, including when Content-Length is absent or false. */
export async function readLimitedJson(request: Request, maxBytes: number): Promise<unknown> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > maxBytes) {
    throw new RequestBodyTooLargeError(maxBytes);
  }

  if (!request.body) return JSON.parse("");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel();
        throw new RequestBodyTooLargeError(maxBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function tooLargeResponse(error: RequestBodyTooLargeError): Response {
  return Response.json(
    { error: `请求内容过大，最大允许 ${error.maxBytes} 字节` },
    { status: 413 },
  );
}

export function rowsLimitError(actual: number, maximum: number, label: string): string | undefined {
  return actual > maximum ? `${label}一次最多提交 ${maximum} 条` : undefined;
}

export function hasOversizedQueryValue(params: URLSearchParams, maximum = API_LIMITS.searchCharacters): boolean {
  return [...params.values()].some((value) => value.length > maximum);
}
