import { applyAction, loadState, parseAction, saveState } from "@/lib/server/engine";
import { noStore, toPublic } from "@/lib/server/public";
import { getBaseUrl } from "@/lib/server/url";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const action = parseAction(body);
  if (!action) return Response.json({ error: "Неверное действие" }, { status: 400 });
  const state = await loadState(body?.tz);
  try {
    await applyAction(state, action, getBaseUrl(req));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 409 });
  }
  await saveState(state);
  return Response.json(await toPublic(state), noStore);
}
