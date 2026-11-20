"use client";

import { useCallback, useEffect, useState } from "react";
import { postJson, unlockAudio, urlBase64ToUint8Array } from "@/lib/client";

export type PushStatus =
  | "loading"
  | "unsupported"
  | "needs-install"
  | "default"
  | "denied"
  | "subscribed";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

export function detectEnv() {
  const ua = navigator.userAgent;
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  return { isIOS, standalone, supported };
}

async function syncSubscription(sub: PushSubscription) {
  await postJson("/api/push/subscribe", { subscription: sub.toJSON() });
}

export function usePush() {
  const [status, setStatus] = useState<PushStatus>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const env = detectEnv();
      if (!("serviceWorker" in navigator)) {
        if (!cancelled) setStatus("unsupported");
        return;
      }
      const reg = await navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .catch(() => null);
      let next: PushStatus;
      if (!env.supported) next = env.isIOS && !env.standalone ? "needs-install" : "unsupported";
      else if (Notification.permission === "denied") next = "denied";
      else {
        const sub = reg ? await reg.pushManager.getSubscription() : null;
        if (sub && Notification.permission === "granted") {
          // Повторно сохраняем подписку на сервере (на случай очистки Redis)
          syncSubscription(sub).catch(() => {});
          next = "subscribed";
        } else next = "default";
      }
      if (!cancelled) setStatus(next);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useCallback(async () => {
    unlockAudio();
    setError(null);
    if (!VAPID_PUBLIC_KEY) {
      setError("Не задан NEXT_PUBLIC_VAPID_PUBLIC_KEY — пересоберите проект с ключом");
      return;
    }
    setBusy(true);
    try {
      // На iOS запрос разрешения должен идти сразу из обработчика нажатия
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "default");
        return;
      }
      await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      sub ??= await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
      await syncSubscription(sub);
      setStatus("subscribed");
    } catch (e) {
      setError((e as Error).message || "Не удалось включить уведомления");
    } finally {
      setBusy(false);
    }
  }, []);

  const disable = useCallback(async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await postJson("/api/push/subscribe", { endpoint: sub.endpoint }, "DELETE").catch(() => {});
        await sub.unsubscribe();
      }
      setStatus("default");
    } finally {
      setBusy(false);
    }
  }, []);

  return { status, busy, error, setError, enable, disable };
}
