# Прогнозы — Telegram Mini App

Telegram Mini App для прогнозов на футбольные матчи.
**Фронтенд** — статический сайт (GitHub Pages), **бэкенд** — Google Apps Script, **БД** — Supabase (PostgREST), первичное хранилище матчей — Google Sheets.

Футера «Это приложение создано пользователем Google Apps Script» нет — приложение обслуживается с GitHub Pages, GAS работает только как JSON API по URL `/exec`.

## Структура репозитория

```
├── index.html          # Mini App (клиент, деплоится на GitHub Pages)
├── config.js           # Конфиг фронта: API_URL и BOT_USERNAME
├── icons/              # Иконки вкладок (PNG-маски, красятся текущим цветом темы)
└── gas/                # Backend (Google Apps Script)
    ├── Code.gs         # Ядро: webhook, miniApp_* API, XP/геймификация, магазин, админка
    ├── Parser.gs       # Парсеры football-data.org / TheSportsDB, цепочка обновлений
    ├── Profile.gs      # Легаси-экраны профиля (Supabase-версии в Code.gs)
    ├── Admin.html     # Админ-панель (отдаётся GAS через doGet)
    └── appsscript.json # Манифест
```

## Развёртывание (пошагово)

### 1. Настройка секретов в GAS

Откройте проект → **Настройки проекта → Свойства скрипта** и задайте:

| Свойство | Значение |
|---|---|
| `BOT_TOKEN` | Токен бота от @BotFather |
| `SHEET_ID` | ID таблицы Google Sheets |
| `ADMIN_SECRET` | Случайная строка-пароль для админки (например `openssl rand -hex 16`) |
| `ADMIN_CHAT_ID` | Ваш числовой chat_id в Telegram (узнать: напишите боту `/whoami`) |
| `FOOTBALL_API_KEY` | Ключ football-data.org |
| `SUPABASE_URL` | URL проекта Supabase |
| `SUPABASE_KEY` | service_role или anon ключ Supabase |
| `WEBAPP_EXEC_URL` | URL деплоя GAS — появится на шаге 2 |
| `MINIAPP_URL` | URL фронта на GitHub Pages — появится на шаге 3 |
| `GIPHY_API_KEY` | Ключ GIPHY (для вкладки «моменты матча») |
| `BOT_USERNAME` | Username бота без @ (например `devsport_bot`) |

> В коде секретов нет — только эти свойства.

### 2. Деплой backend в GAS

1. Создайте проект на https://script.google.com, загрузите файлы из `gas/` (Code.gs, Parser.gs, Profile.gs, Admin.html как HTML-файл «Admin», appsscript.json — в манифест).
2. Задайте свойства из шага 1 (кроме `WEBAPP_EXEC_URL` и `MINIAPP_URL` — пока пусто).
3. **Развернуть → Новое развёртывание → Веб-приложение**:
   - Запуск от имени: *От моего имени*
   - Доступ: *Все* (обязательно — иначе фронт с GitHub Pages не достучится; безопасность обеспечивается валидацией Telegram initData на сервере, а не секретностью URL)
4. Скопируйте URL вида `https://script.google.com/macros/s/.../exec` → запишите в свойство `WEBAPP_EXEC_URL` и в `config.js` (поле `API_URL`).
5. Запустите `setup()` (в редакторе GAS) → установится вебхук Telegram.

### 3. Включение GitHub Pages

1. Репозиторий → **Settings → Pages → Source: Deploy from a branch**, ветка `main`, папка `/ (root)`.
2. Дождитесь публикации: `https://<username>.github.io/<repo>/`.
3. Запишите этот URL в свойство `MINIAPP_URL` в GAS.

### 4. Финал

- Запустите в редакторе GAS `setupNotifyTriggers()` и `createAllTriggers()` (или кнопку «Пересоздать триггеры» в админке) — включатся уведомления о матчах и обновление данных.
- Админка: `/admin` в боте → ссылка с кнопкой.
- Старые ссылки на URL GAS автоматически редиректят на GitHub Pages (если задан `MINIAPP_URL`).

## Безопасность

- Каждый запрос к `miniApp_*` проходит валидацию HMAC-подписи Telegram initData; `chat_id`/`имя` подменяются сервером данными из подписи — клиент **не может** выдать себя за другого пользователя (раньше этой проверки не было вообще).
- Админ-функции требуют `ADMIN_SECRET` + `ADMIN_CHAT_ID`.
- БД недоступна напрямую из фронта — только через GAS API.

## Диагностика

- `DIAGNOSE_ADMIN` — журнал состояния (без секретов).
- `checkUpdateStatus` / `verifyChain_` — цепочка обновления матчей.
- В боте: `/whoami` — ваш chat_id.

## Дорожная карта (фаза 2)

Перенос бэкенда с GAS на Node.js / Supabase Edge Functions (парсеры, вебхук, XP-движок) — чтобы уйти от квот GAS полностью.
