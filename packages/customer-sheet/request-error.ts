export function requestErrorMessage(error: unknown, action = "操作"): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/failed to fetch|networkerror|network request failed|load failed/i.test(message)) {
    return `网络连接失败，填写内容还在页面上。请检查网络后重试；如果仍失败，请刷新后核对是否已经保存。`;
  }
  return message || `${action}失败，请重试`;
}

export async function requestJson<T>(url: string, init?: RequestInit, action = "操作"): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store", ...init });
  } catch (error) {
    throw new Error(requestErrorMessage(error, action));
  }
  let data: T & { error?: string };
  try {
    data = await response.json() as T & { error?: string };
  } catch {
    throw new Error(response.ok ? `${action}结果读取失败，请刷新后核对` : `${action}失败，请重试`);
  }
  if (!response.ok) throw new Error(data.error || `${action}失败，请重试`);
  return data;
}
