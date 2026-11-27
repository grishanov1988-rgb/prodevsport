// ============================================================
//  ADMIN-ОБРАБОТЧИКИ (этап 8) — порт admin_* из Code.gs.
//  Триггеры/цепочки GAS заменены cron-расписанием Supabase.
// ============================================================

import { db, dbAll } from '../_shared/db.ts';
import { LEAGUES, SUPABASE_URL, ADMIN_SECRET, BOT_TOKEN } from '../_shared/config.ts';
import { enc, formatDateMsk, calcPointsForPrediction } from '../_shared/util.ts';
import { buildRating, invalidateRating, getUserAchievements, getUserChats } from '../_shared/core.ts';
import { getXPProfile, checkStreakAchievements } from '../_shared/gamification.ts';
import { invalidateTaskTemplates } from '../_shared/gamification.ts';
import { recalcUserPoints, rebuildAllUserPoints, recalcUsers } from '../_shared/recalc.ts';
import { sendText } from '../_shared/telegram.ts';

// ------------------------------------------------------------
//  Журнал событий админки (вместо Script Properties GAS)
// ------------------------------------------------------------
export async function logAdminEvent(type: string, message: string): Promise<void> {
  try {
    await db('admin_events', {
      method: 'post',
      body: [{ type, message: String(message).substring(0, 200), created_at: new Date().toISOString() }],
      prefer: 'return=minimal',
    });
  } catch { /* ignore */ }
}

async function getAdminEvents(): Promise<any[]> {
  try {
    return (await db('admin_events?order=created_at.desc&limit=30')) ?? [];
  } catch { return []; }
}

// ------------------------------------------------------------
//  getBootstrap — метрики + статус webhook
// ------------------------------------------------------------
export async function adminGetBootstrap() {
  try {
    let sbOk = 'ok';
    let usersCount = 0, predsCount = 0, matchesCount = 0, scoredCount = 0, preds24h = 0, active7d = 0;
    try {
      const u = await db('users?select=user_name') ?? []; usersCount = u.length;
      const p = await db('predictions?select=id') ?? []; predsCount = p.length;
      const m = await db('matches?select=id') ?? []; matchesCount = m.length;
      const ms = await db('matches?real_score=not.is.null&select=id') ?? []; scoredCount = ms.length;
      const cutoff24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const cutoff7d = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
      const p24 = await db(`predictions?select=id&saved_at=gte.${enc(cutoff24h)}`) ?? []; preds24h = p24.length;
      const p7 = await db(`predictions?select=user_name&saved_at=gte.${enc(cutoff7d)}`) ?? [];
      const uniq: Record<string, boolean> = {};
      p7.forEach((r: any) => { if (r.user_name) uniq[r.user_name] = true; });
      active7d = Object.keys(uniq).length;
    } catch (e: any) { sbOk = e.message || String(e); }

    // Расписание cron (pg_cron)
    let cronJobs: any[] = [];
    try {
      cronJobs = (await db('cron.job?select=jobname,schedule,active')) ?? [];
    } catch { /* pg_cron может быть не включён */ }

    let webhookStatus = 'unknown'; let webhookError = '';
    try {
      const whRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`);
      const whData = await whRes.json();
      if (whData.ok && whData.result) {
        webhookStatus = whData.result.url ? 'ok' : 'no url';
        webhookError = whData.result.last_error_message || '';
      }
    } catch { webhookStatus = 'err'; }

    return {
      ok: true,
      status: {
        supabase: sbOk,
        cron: cronJobs,
        webhook: webhookStatus,
        webhookError,
        backend: 'supabase',
      },
      metrics: { users: usersCount, predictions: predsCount, matches: matchesCount, scoredMatches: scoredCount, preds24h, active7d },
      events: await getAdminEvents(),
    };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

// ------------------------------------------------------------
//  Пользователи
// ------------------------------------------------------------
export async function adminGetUsers(_page: unknown, search: unknown) {
  try {
    const page = Math.max(1, parseInt(String(_page), 10) || 1);
    const limit = 30; const offset = (page - 1) * limit;
    let searchPart = '';
    if (search && String(search).trim()) {
      const s = enc(String(search).trim());
      searchPart = `&or=(user_name.ilike.*${s}*,first_name.ilike.*${s}*,username.ilike.*${s}*)`;
    }
    const users = await db(`users?select=user_name,chat_id,first_name,last_name,username${searchPart}&order=user_name.asc&limit=${limit}&offset=${offset}`) ?? [];
    const names = users.map((u: any) => u.user_name);
    const stats: Record<string, number> = {};
    const xps: Record<string, any> = {};
    if (names.length) {
      const inList = names.map(enc).join(',');
      try {
        const predsRows = await db(`predictions?user_name=in.(${inList})&select=user_name`) ?? [];
        predsRows.forEach((p: any) => { stats[p.user_name] = (stats[p.user_name] || 0) + 1; });
      } catch { /* ignore */ }
      try {
        const upRows = await db(`user_points?user_name=in.(${inList})&select=user_name,total_points`) ?? [];
        upRows.forEach((r: any) => { stats[r.user_name + '_pts'] = Number(r.total_points) || 0; });
      } catch { /* ignore */ }
      try {
        const xpRows = await db(`xp_profiles?user_name=in.(${inList})&select=user_name,total_xp,level,streak`) ?? [];
        xpRows.forEach((r: any) => { xps[r.user_name] = r; });
      } catch { /* ignore */ }
    }
    const list = users.map((u: any) => ({
      userName: u.user_name, chatId: u.chat_id, firstName: u.first_name || '', lastName: u.last_name || '',
      username: u.username || '', preds: stats[u.user_name] || 0, points: stats[u.user_name + '_pts'] || 0,
      xp: xps[u.user_name] ? Number(xps[u.user_name].total_xp) || 0 : 0,
      level: xps[u.user_name] ? Number(xps[u.user_name].level) || 0 : 0,
      streak: xps[u.user_name] ? Number(xps[u.user_name].streak) || 0 : 0,
    }));
    return { ok: true, users: list, page, hasMore: users.length === limit };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

export async function adminGetUserDetail(userName: unknown) {
  try {
    const clean = String(userName || '').trim();
    if (!clean) return { ok: false, error: 'Не указано имя' };
    const users = await db(`users?user_name=eq.${enc(clean)}`) ?? [];
    const u: any = users[0] || {};
    const preds = await db(`predictions?user_name=eq.${enc(clean)}&select=id`) ?? [];
    const ratingRows = await db(`user_points?user_name=eq.${enc(clean)}`) ?? [];
    const points = ratingRows[0] ? Number(ratingRows[0].total_points) || 0 : 0;
    const xp = await getXPProfile(clean);
    const achs = await getUserAchievements(clean);
    let place: number | string = '-';
    try {
      const all = await buildRating();
      for (let i = 0; i < all.length; i++) { if (all[i].name === clean) { place = i + 1; break; } }
    } catch { /* ignore */ }
    return {
      ok: true,
      user: {
        userName: clean, chatId: u.chat_id || null, firstName: u.first_name || '', lastName: u.last_name || '',
        username: u.username || '', preds: preds.length, points, place, xp, achievements: achs,
      },
    };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

export async function adminRecalcUser(userName: unknown) {
  try {
    await recalcUserPoints(String(userName || ''));
    await checkStreakAchievements(String(userName || ''));
    await logAdminEvent('ok', 'Пересчёт для ' + userName);
    return { ok: true };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

// ------------------------------------------------------------
//  Матчи
// ------------------------------------------------------------
export async function adminGetMatches(league: unknown, tour: unknown) {
  try {
    let filter = '';
    if (league && league !== 'all') filter += `&league_code=eq.${enc(String(league))}`;
    if (tour && String(tour).trim()) filter += `&tour_num=eq.${parseInt(String(tour), 10)}`;
    const rows = await db(`matches?select=id,league_code,tour_num,match_name,match_norm,real_score,utc_date,winner${filter}&order=utc_date.desc&limit=100`) ?? [];
    const matchNorms = rows.map((r: any) => r.match_norm);
    const predCounts: Record<string, number> = {};
    if (matchNorms.length) {
      try {
        for (let i = 0; i < matchNorms.length; i += 20) {
          const ch = matchNorms.slice(i, i + 20);
          const ps = await db(`predictions?match_norm=in.(${ch.map(enc).join(',')})&select=id,match_norm`) ?? [];
          ps.forEach((p: any) => { predCounts[p.match_norm] = (predCounts[p.match_norm] || 0) + 1; });
        }
      } catch { /* ignore */ }
    }
    const list = rows.map((r: any) => ({
      id: r.id,
      leagueCode: r.league_code,
      leagueName: (LEAGUES as any)[r.league_code] ? (LEAGUES as any)[r.league_code].name : r.league_code,
      tourNum: r.tour_num, matchName: r.match_name, matchNorm: r.match_norm,
      realScore: r.real_score || null, winner: r.winner || null,
      timeStr: r.utc_date ? formatDateMsk(r.utc_date, 'dd.MM HH:mm') : '',
      utcDate: r.utc_date,
      predCount: predCounts[r.match_norm] || 0,
    }));
    return { ok: true, matches: list };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

export async function adminSaveMatchScore(matchId: unknown, newScore: unknown) {
  try {
    const score = String(newScore || '').trim().replace(/\s/g, '').replace(/:/g, '-');
    if (!/^\d+-\d+$/.test(score)) return { ok: false, error: 'Неверный формат счёта. Ожидается X-Y' };
    const m = score.match(/^(\d+)-(\d+)$/)!;
    const h = Number(m[1]), a = Number(m[2]);
    const winner = h > a ? 'П1' : h < a ? 'П2' : 'Ничья';
    await db(`matches?id=eq.${parseInt(String(matchId), 10)}`, {
      method: 'patch',
      body: { real_score: score, winner },
      prefer: 'return=minimal',
    });
    const matchRow = await db(`matches?id=eq.${parseInt(String(matchId), 10)}&select=league_code,match_norm`) ?? [];
    if (matchRow.length) {
      const lc = matchRow[0].league_code; const mn = matchRow[0].match_norm;
      const preds = await db(`predictions?league_code=eq.${enc(lc)}&match_norm=eq.${enc(mn)}&select=user_name`) ?? [];
      const affected = new Set<string>();
      preds.forEach((p: any) => { if (p.user_name) affected.add(p.user_name); });
      await recalcUsers(Array.from(affected));
    }
    await logAdminEvent('ok', 'Счёт матча #' + matchId + ' → ' + score);
    return { ok: true };
  } catch (e: any) {
    await logAdminEvent('err', 'Ошибка сохранения счёта: ' + e.message);
    return { ok: false, error: e.message };
  }
}

// ------------------------------------------------------------
//  Прогнозы
// ------------------------------------------------------------
export async function adminGetMatchPredictions(leagueCode: unknown, matchNorm: unknown) {
  try {
    const preds = await db(`predictions?league_code=eq.${enc(String(leagueCode))}&match_norm=eq.${enc(String(matchNorm))}&order=user_name.asc`) ?? [];
    const matchRow = await db(`matches?league_code=eq.${enc(String(leagueCode))}&match_norm=eq.${enc(String(matchNorm))}&limit=1`) ?? [];
    const realScore = matchRow[0] ? matchRow[0].real_score : null;
    const list = preds.map((p: any) => {
      let pts: number | null = null;
      if (realScore) pts = calcPointsForPrediction(p.outcome, p.score, realScore).points;
      return { id: p.id, userName: p.user_name, outcome: p.outcome, score: p.score, points: pts };
    });
    return { ok: true, predictions: list, realScore };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

export async function adminGetPredictions(_page: unknown, search: unknown) {
  try {
    const page = Math.max(1, parseInt(String(_page), 10) || 1);
    const limit = 30; const offset = (page - 1) * limit;
    let filter = '';
    if (search && String(search).trim()) {
      const s = enc(String(search).trim());
      filter = `&or=(user_name.ilike.*${s}*,match_name.ilike.*${s}*)`;
    }
    const rows = await db(`predictions?select=id,user_name,league_code,match_name,match_norm,outcome,score,saved_at${filter}&order=saved_at.desc&limit=${limit}&offset=${offset}`) ?? [];
    const list = rows.map((p: any) => ({
      id: p.id, userName: p.user_name, leagueCode: p.league_code,
      leagueName: (LEAGUES as any)[p.league_code] ? (LEAGUES as any)[p.league_code].name : p.league_code,
      matchName: p.match_name, outcome: p.outcome, score: p.score, savedAt: p.saved_at,
    }));
    return { ok: true, predictions: list, page, hasMore: rows.length === limit };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

export async function adminDeletePrediction(predId: unknown) {
  try {
    const row = await db(`predictions?id=eq.${parseInt(String(predId), 10)}&select=user_name`) ?? [];
    const user = row[0] ? row[0].user_name : null;
    await db(`predictions?id=eq.${parseInt(String(predId), 10)}`, { method: 'delete', prefer: 'return=minimal' });
    if (user) await recalcUserPoints(user);
    await logAdminEvent('ok', 'Удалён прогноз #' + predId);
    return { ok: true };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

export async function adminEditPrediction(predId: unknown, outcome: unknown, score: unknown) {
  try {
    const cleanScore = String(score || '').replace(/\s/g, '').replace(/:/g, '-');
    if (!/^\d+-\d+$/.test(cleanScore)) return { ok: false, error: 'Неверный формат счёта' };
    const row = await db(`predictions?id=eq.${parseInt(String(predId), 10)}&select=user_name`) ?? [];
    const user = row[0] ? row[0].user_name : null;
    await db(`predictions?id=eq.${parseInt(String(predId), 10)}`, {
      method: 'patch',
      body: { outcome, score: cleanScore },
      prefer: 'return=minimal',
    });
    if (user) await recalcUserPoints(user);
    await logAdminEvent('ok', 'Изменён прогноз #' + predId);
    return { ok: true };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

// ------------------------------------------------------------
//  Обновления / синхронизация
// ------------------------------------------------------------
export async function adminStartUpdate(league: unknown) {
  // Парсеры запускаются в отдельной функции; вызываем её «вслепую» —
  // админке не нужно ждать окончания (может занять минуты)
  try {
    const lg = String(league || '').trim().toUpperCase();
    const qs = lg && (LEAGUES as any)[lg] ? `?league=${lg}` : '';
    fetch(`${SUPABASE_URL}/functions/v1/jobs-parse${qs}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ADMIN_SECRET}` },
    }).catch(() => {});
    await logAdminEvent('ok', 'Запущено обновление лиг (jobs-parse' + (qs ? ' ' + lg : '') + ')');
    return { ok: true, started: true, league: lg || 'ALL' };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

// Статус запусков jobs-parse: последние прогоны + прогресс по лигам
export async function adminGetJobStatus() {
  try {
    const runs = await db('job_runs?order=id.desc&limit=12&select=id,job,league,status,stage,leagues,started_at,finished_at,error') ?? [];
    const running = runs.find((r: any) => r.status === 'running') || null;
    return { ok: true, running, runs };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

export async function adminRunSync() {
  // Sheets исключены: «sync» = парсинг API + полный пересчёт
  try {
    fetch(`${SUPABASE_URL}/functions/v1/jobs-parse?full=1`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ADMIN_SECRET}` },
    }).catch(() => {});
    await logAdminEvent('ok', 'Sync (jobs-parse full) запущен');
    return { ok: true, started: true };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

export async function adminRebuildUserPoints() {
  try {
    const n = await rebuildAllUserPoints();
    await logAdminEvent('ok', 'Пересчёт всех user_points (' + n + ' игроков)');
    return { ok: true, recalced: n };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

export async function adminCheckConnection() {
  try {
    await db('users?limit=1');
    return { ok: true };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

// ------------------------------------------------------------
//  Служебные (заглушки с осмысленным ответом — механизмов GAS нет)
// ------------------------------------------------------------
export async function adminGetChainStatus() {
  return { ok: true, chain: null, note: 'Цепочка триггеров не нужна: парсеры работают по cron' };
}
export async function adminResetChain() {
  return { ok: true, note: 'Цепочка триггеров не нужна: парсеры работают по cron' };
}
export async function adminContinueChain() {
  return { ok: true, note: 'Цепочка триггеров не нужна: парсеры работают по cron' };
}
export async function adminGetTriggers() {
  return { ok: true, triggers: [], note: 'Триггеры заменены cron-расписанием (см. раздел Cron в дашборде)' };
}
export async function adminDeleteAllTriggers() {
  return { ok: true, note: 'Триггеры заменены cron-расписанием' };
}
export async function adminRecreateTriggers() {
  return { ok: true, note: 'Расписание настраивается в pg_cron (миграция 0001, закомментированные блоки)' };
}

export async function adminClearCache() {
  try {
    invalidateRating();
    invalidateTaskTemplates();
    await logAdminEvent('ok', 'Кэш очищен');
    return { ok: true };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

// ------------------------------------------------------------
//  Рассылка и аналитика
// ------------------------------------------------------------
export async function adminBroadcast(target: unknown, text: unknown) {
  try {
    const msg = String(text || '').trim();
    if (!msg || msg.length > 4000) return { ok: false, error: 'Текст пустой или слишком длинный' };
    const userChats = await getUserChats();
    const allNames = Object.keys(userChats);
    let recipients: string[] = [];
    if (target === 'all') {
      recipients = allNames;
    } else if (target === 'with_preds') {
      const preds = await db('predictions?select=user_name') ?? [];
      const withPreds: Record<string, boolean> = {};
      preds.forEach((p: any) => { if (p.user_name) withPreds[p.user_name] = true; });
      recipients = allNames.filter((n) => withPreds[n]);
    }
    let sent = 0, failed = 0;
    for (let i = 0; i < recipients.length; i++) {
      const u = recipients[i];
      const result = await sendText(userChats[u], msg, null);
      if (result && result.ok) sent++; else failed++;
      if (i % 20 === 19) await new Promise((r) => setTimeout(r, 1000));
    }
    await logAdminEvent('ok', 'Рассылка: ' + sent + '/' + recipients.length);
    return { ok: true, sent, failed, total: recipients.length };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

export async function adminGetBroadcastStats() {
  try {
    const userChats = await getUserChats();
    const total = Object.keys(userChats).length;
    const preds = await db('predictions?select=user_name') ?? [];
    const withPreds: Record<string, boolean> = {};
    preds.forEach((p: any) => { if (p.user_name) withPreds[p.user_name] = true; });
    return { ok: true, total, withPreds: Object.keys(withPreds).length };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

export async function adminGetAnalytics(days: unknown) {
  try {
    const d = parseInt(String(days), 10) || 7;
    const cutoff = new Date(Date.now() - d * 24 * 3600 * 1000).toISOString();
    const preds = await db(`predictions?select=user_name,league_code,saved_at&saved_at=gte.${enc(cutoff)}`) ?? [];
    const byDay: Record<string, number> = {}; const byUser: Record<string, number> = {}; const byLeague: Record<string, number> = {};
    preds.forEach((p: any) => {
      if (p.saved_at) {
        const dayKey = formatDateMsk(p.saved_at, 'yyyy-MM-dd');
        byDay[dayKey] = (byDay[dayKey] || 0) + 1;
      }
      if (p.user_name) byUser[p.user_name] = (byUser[p.user_name] || 0) + 1;
      if (p.league_code) byLeague[p.league_code] = (byLeague[p.league_code] || 0) + 1;
    });
    let top: any[] = [];
    try {
      const userPoints = await db('user_points?select=user_name,total_points&order=total_points.desc&limit=5') ?? [];
      top = userPoints.map((r: any) => ({ name: r.user_name, points: Number(r.total_points) || 0 }));
    } catch { /* ignore */ }
    return { ok: true, days: d, totalPredictions: preds.length, byDay, byUser, byLeague, top };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

// ------------------------------------------------------------
//  Боты (для битв)
// ------------------------------------------------------------
function classifyPos(pos: unknown): string {
  const p = String(pos || '').toUpperCase().trim();
  for (const group in POSITION_GROUPS) {
    if (POSITION_GROUPS[group].indexOf(p) !== -1) return group;
  }
  return 'MID';
}

const POSITION_GROUPS: Record<string, string[]> = {
  GK: ['GK'],
  DEF: ['CB', 'LB', 'RB', 'LWB', 'RWB', 'DEF', 'SW'],
  MID: ['CM', 'CDM', 'CAM', 'LM', 'RM', 'MF', 'MID'],
  FWD: ['ST', 'CF', 'LW', 'RW', 'SS', 'FWD'],
  COACH: ['COACH'],
};

const BOT_FORMATION_SLOTS = [
  { index: 0, group: 'GK' }, { index: 1, group: 'DEF' }, { index: 2, group: 'DEF' },
  { index: 3, group: 'DEF' }, { index: 4, group: 'DEF' }, { index: 5, group: 'MID' },
  { index: 6, group: 'MID' }, { index: 7, group: 'MID' }, { index: 8, group: 'FWD' },
  { index: 9, group: 'FWD' }, { index: 10, group: 'FWD' },
];

export async function adminCreateBotTeams(count: unknown) {
  const n = parseInt(String(count), 10) || 5;
  const catalog = await dbAll('cards_catalog?is_active=eq.true&select=id,name,position,ovr,rarity') ?? [];
  if (!catalog.length) return { ok: false, error: 'Нет карточек' };

  const byGroup: Record<string, any[]> = { GK: [], DEF: [], MID: [], FWD: [], COACH: [] };
  catalog.forEach((c: any) => {
    const g = classifyPos(c.position);
    if (byGroup[g]) byGroup[g].push(c);
  });
  for (const g in byGroup) {
    if (!byGroup[g].length) return { ok: false, error: 'Нет карточек для ' + g };
  }

  let created = 0;
  const botNames: string[] = [];

  for (let i = 0; i < n; i++) {
    const botName = 'Bot_' + (i + 1) + '_' + Math.random().toString(36).substring(2, 6);
    const slots: any[] = [];
    const used: Record<string, boolean> = {};

    for (const def of BOT_FORMATION_SLOTS) {
      const pool = byGroup[def.group] || [];
      let candidates = pool.filter((c: any) => !used[c.id]);
      if (!candidates.length) candidates = pool;
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      used[pick.id] = true;
      slots.push({ index: def.index, cardId: pick.id });
    }

    const coachPool = byGroup.COACH;
    const coach = coachPool[Math.floor(Math.random() * coachPool.length)];

    try {
      await db('user_teams?on_conflict=user_name', {
        method: 'post',
        body: [{
          user_name: botName, team_name: 'Bot Squad ' + (i + 1), formation: '4-3-3',
          coach_card_id: coach.id, is_bot: true, updated_at: new Date().toISOString(),
        }],
        prefer: 'return=minimal,resolution=merge-duplicates',
      });
      await db(`user_team_slots?user_name=eq.${enc(botName)}`, { method: 'delete', prefer: 'return=minimal' });
      const rows = slots.map((s) => ({ user_name: botName, slot_index: s.index, card_id: s.cardId }));
      await db('user_team_slots', { method: 'post', body: rows, prefer: 'return=minimal' });
      created++;
      botNames.push(botName);
    } catch { /* ignore */ }
  }

  await logAdminEvent('ok', 'Создано ботов: ' + created);
  return { ok: true, created, botNames };
}

export async function adminDeleteBotTeams() {
  try {
    const bots = await db('user_teams?is_bot=eq.true&select=user_name') ?? [];
    const names = bots.map((b: any) => b.user_name);
    for (const name of names) {
      await db(`user_team_slots?user_name=eq.${enc(name)}`, { method: 'delete', prefer: 'return=minimal' });
      await db(`user_teams?user_name=eq.${enc(name)}`, { method: 'delete', prefer: 'return=minimal' });
    }
    await logAdminEvent('ok', 'Удалено ботов: ' + names.length);
    return { ok: true, deleted: names.length };
  } catch (e: any) { return { ok: false, error: e.message }; }
}
