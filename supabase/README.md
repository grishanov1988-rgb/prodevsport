# Supabase-бэкенд (перенос с Google Apps Script)

Полный бэкенд приложения DevSport на Supabase: Edge Functions (Deno/TypeScript) + Postgres.
Google Apps Script после переезда не используется вообще.

## Структура

```
supabase/
├── config.toml                 # проект wtiiokkgemyozclnallj, verify_jwt=false
├── migrations/
│   └── 0001_backend.sql        # rate_limits, teams, RPC rate_limit_hit, индексы
└── functions/
    ├── _shared/                # общие модули (порты из Code.gs)
    │   ├── config.ts           # env-переменные, LEAGUES, константы
    │   ├── crypto.ts           # валидация initData (HMAC-SHA256, pure JS)
    │   ├── db.ts               # обёртка над PostgREST
    │   ├── util.ts             # даты (Europe/Moscow), нормализация, очки
    │   ├── telegram.ts         # sendText / sendWebAppMenu / answerCallbackQuery
    │   ├── core.ts             # рейтинг, команды, ачивки, rate-limit, чаты
    │   ├── auth.ts             # validateRequest, applyIdentity, requireAdmin
    │   └── gamification.ts     # XP-движок, задания, джокер
    ├── telegram-webhook/       # webhook бота: /start, /admin, callback-кнопки
    ├── miniapp/                # API мини-приложения (диспетчер + обработчики)
    │   ├── index.ts            # POST {fn, args, initData} → валидация → вызов
    │   ├── handlers-core.ts    # bootstrap, матчи, прогнозы, рейтинг туров, стата
    │   └── handlers-gamification.ts  # getGamification, claimTask
    ├── jobs-parse/             # (этап 7) парсеры football-data/TheSportsDB → Postgres
    ├── jobs-notify/            # (этап 7) уведомления за 3ч/1ч до матча
    └── admin/                  # (этап 8) admin_* обработчики
```

## Переменные окружения (Supabase Dashboard → Edge Functions → Secrets)

| Secret | Откуда брать |
|---|---|
| `BOT_TOKEN` | @BotFather |
| `BOT_USERNAME` | `devsport_bot` |
| `ADMIN_SECRET` | ключ админки (был в Script Properties GAS) |
| `ADMIN_CHAT_ID` | Telegram-ID админа |
| `FOOTBALL_API_KEY` | football-data.org |
| `GIPHY_API_KEY` | GIPHY (для батлов, этап 6) |
| `MINIAPP_URL` | URL мини-приложения (GitHub Pages) |
| `ADMIN_URL` | URL админ-панели |

`SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY` доступны функциям автоматически.

## Деплой

```bash
# 1. Применить миграцию: SQL Editor в Dashboard → вставить migrations/0001_backend.sql → Run
#    (или: supabase db push — если настроен CLI)

# 2. Задать секреты (Dashboard → Edge Functions → Secrets, или CLI):
#    supabase secrets set BOT_TOKEN=... ADMIN_SECRET=... ...

# 3. Деплой функций:
supabase functions deploy telegram-webhook
supabase functions deploy miniapp
# supabase functions deploy jobs-parse
# supabase functions deploy jobs-notify

# 4. Настроить webhook бота:
curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -d "url=https://wtiiokkgemyozclnallj.supabase.co/functions/v1/telegram-webhook" \
  -d "drop_pending_updates=true" \
  -d "allowed_updates=[\"message\",\"callback_query\"]"

# 5. Переключить фронтенд: в config.js заменить API_URL на
#    https://wtiiokkgemyozclnallj.supabase.co/functions/v1/miniapp

# 6. Отключить GAS: в проекте Apps Script — Deployments → удалить все версии.
```

## Прогресс переноса (по этапам)

- [x] Этап 1: инфраструктура `_shared`, webhook бота, диспетчер miniapp
- [x] Этап 2: ядро API — bootstrap, матчи, прогнозы, рейтинг туров, статистика, дашборд, уведомления
- [x] Этап 3: приватные лиги
- [x] Этап 4: XP-движок, задания, ачивки, джокер
- [x] Этап 5: магазин (боксы, колесо, джокер, коллекция, продажа)
- [x] Этап 6: Team Builder + батлы + GIPHY
- [x] Этап 7: парсеры + jobs (уведомления, пересчёт очков)
- [x] Этап 8: admin_* + переезд Admin.html на fetch (`admin/index.html` в репо)
- [x] Этап 9: деплой — миграция, секреты, 4 функции, webhook, pg_cron-расписание, фронт переключён на Supabase
