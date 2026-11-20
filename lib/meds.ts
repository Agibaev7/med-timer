// Описание препаратов, шагов цепочек и курса. Общий модуль для клиента и сервера.

export type Mode = "pills" | "drips";
export type SlotId = "morning" | "lunch" | "dinner" | "itomed";

export type StepId =
  | "m_ulkavis"
  | "m_pan"
  | "m_itomed"
  | "m_odeston"
  | "m_breakfast"
  | "l_odeston"
  | "l_lunch"
  | "l_ursozim"
  | "d_ulkavis"
  | "d_odeston"
  | "d_dinner"
  | "d_ursozim"
  | "i_itomed";

export type CourseId =
  | "ulkavis"
  | "pan"
  | "itomed"
  | "odeston"
  | "pankreaza"
  | "ursozim";

export interface StepDef {
  title: string;
  dose: string;
  /** Пояснение под названием */
  note?: string;
  /** Шаг с едой — кнопка «Поел / Выпил» */
  meal?: boolean;
}

export const STEPS: Record<StepId, StepDef> = {
  m_ulkavis: { title: "Улькавис 120 мг", dose: "2 табл.", note: "За 60 мин до завтрака" },
  m_pan: { title: "Пан 40 мг", dose: "1 табл." },
  m_itomed: { title: "Итомед 50 мг", dose: "1 табл." },
  m_odeston: { title: "Одестон форте 400 мг", dose: "1 табл." },
  m_breakfast: {
    title: "Завтрак + Панкраза (Креон) 25000",
    dose: "1 капс. в середине еды",
    meal: true,
  },
  l_odeston: { title: "Одестон форте 400 мг", dose: "1 табл.", note: "За 15 мин до обеда" },
  l_lunch: {
    title: "Обед + Панкраза (Креон) 25000",
    dose: "1 капс. в середине еды",
    meal: true,
  },
  l_ursozim: { title: "Урсозим 250 мг", dose: "1 капс.", note: "Через час после обеда" },
  d_ulkavis: { title: "Улькавис 120 мг", dose: "2 табл.", note: "За час до ужина" },
  d_odeston: { title: "Одестон форте 400 мг", dose: "1 табл." },
  d_dinner: {
    title: "Ужин + Панкраза (Креон) 25000",
    dose: "1 капс. в середине еды",
    meal: true,
  },
  d_ursozim: { title: "Урсозим 250 мг", dose: "1 капс.", note: "Через час после ужина" },
  i_itomed: { title: "Итомед 50 мг", dose: "1 табл.", note: "Через 8 часов после утреннего" },
};

export interface SlotDef {
  label: string;
  emoji: string;
  startLabel: string;
  firstStep: StepId;
}

export const SLOTS: Record<SlotId, SlotDef> = {
  morning: { label: "Утро", emoji: "☀️", startLabel: "Я проснулся", firstStep: "m_ulkavis" },
  lunch: { label: "Обед", emoji: "🍲", startLabel: "Обед через 15 минут", firstStep: "l_odeston" },
  dinner: { label: "Ужин", emoji: "🌙", startLabel: "Ужин через час", firstStep: "d_ulkavis" },
  itomed: { label: "Итомед (+8 ч)", emoji: "⏰", startLabel: "", firstStep: "i_itomed" },
};

export const CHAIN_SLOTS: SlotId[] = ["morning", "lunch", "dinner"];

export interface NextStep {
  step: StepId;
  delayMin: number;
}

/** Следующий шаг цепочки после приёма `step` (режим учитывается в момент приёма). */
export function nextStep(step: StepId, mode: Mode): NextStep | null {
  switch (step) {
    case "m_ulkavis":
      return mode === "pills"
        ? { step: "m_pan", delayMin: 15 }
        : { step: "m_itomed", delayMin: 30 };
    case "m_pan":
      return { step: "m_itomed", delayMin: 15 };
    case "m_itomed":
      return { step: "m_odeston", delayMin: 15 };
    case "m_odeston":
      return { step: "m_breakfast", delayMin: 15 };
    case "l_odeston":
      return { step: "l_lunch", delayMin: 15 };
    case "l_lunch":
      return { step: "l_ursozim", delayMin: 60 };
    case "d_ulkavis":
      return { step: "d_odeston", delayMin: 40 };
    case "d_odeston":
      return { step: "d_dinner", delayMin: 20 };
    case "d_dinner":
      return { step: "d_ursozim", delayMin: 60 };
    default:
      return null;
  }
}

/** Полный план цепочки начиная с шага (для превью «дальше»). */
export function planFrom(step: StepId, mode: Mode): NextStep[] {
  const out: NextStep[] = [];
  let cur: StepId = step;
  for (let i = 0; i < 10; i++) {
    const n = nextStep(cur, mode);
    if (!n) break;
    out.push(n);
    cur = n.step;
  }
  return out;
}

export function chainLength(slot: SlotId, mode: Mode): number {
  return 1 + planFrom(SLOTS[slot].firstStep, mode).length;
}

/** Порядковый номер шага в цепочке (1-based). */
export function stepIndex(slot: SlotId, step: StepId, mode: Mode): number {
  const all = [SLOTS[slot].firstStep, ...planFrom(SLOTS[slot].firstStep, mode).map((s) => s.step)];
  const i = all.indexOf(step);
  return i === -1 ? 1 : i + 1;
}

export const ITOMED_REPEAT_HOURS = 8;
export const SNOOZE_MIN = 5;

export interface CourseDef {
  name: string;
  days: number;
  note?: string;
}

export const COURSES: Record<CourseId, CourseDef> = {
  ulkavis: { name: "Улькавис", days: 30 },
  pan: { name: "Пан 40 мг", days: 40, note: "После 5–7 дней капельниц. В режиме «Капельницы» не убывает" },
  itomed: { name: "Итомед", days: 28 },
  odeston: { name: "Одестон форте", days: 15 },
  pankreaza: { name: "Панкраза (Креон)", days: 20, note: "По назначению 15–20" },
  ursozim: { name: "Урсозим 250 мг", days: 20 },
};

export const COURSE_IDS = Object.keys(COURSES) as CourseId[];

// ---------- Состояние ----------

export interface ActiveTimer {
  id: string;
  slot: SlotId;
  step: StepId;
  /** Время следующего приёма, мс */
  dueAt: number;
  startedAt: number;
  /** Одноразовый ключ: сверяется при доставке, чтобы устаревшие сообщения игнорировались */
  nonce?: string;
  /** ID сообщения QStash для отмены */
  msgId?: string;
  /** Сколько повторных напоминаний уже отправлено */
  reminders?: number;
}

export interface CourseState {
  remaining: number;
  active: boolean;
}

export interface HistoryItem {
  step: StepId;
  at: number;
}

export interface AppState {
  mode: Mode;
  tz: string;
  timers: Partial<Record<SlotId, ActiveTimer>>;
  courses: Record<CourseId, CourseState>;
  /** Последний учтённый день курса YYYY-MM-DD (в часовом поясе tz) */
  courseDay: string;
  /** Сколько дней прошло в режиме «Капельницы» */
  dripDays: number;
  history: HistoryItem[];
  updatedAt: number;
}

export interface PublicState extends AppState {
  pushConfigured: boolean;
  qstashConfigured: boolean;
  subscriptions: number;
  serverNow: number;
}
