import "server-only";

const isLocal = (host: string) => /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(host);
const withProto = (v: string) => (v.startsWith("http") ? v : `https://${v}`).replace(/\/+$/, "");

/**
 * Публичный адрес приложения для callback-URL QStash.
 * Порядок: NEXT_PUBLIC_APP_URL → заголовки запроса (x-forwarded-host / host / origin)
 * → VERCEL_PROJECT_PRODUCTION_URL → VERCEL_URL.
 */
export function getBaseUrl(req: Request): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return withProto(explicit);

  const h = req.headers;
  const host = h.get("x-forwarded-host")?.split(",")[0].trim() ?? h.get("host");
  if (host && !isLocal(host)) {
    const proto = h.get("x-forwarded-proto")?.split(",")[0].trim() ?? "https";
    return `${proto}://${host}`;
  }
  const origin = h.get("origin");
  if (origin && !isLocal(new URL(origin).host)) return withProto(origin);

  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (vercel) return withProto(vercel);

  return host ? `http://${host}` : "http://localhost:3000";
}
