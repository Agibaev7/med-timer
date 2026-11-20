import { pushConfigured, sendToAll } from "@/lib/server/push";
import { qstashConfigured, schedulePush } from "@/lib/server/qstash";
import { getBaseUrl } from "@/lib/server/url";

export const dynamic = "force-dynamic";

const TEST_PAYLOAD = {
  title: "✅ Уведомления работают",
  body: "Так будут выглядеть напоминания о приёме лекарств",
  tag: "med-test",
  url: "/",
};

export async function POST(req: Request) {
  if (!pushConfigured) {
    return Response.json({ error: "На сервере не заданы VAPID-ключи" }, { status: 500 });
  }
  const body = (await req.json().catch(() => ({}))) as { delaySec?: number };
  const delaySec = Math.min(300, Math.max(0, Number(body.delaySec) || 0));

  if (delaySec > 0) {
    if (!qstashConfigured) {
      return Response.json({ error: "QStash не настроен (QSTASH_TOKEN)" }, { status: 500 });
    }
    const id = await schedulePush(getBaseUrl(req), { kind: "test" }, delaySec);
    if (!id) return Response.json({ error: "Не удалось запланировать в QStash" }, { status: 502 });
    return Response.json({ ok: true, scheduled: true, messageId: id });
  }

  const result = await sendToAll(TEST_PAYLOAD);
  if (result.total === 0) {
    return Response.json({ error: "Нет сохранённых подписок — включите уведомления" }, { status: 404 });
  }
  if (result.sent === 0) {
    return Response.json(
      { error: `Push-сервис отклонил отправку: ${result.errors[0] ?? "подписка устарела, включите уведомления заново"}` },
      { status: 502 },
    );
  }
  return Response.json({ ok: true, ...result });
}
