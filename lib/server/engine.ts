import "server-only";
import {
  COURSES,
  COURSE_IDS,
  ITOMED_REPEAT_HOURS,
  SLOTS,
  SNOOZE_MIN,
  STEPS,
  nextStep,
  type ActiveTimer,
  type AppState,
  type CourseId,
  type Mode,
  type SlotId,
} from "@/lib/meds";
import { KEYS, kv } from "./store";
import { cancelPush, schedulePush } from "./qstash";

const MIN = 60_000;
/** Повторные напоминания, если приём не отмечен */
export const REMIND_EVERY_MIN = 10;
export const MAX_REMINDERS = 3;
const DEFAULT_TZ = "Europe/Moscow";

const rid = () => crypto.randomUUID();

function validTz(tz: unknown): string | null {
  if (typeof tz !== "string" || !tz) return null;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

export function dayKey(ts: number, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ts));
}

const dayNum = (key: string) => Math.round(Date.parse(`${key}T00:00:00Z`) / 86_400_000);

function defaultState(tz: string): AppState {
  const now = Date.now();
  return {
    mode: "pills",
    tz,
    timers: {},
    courses: Object.fromEntries(
      COURSE_IDS.map((id) => [id, { remaining: COURSES[id].days, active: true }]),
    ) as AppState["courses"],
    courseDay: dayKey(now, tz),
    dripDays: 0,
    history: [],
    updatedAt: now,
  };
}

/** Автоматическое уменьшение остатка дней курса при смене календарного дня. */
function tick(state: AppState, now: number): boolean {
  const today = dayKey(now, state.tz);
  const diff = dayNum(today) - dayNum(state.courseDay);
  if (diff <= 0) {
    if (diff < 0) state.courseDay = today; // смена часового пояса назад
    return diff < 0;
  }
  for (const id of COURSE_IDS) {
    const c = state.courses[id];
    if (!c.active) continue;
    if (id === "pan" && state.mode === "drips") continue;
    c.remaining = Math.max(0, c.remaining - diff);
  }
  if (state.mode === "drips") state.dripDays += diff;
  state.courseDay = today;
  return true;
}

export async function loadState(tzHint?: unknown): Promise<AppState> {
  const tz = validTz(tzHint);
  let state = await kv.get<AppState>(KEYS.state);
  let dirty = false;
  if (!state) {
    state = defaultState(tz ?? DEFAULT_TZ);
    dirty = true;
  } else {
    // миграция на случай новых курсов
    for (const id of COURSE_IDS) {
      state.courses[id] ??= { remaining: COURSES[id].days, active: true };
    }
    state.timers ??= {};
    state.history ??= [];
  }
  if (tz && tz !== state.tz) {
    state.tz = tz;
    dirty = true;
  }
  if (tick(state, Date.now())) dirty = true;
  if (dirty) await saveState(state);
  return state;
}

export async function saveState(state: AppState) {
  state.updatedAt = Date.now();
  await kv.set(KEYS.state, state);
}

async function arm(timer: ActiveTimer, baseUrl: string, delayMs: number) {
  timer.nonce = rid();
  timer.msgId = await schedulePush(
    baseUrl,
    { kind: "timer", slot: timer.slot, timerId: timer.id, nonce: timer.nonce },
    delayMs / 1000,
  );
}

async function disarm(timer: ActiveTimer | undefined) {
  if (timer) await cancelPush(timer.msgId);
}

function newTimer(slot: SlotId, step: ActiveTimer["step"], dueAt: number): ActiveTimer {
  return { id: rid(), slot, step, dueAt, startedAt: Date.now(), reminders: 0 };
}

export type Action =
  | { type: "start"; slot: SlotId }
  | { type: "taken"; slot: SlotId }
  | { type: "snooze"; slot: SlotId }
  | { type: "reset"; slot: SlotId }
  | { type: "mode"; mode: Mode }
  | { type: "course"; course: CourseId; delta?: number; set?: number; active?: boolean }
  | { type: "courseResetAll" };

const SLOT_IDS = Object.keys(SLOTS) as SlotId[];

export function parseAction(raw: unknown): Action | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  const slotOk = typeof a.slot === "string" && SLOT_IDS.includes(a.slot as SlotId);
  switch (a.type) {
    case "start":
      return slotOk && a.slot !== "itomed" ? (a as Action) : null;
    case "taken":
    case "snooze":
    case "reset":
      return slotOk ? (a as Action) : null;
    case "mode":
      return a.mode === "pills" || a.mode === "drips" ? (a as Action) : null;
    case "course":
      return typeof a.course === "string" && COURSE_IDS.includes(a.course as CourseId)
        ? (a as Action)
        : null;
    case "courseResetAll":
      return a as Action;
    default:
      return null;
  }
}

export async function applyAction(state: AppState, action: Action, baseUrl: string) {
  const now = Date.now();
  switch (action.type) {
    case "start": {
      await disarm(state.timers[action.slot]);
      const t = newTimer(action.slot, SLOTS[action.slot].firstStep, now);
      // Первый приём — сразу. Если не отмечен, напомним через REMIND_EVERY_MIN.
      await arm(t, baseUrl, REMIND_EVERY_MIN * MIN);
      state.timers[action.slot] = t;
      break;
    }
    case "taken": {
      const t = state.timers[action.slot];
      if (!t) throw new Error("Нет активного таймера");
      await disarm(t);
      state.history.unshift({ step: t.step, at: now });
      state.history = state.history.slice(0, 40);

      const n = nextStep(t.step, state.mode);
      if (n) {
        const nt = newTimer(action.slot, n.step, now + n.delayMin * MIN);
        await arm(nt, baseUrl, n.delayMin * MIN);
        state.timers[action.slot] = nt;
      } else {
        delete state.timers[action.slot];
      }

      if (t.step === "m_itomed") {
        // Независимый таймер следующего приёма Итомеда через 8 часов
        await disarm(state.timers.itomed);
        const delay = ITOMED_REPEAT_HOURS * 60 * MIN;
        const it = newTimer("itomed", "i_itomed", now + delay);
        await arm(it, baseUrl, delay);
        state.timers.itomed = it;
      }
      break;
    }
    case "snooze": {
      const t = state.timers[action.slot];
      if (!t) throw new Error("Нет активного таймера");
      await disarm(t);
      t.dueAt = Math.max(t.dueAt, now) + SNOOZE_MIN * MIN;
      t.reminders = 0;
      await arm(t, baseUrl, t.dueAt - now);
      break;
    }
    case "reset": {
      await disarm(state.timers[action.slot]);
      delete state.timers[action.slot];
      break;
    }
    case "mode": {
      state.mode = action.mode;
      break;
    }
    case "course": {
      const c = state.courses[action.course];
      const max = 365;
      if (typeof action.set === "number") c.remaining = action.set;
      if (typeof action.delta === "number") c.remaining += action.delta;
      c.remaining = Math.min(max, Math.max(0, Math.round(c.remaining)));
      if (typeof action.active === "boolean") c.active = action.active;
      break;
    }
    case "courseResetAll": {
      for (const id of COURSE_IDS) state.courses[id] = { remaining: COURSES[id].days, active: true };
      state.dripDays = 0;
      state.courseDay = dayKey(now, state.tz);
      break;
    }
  }
}

export function pushPayloadFor(t: ActiveTimer, isReminder: boolean) {
  const s = STEPS[t.step];
  const slot = SLOTS[t.slot];
  return {
    title: `${isReminder ? "⏰ Напоминание: " : "💊 "}${s.title}`,
    body: `${s.dose} · ${slot.emoji} ${slot.label}${s.meal ? "" : "\nОткройте и нажмите «Выпил»"}`,
    tag: `med-${t.slot}`,
    url: "/",
  };
}

/** Повторное напоминание после отправки пуша, пока приём не отмечен. */
export async function armReminder(t: ActiveTimer, baseUrl: string) {
  if ((t.reminders ?? 0) >= MAX_REMINDERS) {
    t.msgId = undefined;
    return;
  }
  t.reminders = (t.reminders ?? 0) + 1;
  await arm(t, baseUrl, REMIND_EVERY_MIN * MIN);
}
