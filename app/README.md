# ПОТОК — приложение

TypeScript/React, Vinext/Vite, Cloudflare Worker с D1/SQLite, Three.js и Recharts.

## Запуск

Требуются Node.js 24+ и pnpm 11.25.0. Из этого каталога:

```powershell
pnpm install --frozen-lockfile
pnpm local
```

Адрес: http://127.0.0.1:5173. Учётные записи `analyst` и `viewer`, пароль `Potok-2026!`.

## Команды

- `pnpm test` — проверки модели и API.
- `pnpm typecheck` — проверка типов.
- `pnpm build` — production-сборка.
- `pnpm local` — сборка, подготовка базы и локальный сервер.
- `pnpm test:browser` — сценарии Playwright.

Миграции находятся в `drizzle/`. Локальная база и история — в `.wrangler/state`.

Полное описание, результаты эксперимента и документы: [README проекта](../README.md).
