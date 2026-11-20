import { loadState } from "@/lib/server/engine";
import { noStore, toPublic } from "@/lib/server/public";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const tz = new URL(req.url).searchParams.get("tz");
  const state = await loadState(tz);
  return Response.json(await toPublic(state), noStore);
}
