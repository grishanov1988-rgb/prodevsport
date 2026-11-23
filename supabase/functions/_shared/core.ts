// ============================================================
//  ЯДРО: рейтинг, команды, ачивки, rate-limit, список чатов
//  Порт из Code.gs (buildRatingFromSupabase_, getTeamsMap_,
//  getUserAchievements, checkRateLimit_, getUserChats_)
// ============================================================

import { db, upsert } from './db.ts';
import { LEAGUES, SUPABASE_URL, SUPABASE_SERVICE_KEY } from './config.ts';
import { calcPointsForPrediction, enc, normalizeMatchName, normalizeTeamName, splitMatchTeams_ } from './util.ts';

// ------------------------------------------------------------
//  Рейтинг (user_points)
// ------------------------------------------------------------
let ratingCache: { at: number; data: RatingRow[] } | null = null;

export interface RatingRow { name: string; points: number; leagues: Record<string, number> }

export async function buildRating(): Promise<RatingRow[]> {
  if (ratingCache && Date.now() - ratingCache.at < 60_000) return ratingCache.data;
  try {
    const rows = await db('user_points?select=user_name,total_points,per_league&order=total_points.desc&limit=500');
    const list: RatingRow[] = (rows ?? []).map((r: any) => ({
      name: r.user_name,
      points: Number(r.total_points) || 0,
      leagues: r.per_league || {},
    }));
    ratingCache = { at: Date.now(), data: list };
    return list;
  } catch {
    return ratingCache?.data ?? [];
  }
}

export function invalidateRating(): void {
  ratingCache = null;
}

// ------------------------------------------------------------
//  Пересчёт очков пользователя (recalcUserPoints_)
// ------------------------------------------------------------
export async function recalcUserPoints(userName: string): Promise<{ user_name: string; total_points: number; per_league: Record<string, number> } | null> {
  const clean = String(userName || '').trim();
  if (!clean) return null;
  try {
    const preds = await db(
      `predictions?user_name=eq.${enc(clean)}&select=league_code,match_norm,outcome,score,is_joker`,
    ) ?? [];
    if (!preds.length) {
      await upsert('user_points', [{
        user_name: clean, total_points: 0, per_league: {}, updated_at: new Date().toISOString(),
      }]);
      invalidateRating();
      return { user_name: clean, total_points: 0, per_league: {} };
    }
    const leagueSet: Record<string, true> = {};
    preds.forEach((p: any) => { leagueSet[p.league_code] = true; });
    const leagueCodes = Object.keys(leagueSet);
    const matches = await db(
      `matches?real_score=not.is.null&league_code=in.(${leagueCodes.map(enc).join(',')})&select=league_code,match_norm,real_score`,
    ) ?? [];
    const realMap: Record<string, string> = {};
    matches.forEach((m: any) => { realMap[m.league_code + '||' + m.match_norm] = m.real_score; });

    let total = 0;
    const perLeague: Record<string, number> = {};
    for (const p of preds) {
      const real = realMap[p.league_code + '||' + p.match_norm];
      if (!real) continue;
      let pts = calcPointsForPrediction(p.outcome, p.score, real).points;
      if (p.is_joker === true) pts *= 2; // JOKER x2
      total += pts;
      perLeague[p.league_code] = (perLeague[p.league_code] || 0) + pts;
    }
    await upsert('user_points', [{
      user_name: clean, total_points: total, per_league: perLeague, updated_at: new Date().toISOString(),
    }]);
    invalidateRating();
    return { user_name: clean, total_points: total, per_league: perLeague };
  } catch {
    return null;
  }
}

// ------------------------------------------------------------
//  Команды (teams в Postgres — замена листа «Команды»)
// ------------------------------------------------------------
let teamsCache: { at: number; map: Record<string, TeamRec> } | null = null;
const TEAMS_TTL = 300_000;

interface TeamRec { name: string; shortName: string; crestUrl: string }

export async function getTeamsMap(): Promise<Record<string, TeamRec>> {
  if (teamsCache && Date.now() - teamsCache.at < TEAMS_TTL) return teamsCache.map;
  const map: Record<string, TeamRec> = {};
  try {
    const rows = await db('teams?select=team_name,short_name,crest_url&is_active=eq.true') ?? [];
    for (const r of rows) {
      const rec: TeamRec = { name: r.short_name || r.team_name, shortName: r.short_name || r.team_name, crestUrl: r.crest_url || '' };
      if (r.team_name) map[normalizeTeamName(r.team_name)] = rec;
      if (r.short_name) map[normalizeTeamName(r.short_name)] = rec;
    }
  } catch { /* таблица может ещё не существовать — фолбэк ниже */ }
  teamsCache = { at: Date.now(), map };
  return map;
}

export interface ResolvedTeam { name: string; shortName: string; crestUrl: string }

export async function resolveTeams(matchName: string): Promise<{ home: ResolvedTeam; away: ResolvedTeam }> {
  const teamsMap = await getTeamsMap();
  const t = splitMatchTeams_(matchName);
  const home = teamsMap[normalizeTeamName(t.home)] || null;
  const away = teamsMap[normalizeTeamName(t.away)] || null;
  return {
    home: { name: t.home, shortName: home ? home.name : t.home, crestUrl: home ? home.crestUrl : '' },
    away: { name: t.away, shortName: away ? away.name : t.away, crestUrl: away ? away.crestUrl : '' },
  };
}

// ------------------------------------------------------------
//  Ачивки
// ------------------------------------------------------------
export async function getUserAchievements(userName: string): Promise<{ code: string; name: string }[]> {
  try {
    const rows = await db(`achievements?user_name=eq.${enc(userName)}`) ?? [];
    return rows.map((r: any) => ({ code: r.code, name: r.name }));
  } catch { return []; }
}

// ------------------------------------------------------------
//  Rate limit (таблица rate_limits вместо CacheService)
// ------------------------------------------------------------
export async function checkRateLimit(key: string, maxPerMinute: number): Promise<boolean> {
  try {
    const now = Math.floor(Date.now() / 60000);
    const k = `rl_${key}_${now}`;
    // атомарный инкремент на стороне Postgres (защита от гонок)
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rate_limit_hit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({ p_key: k, p_max: maxPerMinute }),
    });
    if (!res.ok) return true;
    const data = await res.json();
    return data === true;
  } catch { return true; }
}

// ------------------------------------------------------------
//  Список user_name → chat_id (getUserChats_)
// ------------------------------------------------------------
export async function getUserChats(): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  try {
    const rows = await db('users?select=user_name,chat_id') ?? [];
    for (const r of rows) {
      if (r.user_name && r.chat_id) map[r.user_name] = String(r.chat_id);
    }
  } catch { /* ignore */ }
  return map;
}

export function leagueOrNull(code: string) {
  return LEAGUES[code] ?? null;
}

export { normalizeMatchName };
