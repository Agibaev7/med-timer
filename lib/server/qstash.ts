import "server-only";
import { Client, Receiver } from "@upstash/qstash";

export const qstashConfigured = Boolean(process.env.QSTASH_TOKEN);

let client: Client | null = null;
function getClient(): Client | null {
  if (!qstashConfigured) return null;
  client ??= new Client({
    token: process.env.QSTASH_TOKEN!,
    // EU-регион: QSTASH_URL, например https://qstash-eu-central-1.upstash.io
    baseUrl: process.env.QSTASH_URL || undefined,
  });
  return client;
}

export interface SendBody {
  kind: "timer" | "test";
  slot?: string;
  timerId?: string;
  nonce?: string;
}

/** Планирует POST на /api/push/send через delaySec секунд. Возвращает messageId. */
export async function schedulePush(
  baseUrl: string,
  body: SendBody,
  delaySec: number,
): Promise<string | undefined> {
  const c = getClient();
  if (!c) {
    console.warn("[qstash] QSTASH_TOKEN не задан — фоновое уведомление не запланировано");
    return undefined;
  }
  try {
    const res = await c.publishJSON({
      url: `${baseUrl}/api/push/send`,
      body,
      delay: Math.max(0, Math.round(delaySec)),
      retries: 3,
    });
    return "messageId" in res ? res.messageId : undefined;
  } catch (e) {
    console.error("[qstash] publish failed", e);
    return undefined;
  }
}

export async function cancelPush(messageId: string | undefined): Promise<void> {
  if (!messageId) return;
  const c = getClient();
  if (!c) return;
  try {
    await c.messages.delete(messageId);
  } catch {
    // Сообщение уже доставлено или удалено — это нормально.
  }
}

/** Проверка подписи QStash (Receiver). url — адрес, на который публиковалось сообщение. */
export async function verifyQStash(req: Request, rawBody: string, url: string): Promise<boolean> {
  const signature = req.headers.get("upstash-signature");
  if (!signature) return false;
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!currentSigningKey || !nextSigningKey) {
    console.error("[qstash] signing keys не заданы");
    return false;
  }
  const receiver = new Receiver({ currentSigningKey, nextSigningKey });
  try {
    return await receiver.verify({ signature, body: rawBody, url, clockTolerance: 5 });
  } catch (e) {
    console.error("[qstash] invalid signature", e);
    return false;
  }
}
