"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CHAIN_SLOTS,
  COURSES,
  COURSE_IDS,
  SLOTS,
  SNOOZE_MIN,
  STEPS,
  chainLength,
  planFrom,
  stepIndex,
  type ActiveTimer,
  type CourseId,
  type Mode,
  type SlotId,
} from "@/lib/meds";
import {
  beep,
  daysWord,
  fetchState,
  fmtCountdown,
  fmtTime,
  postAction,
  postJson,
  unlockAudio,
  type ClientState,
} from "@/lib/client";
import { usePush } from "./usePush";

type Tab = "timers" | "course";

const SLOT_ORDER: SlotId[] = ["morning", "itomed", "lunch", "dinner"];

export default function MedApp() {
  const [state, setState] = useState<ClientState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("timers");
  const [pending, setPending] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const now = useNow();

  const accept = useCallback((s: ClientState) => {
    setOffset(s.serverNow - Date.now());
    setState(s);
    setLoadError(null);
  }, []);

  const refresh = useCallback(async () => {
    try {
      accept(await fetchState());
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [accept]);

  // Загрузка, периодическое обновление, обновление при возврате в приложение и при пуше
  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const iv = setInterval(refresh, 30_000);
    const onVis = () => document.visibilityState === "visible" && refresh();
    const onMsg = (e: MessageEvent) => {
      if ((e.data as { type?: string })?.type === "push") {
        beep();
        refresh();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    navigator.serviceWorker?.addEventListener("message", onMsg);
    return () => {
      clearTimeout(first);
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVis);
      navigator.serviceWorker?.removeEventListener("message", onMsg);
    };
  }, [refresh]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const act = useCallback(
    async (key: string, action: Record<string, unknown>, msg?: string) => {
      unlockAudio();
      setPending(key);
      try {
        accept(await postAction(action));
        if (msg) setToast(msg);
      } catch (e) {
        setToast(`⚠️ ${(e as Error).message}`);
      } finally {
        setPending(null);
      }
    },
    [accept],
  );

  const serverNow = now + offset;

  // Звук, когда таймер дошёл до нуля при открытом приложении
  const dueSeen = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!state) return;
    for (const t of Object.values(state.timers)) {
      if (!t || dueSeen.current.has(t.id)) continue;
      if (t.dueAt <= serverNow) {
        dueSeen.current.add(t.id);
        if (serverNow - t.dueAt < 5_000) beep();
      }
    }
  }, [state, serverNow]);

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      <Header
        mode={state?.mode ?? "pills"}
        dripDays={state?.dripDays ?? 0}
        disabled={!state || pending !== null}
        onMode={(mode) =>
          act("mode", { type: "mode", mode }, mode === "pills" ? "Режим: таблетки" : "Режим: капельницы")
        }
      />

      <main className="flex-1 space-y-4 px-4 pb-32 pt-2">
        {loadError && (
          <Banner tone="red">
            Нет связи с сервером: {loadError}.{" "}
            <button className="font-semibold underline" onClick={refresh}>
              Повторить
            </button>
          </Banner>
        )}
        {state?.storage === "memory" && (
          <Banner tone="amber">
            Redis не настроен — данные хранятся временно. Задайте UPSTASH_REDIS_REST_URL и
            UPSTASH_REDIS_REST_TOKEN.
          </Banner>
        )}

        <PushCard state={state} onToast={setToast} />

        {!state && !loadError && <Skeleton />}

        {state && tab === "timers" && (
          <TimersView state={state} serverNow={serverNow} pending={pending} act={act} />
        )}
        {state && tab === "course" && <CourseView state={state} pending={pending} act={act} />}
      </main>

      <TabBar tab={tab} onTab={setTab} activeCount={state ? Object.keys(state.timers).length : 0} />

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-28 z-50 flex justify-center px-4">
          <div className="rounded-2xl bg-slate-900/90 px-4 py-3 text-center text-[15px] font-medium text-white shadow-lg backdrop-blur dark:bg-white/90 dark:text-slate-900">
            {toast}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);
  return now;
}

function Header(props: {
  mode: Mode;
  dripDays: number;
  disabled: boolean;
  onMode: (m: Mode) => void;
}) {
  return (
    <header className="pt-safe sticky top-0 z-30 bg-[var(--bg)]/85 px-4 pb-3 backdrop-blur-xl">
      <div className="flex items-end justify-between gap-3 pt-2">
        <div>
          <h1 className="text-[28px] font-bold leading-tight tracking-tight">Лекарства</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Пантопразол
            {props.mode === "drips" && props.dripDays > 0
              ? ` · капельницы ${props.dripDays} ${daysWord(props.dripDays)}`
              : ""}
          </p>
        </div>
      </div>
      <div
        role="radiogroup"
        aria-label="Режим Пантопразола"
        className="mt-3 grid grid-cols-2 rounded-2xl bg-slate-200/70 p-1 dark:bg-slate-800"
      >
        {(
          [
            ["pills", "💊 Таблетки"],
            ["drips", "💧 Капельницы"],
          ] as const
        ).map(([m, label]) => {
          const on = props.mode === m;
          return (
            <button
              key={m}
              role="radio"
              aria-checked={on}
              disabled={props.disabled || on}
              onClick={() => props.onMode(m)}
              className={`h-11 rounded-xl text-[15px] font-semibold transition ${
                on
                  ? "bg-white text-slate-900 shadow-sm dark:bg-slate-600 dark:text-white"
                  : "text-slate-500 dark:text-slate-400"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
    </header>
  );
}

function Banner({ tone, children }: { tone: "red" | "amber" | "blue"; children: React.ReactNode }) {
  const cls = {
    red: "bg-rose-50 text-rose-800 dark:bg-rose-950/60 dark:text-rose-200",
    amber: "bg-amber-50 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200",
    blue: "bg-sky-50 text-sky-900 dark:bg-sky-950/60 dark:text-sky-200",
  }[tone];
  return <div className={`rounded-2xl px-4 py-3 text-[14px] leading-snug ${cls}`}>{children}</div>;
}

function Skeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-20 animate-pulse rounded-3xl bg-slate-200/70 dark:bg-slate-800" />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

function PushCard({ state, onToast }: { state: ClientState | null; onToast: (s: string) => void }) {
  const push = usePush();
  const [testing, setTesting] = useState<"now" | "later" | null>(null);

  const test = async (delaySec: number) => {
    setTesting(delaySec ? "later" : "now");
    try {
      await postJson("/api/push/test", { delaySec });
      onToast(
        delaySec
          ? `Уведомление придёт через ${delaySec} сек — можно закрыть приложение`
          : "Тестовое уведомление отправлено",
      );
    } catch (e) {
      onToast(`⚠️ ${(e as Error).message}`);
    } finally {
      setTesting(null);
    }
  };

  if (push.status === "loading") return null;

  if (push.status === "needs-install") {
    return (
      <Card>
        <p className="text-[17px] font-semibold">🔔 Чтобы приходили уведомления</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-[15px] text-slate-600 dark:text-slate-300">
          <li>
            Нажмите <b>«Поделиться»</b> в Safari
          </li>
          <li>
            Выберите <b>«На экран „Домой“»</b>
          </li>
          <li>Откройте приложение с иконки и включите уведомления</li>
        </ol>
        <p className="mt-2 text-xs text-slate-500">Нужен iOS 16.4 или новее.</p>
      </Card>
    );
  }

  if (push.status === "unsupported") {
    return <Banner tone="amber">Этот браузер не поддерживает push-уведомления.</Banner>;
  }

  if (push.status === "denied") {
    return (
      <Banner tone="red">
        Уведомления запрещены. Включите их: Настройки → Уведомления → Лекарства.
      </Banner>
    );
  }

  if (push.status === "default") {
    return (
      <div className="space-y-2">
        <button
          onClick={push.enable}
          disabled={push.busy}
          className="flex h-16 w-full items-center justify-center gap-2 rounded-3xl bg-indigo-600 text-[18px] font-semibold text-white shadow-lg shadow-indigo-600/25 transition active:scale-[0.98] disabled:opacity-60"
        >
          {push.busy ? "Подключаю…" : "🔔 Включить уведомления"}
        </button>
        {push.error && <Banner tone="red">{push.error}</Banner>}
      </div>
    );
  }

  // subscribed
  const warn = state && (!state.pushConfigured || !state.qstashConfigured);
  return (
    <Card className="!p-3">
      <div className="flex items-center justify-between gap-2 px-1">
        <p className="text-[15px] font-medium text-emerald-700 dark:text-emerald-400">
          ✓ Уведомления включены
        </p>
        <button onClick={push.disable} className="text-[13px] text-slate-400 underline" disabled={push.busy}>
          Отключить
        </button>
      </div>
      {warn && (
        <p className="mt-1 px-1 text-[13px] text-amber-700 dark:text-amber-400">
          {!state.pushConfigured && "На сервере нет VAPID-ключей. "}
          {!state.qstashConfigured && "QStash не настроен — фоновые напоминания не придут."}
        </p>
      )}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          onClick={() => test(0)}
          disabled={testing !== null}
          className="h-12 rounded-2xl bg-slate-100 text-[15px] font-semibold active:scale-[0.98] disabled:opacity-60 dark:bg-slate-800"
        >
          {testing === "now" ? "Отправляю…" : "Проверить уведомление"}
        </button>
        <button
          onClick={() => test(30)}
          disabled={testing !== null}
          className="h-12 rounded-2xl bg-slate-100 text-[15px] font-semibold active:scale-[0.98] disabled:opacity-60 dark:bg-slate-800"
        >
          {testing === "later" ? "Планирую…" : "Через 30 сек (фон)"}
        </button>
      </div>
      {push.error && <p className="mt-2 text-sm text-rose-600">{push.error}</p>}
    </Card>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-3xl bg-white p-4 shadow-[0_1px_3px_rgb(15_23_42/0.06),0_8px_24px_rgb(15_23_42/0.04)] dark:bg-slate-900 ${className}`}
    >
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------

type Act = (key: string, action: Record<string, unknown>, msg?: string) => Promise<void>;

function TimersView({
  state,
  serverNow,
  pending,
  act,
}: {
  state: ClientState;
  serverNow: number;
  pending: string | null;
  act: Act;
}) {
  const active = SLOT_ORDER.filter((s) => state.timers[s]).map((s) => state.timers[s]!);
  active.sort((a, b) => a.dueAt - b.dueAt);
  const idleChains = CHAIN_SLOTS.filter((s) => !state.timers[s]);

  const today = new Date(serverNow).toDateString();
  const todayHistory = state.history.filter((h) => new Date(h.at).toDateString() === today);

  return (
    <div className="space-y-4">
      {active.map((t) => (
        <TimerCard
          key={t.id}
          timer={t}
          mode={state.mode}
          serverNow={serverNow}
          pending={pending}
          act={act}
        />
      ))}

      {idleChains.length > 0 && (
        <div className="space-y-3">
          {active.length > 0 && (
            <h2 className="px-1 pt-2 text-[13px] font-semibold uppercase tracking-wide text-slate-500">
              Начать цепочку
            </h2>
          )}
          {idleChains.map((slot) => (
            <StartButton key={slot} slot={slot} mode={state.mode} pending={pending} act={act} />
          ))}
        </div>
      )}

      {todayHistory.length > 0 && (
        <Card>
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">
            Принято сегодня
          </h2>
          <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
            {todayHistory.map((h) => (
              <li key={`${h.step}-${h.at}`} className="flex items-center gap-3 py-2 text-[15px]">
                <span className="w-12 shrink-0 tabular-nums text-slate-500">{fmtTime(h.at)}</span>
                <span className="truncate">{STEPS[h.step].title}</span>
                <span className="ml-auto text-emerald-500">✓</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

const START_STYLE: Record<SlotId, string> = {
  morning: "from-amber-400 to-orange-500 shadow-orange-500/25",
  lunch: "from-emerald-400 to-teal-500 shadow-teal-500/25",
  dinner: "from-indigo-500 to-violet-600 shadow-violet-600/25",
  itomed: "from-sky-400 to-sky-600",
};

function StartButton({
  slot,
  mode,
  pending,
  act,
}: {
  slot: SlotId;
  mode: Mode;
  pending: string | null;
  act: Act;
}) {
  const def = SLOTS[slot];
  const first = STEPS[def.firstStep];
  const key = `start-${slot}`;
  return (
    <button
      onClick={() => act(key, { type: "start", slot })}
      disabled={pending !== null}
      className={`flex min-h-20 w-full items-center gap-4 rounded-3xl bg-gradient-to-br px-5 py-4 text-left text-white shadow-lg transition active:scale-[0.98] disabled:opacity-70 ${START_STYLE[slot]}`}
    >
      <span className="text-[34px] leading-none">{def.emoji}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[20px] font-bold leading-tight">
          {pending === key ? "Запускаю…" : def.startLabel}
        </span>
        <span className="mt-0.5 block truncate text-[14px] text-white/85">
          Сразу: {first.title} · {chainLength(slot, mode)} шаг.
        </span>
      </span>
      <span className="text-2xl text-white/80">›</span>
    </button>
  );
}

function TimerCard({
  timer,
  mode,
  serverNow,
  pending,
  act,
}: {
  timer: ActiveTimer;
  mode: Mode;
  serverNow: number;
  pending: string | null;
  act: Act;
}) {
  const slot = SLOTS[timer.slot];
  const step = STEPS[timer.step];
  const left = timer.dueAt - serverNow;
  const due = left <= 0;
  const overdueMin = Math.floor(-left / 60_000);
  const isItomed = timer.slot === "itomed";
  const idx = isItomed ? 1 : stepIndex(timer.slot, timer.step, mode);
  const total = isItomed ? 1 : chainLength(timer.slot, mode);
  const upcoming = isItomed ? [] : planFrom(timer.step, mode);
  const busy = pending !== null;

  const takenLabel = step.meal
    ? "✓ Поел / Выпил"
    : isItomed && !due
      ? "✓ Выпил раньше"
      : "✓ Выпил сейчас";

  return (
    <Card className={`${due ? "animate-due ring-2 ring-rose-400 dark:ring-rose-500" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-[13px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {slot.emoji} {slot.label}
          {!isItomed && (
            <span className="font-normal text-slate-400">
              · шаг {idx} из {total}
            </span>
          )}
        </span>
        <button
          onClick={() => {
            if (confirm(`Сбросить цепочку «${slot.label}»?`)) {
              act(`reset-${timer.slot}`, { type: "reset", slot: timer.slot }, "Цепочка сброшена");
            }
          }}
          disabled={busy}
          aria-label="Сбросить цепочку"
          className="flex h-9 items-center gap-1 rounded-full px-3 text-[13px] text-slate-400 active:bg-slate-100 dark:active:bg-slate-800"
        >
          ↺ Сброс
        </button>
      </div>

      <div className="mt-3">
        <h3 className="text-[22px] font-bold leading-tight">{step.title}</h3>
        <p className="mt-0.5 text-[16px] text-slate-600 dark:text-slate-300">
          {step.dose}
          {step.note && <span className="text-slate-400"> · {step.note}</span>}
        </p>
      </div>

      <div className="mt-4 flex items-end justify-between gap-3">
        <div>
          <p className="text-[13px] text-slate-500">{due ? "Время приёма" : "Следующий приём"}</p>
          <p className="text-[20px] font-semibold tabular-nums">{fmtTime(timer.dueAt)}</p>
        </div>
        <div className="text-right">
          {due ? (
            <>
              <p className="text-[24px] font-bold text-rose-500">Пора принять!</p>
              {overdueMin > 0 && (
                <p className="text-[13px] text-rose-400">прошло {overdueMin} мин</p>
              )}
            </>
          ) : (
            <p className="text-[44px] font-bold leading-none tracking-tight tabular-nums">
              {fmtCountdown(left)}
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-[1fr_auto] gap-2">
        <button
          onClick={() =>
            act(`taken-${timer.slot}`, { type: "taken", slot: timer.slot }, `Отмечено: ${step.title}`)
          }
          disabled={busy}
          className="h-16 rounded-2xl bg-emerald-500 text-[18px] font-semibold text-white shadow-md shadow-emerald-500/25 transition active:scale-[0.98] disabled:opacity-60"
        >
          {pending === `taken-${timer.slot}` ? "Сохраняю…" : takenLabel}
        </button>
        <button
          onClick={() =>
            act(`snooze-${timer.slot}`, { type: "snooze", slot: timer.slot }, `Отложено на ${SNOOZE_MIN} мин`)
          }
          disabled={busy}
          className="h-16 w-24 rounded-2xl bg-slate-100 text-[18px] font-semibold transition active:scale-[0.98] disabled:opacity-60 dark:bg-slate-800"
        >
          +{SNOOZE_MIN} мин
        </button>
      </div>

      {upcoming.length > 0 && (
        <ol className="mt-4 space-y-1 border-t border-slate-100 pt-3 text-[14px] text-slate-500 dark:border-slate-800">
          {upcoming.map((u, i) => (
            <li key={`${u.step}-${i}`} className="flex gap-2">
              <span className="w-16 shrink-0 tabular-nums text-slate-400">+{u.delayMin} мин</span>
              <span className="truncate">{STEPS[u.step].title}</span>
            </li>
          ))}
          {timer.slot === "morning" && (
            <li className="pt-1 text-[13px] text-slate-400">
              После Итомеда автоматически запустится таймер на 8 ч.
            </li>
          )}
        </ol>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------

function CourseView({ state, pending, act }: { state: ClientState; pending: string | null; act: Act }) {
  const busy = pending !== null;
  return (
    <div className="space-y-3">
      <p className="px-1 text-[14px] text-slate-500">
        Остаток уменьшается автоматически каждый день. Можно поправить вручную или поставить
        препарат на паузу.
      </p>
      {COURSE_IDS.map((id) => (
        <CourseRow key={id} id={id} state={state} busy={busy} act={act} />
      ))}
      <button
        onClick={() => {
          if (confirm("Сбросить все курсы к исходному количеству дней?")) {
            act("course-reset", { type: "courseResetAll" }, "Курсы сброшены");
          }
        }}
        disabled={busy}
        className="h-12 w-full rounded-2xl text-[15px] font-medium text-rose-500 active:bg-rose-50 dark:active:bg-rose-950"
      >
        Сбросить все курсы
      </button>
    </div>
  );
}

function CourseRow({
  id,
  state,
  busy,
  act,
}: {
  id: CourseId;
  state: ClientState;
  busy: boolean;
  act: Act;
}) {
  const def = COURSES[id];
  const c = state.courses[id];
  const done = c.remaining === 0;
  const frozen = id === "pan" && state.mode === "drips";
  const pct = Math.min(100, Math.round((c.remaining / def.days) * 100));
  const status = done ? "Курс завершён" : !c.active ? "На паузе" : frozen ? "Ждёт окончания капельниц" : null;

  return (
    <Card className={!c.active || done ? "opacity-70" : ""}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[17px] font-semibold">{def.name}</h3>
          <p className="text-[13px] text-slate-500">
            Курс {def.days} {daysWord(def.days)}
            {def.note ? ` · ${def.note}` : ""}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[28px] font-bold leading-none tabular-nums">{c.remaining}</p>
          <p className="text-[12px] text-slate-500">{daysWord(c.remaining)} осталось</p>
        </div>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div
          className={`h-full rounded-full ${done ? "bg-slate-300" : "bg-gradient-to-r from-teal-400 to-indigo-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {status && <p className="mt-2 text-[13px] font-medium text-amber-600 dark:text-amber-400">{status}</p>}

      <div className="mt-3 grid grid-cols-[3rem_3rem_1fr] gap-2">
        <button
          aria-label="Минус день"
          onClick={() => act(`c-${id}`, { type: "course", course: id, delta: -1 })}
          disabled={busy || c.remaining === 0}
          className="h-12 rounded-2xl bg-slate-100 text-[22px] font-semibold active:scale-95 disabled:opacity-40 dark:bg-slate-800"
        >
          −
        </button>
        <button
          aria-label="Плюс день"
          onClick={() => act(`c-${id}`, { type: "course", course: id, delta: 1 })}
          disabled={busy}
          className="h-12 rounded-2xl bg-slate-100 text-[22px] font-semibold active:scale-95 disabled:opacity-40 dark:bg-slate-800"
        >
          +
        </button>
        <button
          onClick={() => act(`c-${id}`, { type: "course", course: id, active: !c.active })}
          disabled={busy}
          className={`h-12 rounded-2xl text-[15px] font-semibold active:scale-[0.98] ${
            c.active
              ? "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"
              : "bg-indigo-600 text-white"
          }`}
        >
          {c.active ? "⏸ Пауза" : "▶ Продолжить"}
        </button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function TabBar({
  tab,
  onTab,
  activeCount,
}: {
  tab: Tab;
  onTab: (t: Tab) => void;
  activeCount: number;
}) {
  const items: [Tab, string, string][] = [
    ["timers", "⏱", "Таймеры"],
    ["course", "📅", "Курс"],
  ];
  return (
    <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-slate-200/70 bg-[var(--bg)]/90 backdrop-blur-xl dark:border-slate-800">
      <div className="mx-auto grid max-w-md grid-cols-2 px-4 pt-2">
        {items.map(([id, icon, label]) => {
          const on = tab === id;
          return (
            <button
              key={id}
              onClick={() => onTab(id)}
              className={`relative flex h-14 flex-col items-center justify-center rounded-2xl text-[13px] font-semibold ${
                on ? "text-indigo-600 dark:text-indigo-400" : "text-slate-400"
              }`}
            >
              <span className="text-[22px] leading-none">{icon}</span>
              <span className="mt-1">{label}</span>
              {id === "timers" && activeCount > 0 && (
                <span className="absolute right-[calc(50%-30px)] top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[11px] text-white">
                  {activeCount}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
