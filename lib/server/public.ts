import "server-only";
import type { AppState, PublicState } from "@/lib/meds";
import { listSubscriptions, pushConfigured } from "./push";
import { qstashConfigured } from "./qstash";
import { redisConfigured } from "./store";

export async function toPublic(state: AppState): Promise<PublicState & { storage: string }> {
  const subs = await listSubscriptions().catch(() => []);
  const timers = Object.fromEntries(
    Object.entries(state.timers).map(([k, t]) => [k, { ...t, nonce: undefined, msgId: undefined }]),
  );
  return {
    ...state,
    timers,
    pushConfigured,
    qstashConfigured,
    subscriptions: subs.length,
    serverNow: Date.now(),
    storage: redisConfigured ? "redis" : "memory",
  };
}

export const noStore = { headers: { "Cache-Control": "no-store" } };
