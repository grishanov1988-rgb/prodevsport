-- ============================================================
--  0003: эмблемы клубов — уникальность названия для upsert
--  Парсер (jobs-parse) синхронизирует crest_url из football-data
--  после каждого прогона лиги.
-- ============================================================

create unique index if not exists teams_team_name_key on public.teams(team_name);
