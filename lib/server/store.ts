import "server-only";
import { Redis } from "@upstash/redis";

/**
 * Хранилище: Upstash Redis. Если переменные не заданы (локальная разработка) —
 * временное хранилище в памяти процесса.
 */
type KV = {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<unknown>;
  hset(key: string, field: string, value: unknown): Promise<unknown>;
  hdel(key: string, field: string): Promise<unknown>;
  hgetall<T>(key: string): Promise<Record<string, T> | null>;
};

const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;

export const redisConfigured = Boolean(url && token);

function memoryStore(): KV {
  const g = globalThis as unknown as { __medMem?: Map<string, unknown> };
  const m = (g.__medMem ??= new Map<string, unknown>());
  const hash = (key: string) => {
    let h = m.get(key) as Record<string, unknown> | undefined;
    if (!h) {
      h = {};
      m.set(key, h);
    }
    return h;
  };
  return {
    async get<T>(key: string) {
      const v = m.get(key);
      return v === undefined ? null : (structuredClone(v) as T);
    },
    async set(key, value) {
      m.set(key, structuredClone(value));
      return "OK";
    },
    async hset(key, field, value) {
      hash(key)[field] = structuredClone(value);
      return 1;
    },
    async hdel(key, field) {
      delete hash(key)[field];
      return 1;
    },
    async hgetall<T>(key: string) {
      return structuredClone(hash(key)) as Record<string, T>;
    },
  };
}

function redisStore(): KV {
  const r = new Redis({ url: url!, token: token! });
  return {
    get: <T>(key: string) => r.get<T>(key),
    set: (key, value) => r.set(key, value),
    hset: (key, field, value) => r.hset(key, { [field]: value }),
    hdel: (key, field) => r.hdel(key, field),
    hgetall: <T>(key: string) => r.hgetall<Record<string, T>>(key),
  };
}

export const kv: KV = redisConfigured ? redisStore() : memoryStore();

export const KEYS = {
  state: "medtimer:state",
  subs: "medtimer:subs",
} as const;
