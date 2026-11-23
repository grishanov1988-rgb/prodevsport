// ============================================================
//  JOBS-PARSE (этап 7) — парсеры матчей, полный порт с GAS:
//  football-data.org v4 (PL/CL/PD/SA/FL1/ELC/PPL) + TheSportsDB (UNL).
//
//  В отличие от GAS-цепочки (триггеры по 6 минут), здесь всё
//  выполняется за один вызов — лимита исполнения нет.
//  Google Sheets исключены: матчи пишутся сразу в Postgres.
//
//  Защита: заголовок Authorization: Bearer <ADMIN_SECRET>.
//
//  Параметры (?league=PL — только одна лига; &full=1 — полный
//  пересчёт очков всех игроков, иначе только затронутые матчами).
// ============================================================

import { db } from '../_shared/db.ts';
import { LEAGUES, FOOTBALL_API_KEY, ADMIN_SECRET } from '../_shared/config.ts';
import { enc, normalizeMatchName, calcPointsForPrediction } from '../_shared/util.ts';
import { invalidateRating } from '../_shared/core.ts';
import { XP_REWARDS, addXP, wasXPAwarded, logXPAward, bumpTasks, checkBothScoredTask, checkStreakAchievements } from '../_shared/gamification.ts';
import { translateTeamName } from '../_shared/translations.ts';

const BASE_URL = 'https://api.football-data.org/v4';
const TARGET_YEAR = 2026;
const THESPORTSDB_BASE_URL = 'https://www.thesportsdb.com/api/v1/json/3';
const THESPORTSDB_UNL_LEAGUE_ID = '4481'; // UEFA Nations League
const PAGE_DELAY_MS = 6500; // football-data free: 10 запросов/мин — бережём квоту как в GAS

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------
//  Источники данных
// ------------------------------------------------------------
interface RawMatch {
  utcDate: string | null;
  matchday: number | null;
  status: string;
  homeTeam?: { name?: string } | null;
  awayTeam?: { name?: string } | null;
  score?: {
    fullTime?: { home: number | null; away: number | null };
    extraTime?: { home: number | null; away: number | null };
    penalties?: { home: number | null; away: number | null };
  } | null;
}

async function fetchAllMatchesForLeague(competition: string): Promise<RawMatch[]> {
  let allMatches: RawMatch[] = [];
  let page = 1;
  const limit = 100;
  let total = Infinity;

  while ((page - 1) * limit < total) {
    const url = `${BASE_URL}/competitions/${competition}/matches?limit=${limit}&offset=${(page - 1) * limit}`;
    try {
      const resp = await fetch(url, { headers: { 'X-Auth-Token': FOOTBALL_API_KEY } });
      if (!resp.ok) {
        console.log(`Ошибка API (статус ${resp.status}) для ${competition}`);
        break;
      }
      const data = await resp.json();
      if (!data.matches || !data.matches.length) break;

      allMatches = allMatches.concat(data.matches);
      if (data.resultSet && typeof data.resultSet.count === 'number') {
        total = data.resultSet.count;
      } else if (data.matches.length < limit) {
        total = (page - 1) * limit + data.matches.length;
      }
      page++;
      await sleep(PAGE_DELAY_MS);
    } catch (e) {
      console.log('Сбой при вызове API: ' + e);
      break;
    }
  }
  return allMatches;
}

function convertTheSportsDBStatus(status: string): string {
  const s = String(status || '').toUpperCase();
  if (s === 'FT' || s === 'AET' || s === 'PEN' || s === 'MATCH FINISHED') return 'FINISHED';
  if (s === 'NS' || s === 'NOT STARTED' || s === 'SCHEDULED') return 'SCHEDULED';
  if (s === '1H' || s === '2H' || s === 'HT' || s === 'LIVE' || s === 'IN_PLAY') return 'IN_PLAY';
  if (s === 'POSTP' || s === 'CANC') return 'CANCELLED';
  return s;
}

async function fetchNationsLeagueFromTheSportsDB(season: string): Promise<RawMatch[]> {
  try {
    const url = `${THESPORTSDB_BASE_URL}/eventsseason.php?id=${THESPORTSDB_UNL_LEAGUE_ID}&s=${season}`;
    const resp = await fetch(url);
    if (!resp.ok) {
      console.log('TheSportsDB ошибка: ' + resp.status);
      return [];
    }
    const data = await resp.json();
    const events = data.events || [];
    console.log(`TheSportsDB: ${events.length} матчей Лиги наций за ${season}`);

    return events.map((e: any) => ({
      utcDate: (e.strTimestamp || (e.dateEvent + 'T' + (e.strTime || '00:00:00'))) + 'Z',
      matchday: e.intRound ? parseInt(e.intRound, 10) : null,
      status: convertTheSportsDBStatus(e.strStatus),
      homeTeam: { name: e.strHomeTeam },
      awayTeam: { name: e.strAwayTeam },
      score: {
        fullTime: {
          home: e.intHomeScore !== null && e.intHomeScore !== undefined ? Number(e.intHomeScore) : null,
          away: e.intAwayScore !== null && e.intAwayScore !== undefined ? Number(e.intAwayScore) : null,
        },
      },
    }));
  } catch (e) {
    console.log('fetchNationsLeagueFromTheSportsDB error: ' + e);
    return [];
  }
}

// ------------------------------------------------------------
//  Преобразование в строки таблицы matches
// ------------------------------------------------------------
function extractScore(m: RawMatch): { realScore: string | null; winner: string | null } {
  if (m.status !== 'FINISHED' || !m.score) return { realScore: null, winner: null };
  let score = '';
  const ft = m.score.fullTime;
  if (ft && ft.home != null && ft.away != null) score = `${ft.home}-${ft.away}`;
  if (!score && m.score.extraTime && m.score.extraTime.home != null && m.score.extraTime.away != null) {
    score = `${m.score.extraTime.home}-${m.score.extraTime.away}`;
  }
  if (!score && m.score.penalties && m.score.penalties.home != null && m.score.penalties.away != null) {
    score = `${m.score.penalties.home}-${m.score.penalties.away}`;
  }
  if (!score) return { realScore: null, winner: null };
  const [h, a] = score.split('-').map((x) => parseInt(x, 10));
  const winner = h > a ? 'П1' : a > h ? 'П2' : 'Ничья';
  return { realScore: score, winner };
}

function toMatchRow(leagueCode: string, m: RawMatch) {
  const home = m.homeTeam?.name ? translateTeamName(m.homeTeam.name) : 'Команда 1';
  const away = m.awayTeam?.name ? translateTeamName(m.awayTeam.name) : 'Команда 2';
  const matchName = `${home} - ${away}`;
  const { realScore, winner } = extractScore(m);
  return {
    league_code: leagueCode,
    tour_num: m.matchday,
    match_name: matchName,
    match_norm: normalizeMatchName(matchName),
    real_score: realScore,
    winner,
    utc_date: m.utcDate,
  };
}

// ------------------------------------------------------------
//  Пересчёт очков и XP за попадания (порт updateAllRatings, шаг 3)
// ------------------------------------------------------------
async function awardHitXP(userName: string, leagueCode: string, matchNorm: string, points: number, realScore: string) {
  const gmMatchKey = leagueCode + '||' + matchNorm;
  if (points === 5) {
    if (!(await wasXPAwarded(userName, gmMatchKey, 'exactScore'))) {
      await addXP(userName, XP_REWARDS.exactScore, 'exactScore');
      await logXPAward(userName, gmMatchKey, 'exactScore', XP_REWARDS.exactScore);
      await bumpTasks(userName, 'exactScore');
      await bumpTasks(userName, 'outcomeHit');
      await checkBothScoredTask(userName, realScore);
      await checkStreakAchievements(userName);
    }
  } else if (points === 3) {
    if (!(await wasXPAwarded(userName, gmMatchKey, 'diffHit'))) {
      await addXP(userName, XP_REWARDS.diffHit, 'diffHit');
      await logXPAward(userName, gmMatchKey, 'diffHit', XP_REWARDS.diffHit);
      await bumpTasks(userName, 'outcomeHit');
      await checkBothScoredTask(userName, realScore);
      await checkStreakAchievements(userName);
    }
  } else if (points === 1) {
    if (!(await wasXPAwarded(userName, gmMatchKey, 'outcomeHit'))) {
      await addXP(userName, XP_REWARDS.outcomeHit, 'outcomeHit');
      await logXPAward(userName, gmMatchKey, 'outcomeHit', XP_REWARDS.outcomeHit);
      await bumpTasks(userName, 'outcomeHit');
      await checkStreakAchievements(userName);
    }
  }
}

async function recalcUserPoints(userName: string): Promise<void> {
  const clean = String(userName || '').trim();
  if (!clean) return;
  try {
    const preds = await db(`predictions?user_name=eq.${enc(clean)}&select=league_code,match_norm,outcome,score,is_joker`) ?? [];
    if (!preds.length) {
      try {
        await db('user_points?on_conflict=user_name', {
          method: 'post',
          body: [{ user_name: clean, total_points: 0, per_league: {}, updated_at: new Date().toISOString() }],
          prefer: 'return=minimal,resolution=merge-duplicates',
        });
      } catch { /* ignore */ }
      return;
    }
    const leagueSet: Record<string, boolean> = {};
    preds.forEach((p: any) => { leagueSet[p.league_code] = true; });
    const leagueCodes = Object.keys(leagueSet);
    const matches = await db(`matches?real_score=not.is.null&league_code=in.(${leagueCodes.map(enc).join(',')})&select=league_code,match_norm,real_score`) ?? [];
    const realMap: Record<string, string> = {};
    matches.forEach((m: any) => { realMap[m.league_code + '||' + m.match_norm] = m.real_score; });

    let total = 0;
    const perLeague: Record<string, number> = {};
    for (const p of preds) {
      const real = realMap[p.league_code + '||' + p.match_norm];
      if (!real) continue;
      let pts = calcPointsForPrediction(p.outcome, p.score, real).points;
      if (p.is_joker === true) pts *= 2; // джокер x2
      total += pts;
      perLeague[p.league_code] = (perLeague[p.league_code] || 0) + pts;
      await awardHitXP(clean, p.league_code, p.match_norm, pts, real);
    }
    await db('user_points?on_conflict=user_name', {
      method: 'post',
      body: [{ user_name: clean, total_points: total, per_league: perLeague, updated_at: new Date().toISOString() }],
      prefer: 'return=minimal,resolution=merge-duplicates',
    });
  } catch (e) {
    console.log('recalcUserPoints [' + clean + ']: ' + e);
  }
}

// ------------------------------------------------------------
//  Обновление одной лиги
// ------------------------------------------------------------
async function updateLeague(leagueCode: string) {
  const cfg = (LEAGUES as any)[leagueCode];
  if (!cfg) return { league: leagueCode, ok: false, error: 'Лига не найдена' };

  console.log(`=== Обновление ${cfg.name} (${leagueCode}) ===`);

  // Матчи без счёта ДО обновления — чтобы потом пересчитать только их
  const beforeRows = await db(`matches?league_code=eq.${enc(leagueCode)}&real_score=is.null&select=match_norm`) ?? [];
  const beforeUnset = new Set(beforeRows.map((r: any) => r.match_norm));

  let raw: RawMatch[];
  if (leagueCode === 'UNL') {
    const season = `${TARGET_YEAR}-${TARGET_YEAR + 1}`;
    raw = await fetchNationsLeagueFromTheSportsDB(season);
  } else {
    raw = await fetchAllMatchesForLeague(cfg.competition);
  }
  if (!raw.length) return { league: leagueCode, ok: false, error: 'Нет данных от API' };

  const matches = raw.filter((m) => m.utcDate && new Date(m.utcDate).getFullYear() === TARGET_YEAR);
  if (!matches.length) return { league: leagueCode, ok: false, error: `Нет матчей за ${TARGET_YEAR}` };

  const rows = matches.map((m) => toMatchRow(leagueCode, m));

  // Upsert пачками по 200
  let upserted = 0;
  for (let b = 0; b < rows.length; b += 200) {
    const chunk = rows.slice(b, b + 200);
    try {
      await db('matches?on_conflict=league_code,match_norm', {
        method: 'post',
        body: chunk,
        prefer: 'return=minimal,resolution=merge-duplicates',
      });
      upserted += chunk.length;
    } catch (e) {
      console.log(`❌ upsert matches [${leagueCode}] chunk ${b}: ` + e);
      return { league: leagueCode, ok: false, error: String(e) };
    }
  }

  // Какие матчи получили счёт только что
  const newlyScored = rows.filter((r) => r.real_score && beforeUnset.has(r.match_norm));

  console.log(`✅ ${leagueCode}: матчей в БД ${upserted}, новых счетов ${newlyScored.length}`);
  return { league: leagueCode, ok: true, matches: upserted, newlyScored };
}

// ------------------------------------------------------------
//  HTTP-обработчик
// ------------------------------------------------------------
Deno.serve(async (req) => {
  // Защита от посторонних вызовов
  const auth = req.headers.get('Authorization') || '';
  if (!ADMIN_SECRET || auth !== 'Bearer ' + ADMIN_SECRET) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  const url = new URL(req.url);
  const onlyLeague = url.searchParams.get('league');
  const fullRecalc = url.searchParams.get('full') === '1';

  const codes = Object.keys(LEAGUES).filter((c) => !onlyLeague || c === onlyLeague);
  const results: any[] = [];
  const affectedNorms: Record<string, Set<string>> = {};

  for (const code of codes) {
    const r = await updateLeague(code);
    results.push(r);
    if ((r as any).ok && (r as any).newlyScored?.length) {
      if (!affectedNorms[code]) affectedNorms[code] = new Set();
      (r as any).newlyScored.forEach((m: any) => affectedNorms[code].add(m.match_norm));
    }
    // Пауза между лигами — щадим квоту API
    if (codes.indexOf(code) < codes.length - 1) await sleep(PAGE_DELAY_MS);
  }

  // ── Пересчёт очков ──
  let recalced = 0;
  if (fullRecalc) {
    const allUsers = await db('user_points?select=user_name&limit=1000') ?? [];
    const predUsers = await db('predictions?select=user_name') ?? [];
    const names = new Set<string>();
    allUsers.forEach((u: any) => names.add(u.user_name));
    predUsers.forEach((u: any) => names.add(u.user_name));
    for (const name of names) { await recalcUserPoints(name); recalced++; }
  } else {
    // Только пользователи с прогнозами на новые счета
    const names = new Set<string>();
    for (const code of Object.keys(affectedNorms)) {
      const norms = Array.from(affectedNorms[code]);
      for (let i = 0; i < norms.length; i += 10) {
        const chunk = norms.slice(i, i + 10);
        const preds = await db(`predictions?league_code=eq.${enc(code)}&match_norm=in.(${chunk.map(enc).join(',')})&select=user_name`) ?? [];
        preds.forEach((p: any) => names.add(p.user_name));
      }
    }
    for (const name of names) { await recalcUserPoints(name); recalced++; }
  }

  invalidateRating();

  return json({
    ok: true,
    targetYear: TARGET_YEAR,
    leagues: results.map((r) => ({ league: (r as any).league, ok: (r as any).ok, matches: (r as any).matches || 0, newlyScored: (r as any).newlyScored?.length || 0, error: (r as any).error })),
    recalcedUsers: recalced,
    fullRecalc,
  });
});
