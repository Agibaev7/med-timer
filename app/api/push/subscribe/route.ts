import type { PushSubscription } from "web-push";
import { removeSubscription, saveSubscription } from "@/lib/server/push";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { subscription?: PushSubscription } | null;
  const sub = body?.subscription;
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    return Response.json({ error: "Некорректная подписка" }, { status: 400 });
  }
  await saveSubscription({ endpoint: sub.endpoint, keys: sub.keys });
  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const body = (await req.json().catch(() => null)) as { endpoint?: string } | null;
  if (body?.endpoint) await removeSubscription(body.endpoint);
  return Response.json({ ok: true });
}
