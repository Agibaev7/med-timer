import type { SlotId } from "@/lib/meds";
import { armReminder, loadState, pushPayloadFor, saveState } from "@/lib/server/engine";
import { sendToAll } from "@/lib/server/push";
import { verifyQStash, type SendBody } from "@/lib/server/qstash";
import { getBaseUrl } from "@/lib/server/url";

export const dynamic = "force-dynamic";

/** Callback от QStash: отправляет Web Push. Доступ только с валидной подписью. */
export async function POST(req: Request) {
  const raw = await req.text();
  const baseUrl = getBaseUrl(req);
  if (!(await verifyQStash(req, raw, `${baseUrl}/api/push/send`))) {
    return Response.json({ error: "invalid signature" }, { status: 401 });
  }
  let body: SendBody;
  try {
    body = JSON.parse(raw) as SendBody;
  } catch {
    return Response.json({ error: "bad body" }, { status: 400 });
  }

  if (body.kind === "test") {
    const r = await sendToAll({
      title: "✅ Фоновые уведомления работают",
      body: "Это сообщение пришло через QStash, даже при закрытом приложении",
      tag: "med-test",
      url: "/",
    });
    return Response.json(r);
  }

  const state = await loadState();
  const t = state.timers[body.slot as SlotId];
  // Сообщение устарело (приём уже отмечен, отложен или цепочка сброшена)
  if (!t || t.id !== body.timerId || t.nonce !== body.nonce) {
    return Response.json({ skipped: true });
  }

  const isReminder = (t.reminders ?? 0) > 0 || Date.now() - t.dueAt > 60_000;
  const result = await sendToAll(pushPayloadFor(t, isReminder));
  await armReminder(t, baseUrl);
  await saveState(state);
  return Response.json(result);
}
