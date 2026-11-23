-- ============================================================
--  Миграция 0001: бэкенд на Supabase (перенос с Google Apps Script)
--  Новые объекты: rate_limits, teams, rate_limit_hit()
--  + индексы под запросы фронтенда (idempotent, IF NOT EXISTS)
--  Таблицы matches/predictions/users/subscriptions/xp_profiles/
--  xp_logs/task_templates/tasks_progress/achievements/notify_log
--  уже существуют в проекте (их создавал GAS-бэкенд через PostgREST).
-- ============================================================

-- ------------------------------------------------------------
--  Rate limit (замена CacheService GAS)
-- ------------------------------------------------------------
create table if not exists public.rate_limits (
  k          text primary key,
  count      integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists rate_limits_created_at_idx on public.rate_limits (created_at);

-- очистка старых ключей (можно повесить на pg_cron раз в час)
create or replace function public.rate_limits_cleanup()
returns void language sql as $$
  delete from public.rate_limits where created_at < now() - interval '2 hours';
$$;

-- атомарный rate-limit: true = запрос разрешён (и счётчик увеличен)
create or replace function public.rate_limit_hit(p_key text, p_max integer)
returns boolean language plpgsql as $$
declare
  v_count integer;
begin
  insert into public.rate_limits (k, count)
  values (p_key, 1)
  on conflict (k) do update set count = rate_limits.count + 1
  returning count into v_count;
  return v_count <= p_max;
end;
$$;

-- ------------------------------------------------------------
--  Команды (замена Google-листа "Команды": getTeamsSheet_)
--  Порядок колонок соответствует листу: короткое имя, полное имя, герб
-- ------------------------------------------------------------
create table if not exists public.teams (
  id          bigint generated always as identity primary key,
  team_name   text not null,             -- полное название (кол. B листа)
  short_name  text,                      -- короткое название (кол. A листа)
  crest_url   text not null default '',  -- ссылка на эмблему (кол. C листа)
  league_code text,                      -- необязательная привязка к лиге
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create unique index if not exists teams_team_name_lower_uidx
  on public.teams (lower(team_name));
create index if not exists teams_is_active_idx on public.teams (is_active);

-- ------------------------------------------------------------
--  Индексы под частые запросы API (таблицы из фазы 1)
-- ------------------------------------------------------------
create unique index if not exists predictions_user_league_match_uidx
  on public.predictions (user_name, league_code, match_norm);
create index if not exists predictions_user_name_idx on public.predictions (user_name);
create index if not exists predictions_league_match_idx on public.predictions (league_code, match_norm);

create index if not exists matches_league_tour_idx on public.matches (league_code, tour_num);
create index if not exists matches_league_norm_idx on public.matches (league_code, match_norm);
create index if not exists matches_utc_date_idx on public.matches (utc_date);
create index if not exists matches_real_score_idx on public.matches (real_score);

create unique index if not exists subscriptions_user_name_uidx on public.subscriptions (user_name);
create unique index if not exists xp_profiles_user_name_uidx on public.xp_profiles (user_name);
create unique index if not exists xp_logs_user_match_reason_uidx on public.xp_logs (user_name, match_key, reason);
create unique index if not exists tasks_progress_user_task_period_uidx on public.tasks_progress (user_name, task_id, period_key);
create unique index if not exists achievements_user_code_uidx on public.achievements (user_name, code);
create unique index if not exists notify_log_user_match_type_uidx on public.notify_log (user_name, match_key, type_key);
create unique index if not exists users_user_name_uidx on public.users (user_name);

-- ------------------------------------------------------------
--  Периодическая очистка: старые rate_limits и notify_log (>48ч)
--  Требует включённого pg_cron (Database → Extensions → pg_cron)
-- ============================================================
-- select cron.schedule('rate-limits-cleanup', '7 * * * *', $$select public.rate_limits_cleanup()$$);
-- select cron.schedule('notify-log-cleanup', '23 * * * *', $$delete from public.notify_log where sent_at < now() - interval '48 hours'$$);

-- ------------------------------------------------------------
--  Расписание парсеров и уведомлений (pg_cron + pg_net → Edge Functions).
--  Ключ передаётся в Authorization: Bearer <ADMIN_SECRET>.
--  Раскомментировать после деплоя функций и подстановки значений:
--
-- ⚠️ подставить: <ПРОЕКТ>, <ADMIN_SECRET>, <SUPABASE_SERVICE_ROLE_KEY>
--
-- -- парсеры: каждый час в :05
-- select cron.schedule('jobs-parse', '5 * * * *', $$
--   select net.http_post(
--     url := 'https://<ПРОЕКТ>.supabase.co/functions/v1/jobs-parse',
--     headers := jsonb_build_object('Authorization', 'Bearer <ADMIN_SECRET>'),
--     timeout_milliseconds := 55000
--   ) $$);
--
-- -- уведомления: каждые 30 минут (окна 3ч и 1ч до матча)
-- select cron.schedule('jobs-notify', '*/30 * * * *', $$
--   select net.http_post(
--     url := 'https://<ПРОЕКТ>.supabase.co/functions/v1/jobs-notify',
--     headers := jsonb_build_object('Authorization', 'Bearer <ADMIN_SECRET>'),
--     timeout_milliseconds := 55000
--   ) $$);
