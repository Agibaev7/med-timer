import "server-only";
import { sendNotification, type PushSubscription } from "web-push";
import { KEYS, kv } from "./store";

const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;
const subject = process.env.VAPID_SUBJECT || "mailto:admin@example.com";

export const pushConfigured = Boolean(publicKey && privateKey);


export interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  url?: string;
}

export async function saveSubscription(sub: PushSubscription) {
  await kv.hset(KEYS.subs, sub.endpoint, sub);
}

export async function removeSubscription(endpoint: string) {
  await kv.hdel(KEYS.subs, endpoint);
}

export async function listSubscriptions(): Promise<PushSubscription[]> {
  const all = await kv.hgetall<PushSubscription | string>(KEYS.subs);
  if (!all) return [];
  return Object.values(all).map((v) => (typeof v === "string" ? JSON.parse(v) : v));
}

export async function sendToAll(payload: PushPayload) {
  if (!pushConfigured) throw new Error("VAPID-ключи не настроены");
  const subs = await listSubscriptions();
  let sent = 0;
  let removed = 0;
  const errors: string[] = [];
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await sendNotification(sub, JSON.stringify(payload), {
          vapidDetails: { subject, publicKey: publicKey!, privateKey: privateKey! },
          TTL: 60 * 60,
          urgency: "high",
          topic: payload.tag?.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || undefined,
        });
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await removeSubscription(sub.endpoint);
          removed++;
        } else {
          errors.push(`${status ?? ""} ${(e as Error).message}`.trim());
        }
      }
    }),
  );
  return { total: subs.length, sent, removed, errors };
}
