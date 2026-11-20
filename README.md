# Таймер приёма лекарств (PWA)

Next.js (App Router) + TypeScript + Tailwind. Цепочки приёма лекарств с фоновыми Web Push
уведомлениями на iPhone (iOS 16.4+, приложение должно быть добавлено на экран «Домой»).

- **Upstash Redis** — состояние таймеров, курс, режим Пантопразола, push-подписки.
- **Upstash QStash** — отложенный вызов `/api/push/send` (подпись проверяется через `Receiver`).
- **web-push** + VAPID — отправка уведомлений.

## Деплой на Vercel

1. Импортируйте репозиторий в Vercel.
2. Добавьте переменные из `.env.example` (Settings → Environment Variables).
3. Задеплойте. Адрес для callback QStash определяется автоматически
   (`NEXT_PUBLIC_APP_URL` → заголовки запроса → `VERCEL_PROJECT_PRODUCTION_URL`).
4. На iPhone откройте сайт в Safari → «Поделиться» → «На экран „Домой“», откройте с иконки,
   нажмите «Включить уведомления», затем «Проверить уведомление».

> Vercel Deployment Protection на preview-деплоях блокирует запросы QStash — используйте
> production-домен.

## Локально

```bash
cp .env.example .env.local   # заполнить
npm install
npm run dev
```

Без Redis данные хранятся в памяти процесса; без QStash фоновые напоминания не планируются.

## Проверки

```bash
npm run lint
npm run build
```
