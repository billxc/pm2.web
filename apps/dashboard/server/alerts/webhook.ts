export function validateWebhookUrl(value: string): boolean {
  if (!value || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !!url.hostname && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}

export type WebhookResult = { status: "sent" } | { status: "failed"; error: string };

/** No redirects, no response body, no raw exception text. Never logs the private destination. */
export async function sendWebhook(
  url: string,
  payload: unknown,
  fetcher: typeof fetch = fetch,
  timeoutMs = 3000,
): Promise<WebhookResult> {
  if (!validateWebhookUrl(url)) return { status: "failed", error: "invalid_destination" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      redirect: "error",
      signal: controller.signal,
    });
    // Do not read/store response bodies: they may contain credentials or unbounded content.
    if (response.body) void response.body.cancel().catch(() => {});
    return response.ok ? { status: "sent" } : { status: "failed", error: "http_failure" };
  } catch {
    return { status: "failed", error: controller.signal.aborted ? "timeout" : "network_failure" };
  } finally {
    clearTimeout(timer);
  }
}
