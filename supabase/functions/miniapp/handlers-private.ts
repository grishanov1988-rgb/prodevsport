// ============================================================
//  ПРИВАТНЫЕ ЛИГИ — порт из Code.gs (этап 3)
// ============================================================

import { db } from '../_shared/db.ts';
import { enc, formatDateMsk, calcPointsForPrediction } from '../_shared/util.ts';

const PRIVATE_LEAGUE_LIMIT_PER_USER = 10;
const PRIVATE_LEAGUE_MAX_MEMBERS = 50;

// Код из 6 символов без 0/O/1/I/L — легко диктовать голосом
function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}

// ------------------------------------------------------------
//  createPrivateLeague
// ------------------------------------------------------------
export async function createPrivateLeague(chatId: unknown, userName: unknown, name: unknown, emoji: unknown, description: unknown) {
  try {
    const cleanUser = String(userName || '').trim();
    const cleanName = String(name || '').trim().substring(0, 40);
    const cleanDesc = String(description || '').trim().substring(0, 200);
    const cleanEmoji = String(emoji || '🏆').trim().substring(0, 4);

    if (!cleanUser) return { ok: false, error: 'Не указан пользователь' };
    if (!cleanName) return { ok: false, error: 'Укажите название лиги' };

    const myLeagues = await db(`private_leagues?creator_user_name=eq.${enc(cleanUser)}&select=id`) ?? [];
    if (myLeagues.length >= PRIVATE_LEAGUE_LIMIT_PER_USER) {
      return { ok: false, error: 'Максимум ' + PRIVATE_LEAGUE_LIMIT_PER_USER + ' созданных лиг' };
    }

    let code: string | null = null;
    for (let attempt = 0; attempt < 12; attempt++) {
      const candidate = generateInviteCode();
      const exists = await db(`private_leagues?invite_code=eq.${enc(candidate)}&select=id`) ?? [];
      if (!exists.length) { code = candidate; break; }
    }
    if (!code) return { ok: false, error: 'Не удалось создать код, попробуйте ещё раз' };

    const result = await db('private_leagues', {
      method: 'post',
      body: [{
        name: cleanName, invite_code: code, creator_user_name: cleanUser,
        creator_chat_id: Number(chatId) || 0, emoji: cleanEmoji, description: cleanDesc,
        scoring_mode: 'since_creation', is_active: true,
      }],
      prefer: 'return=representation',
    });

    const league = Array.isArray(result) ? result[0] : null;
    if (!league) return { ok: false, error: 'Ошибка создания лиги' };

    await db('private_league_members', {
      method: 'post',
      body: [{ league_id: league.id, user_name: cleanUser, chat_id: Number(chatId) || 0 }],
      prefer: 'return=minimal,resolution=ignore-duplicates',
    });

    return { ok: true, league: { id: league.id, name: league.name, inviteCode: league.invite_code, emoji: league.emoji } };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

// ------------------------------------------------------------
//  joinPrivateLeague
// ------------------------------------------------------------
export async function joinPrivateLeague(chatId: unknown, userName: unknown, inviteCode: unknown) {
  try {
    const cleanUser = String(userName || '').trim();
    const cleanCode = String(inviteCode || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!cleanUser) return { ok: false, error: 'Не указан пользователь' };
    if (cleanCode.length !== 6) return { ok: false, error: 'Код должен быть из 6 символов' };

    const leagues = await db(`private_leagues?invite_code=eq.${enc(cleanCode)}&is_active=eq.true`) ?? [];
    if (!leagues.length) return { ok: false, error: 'Лига с таким кодом не найдена' };
    const league = leagues[0];

    const existing = await db(`private_league_members?league_id=eq.${league.id}&user_name=eq.${enc(cleanUser)}&select=id`) ?? [];
    if (existing.length) {
      return {
        ok: true,
        league: { id: league.id, name: league.name, emoji: league.emoji, inviteCode: league.invite_code },
        alreadyMember: true,
      };
    }

    const members = await db(`private_league_members?league_id=eq.${league.id}&select=id`) ?? [];
    const maxMembers = league.max_members || PRIVATE_LEAGUE_MAX_MEMBERS;
    if (members.length >= maxMembers) return { ok: false, error: 'Лига заполнена (максимум ' + maxMembers + ' участников)' };

    await db('private_league_members', {
      method: 'post',
      body: [{ league_id: league.id, user_name: cleanUser, chat_id: Number(chatId) || 0 }],
      prefer: 'return=minimal,resolution=ignore-duplicates',
    });

    return { ok: true, league: { id: league.id, name: league.name, emoji: league.emoji, inviteCode: league.invite_code } };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

// ------------------------------------------------------------
//  getMyPrivateLeagues
// ------------------------------------------------------------
export async function getMyPrivateLeagues(_chatId: unknown, userName: unknown) {
  try {
    const cleanUser = String(userName || '').trim();
    if (!cleanUser) return { ok: false, error: 'Не указан пользователь' };

    const memberships = await db(`private_league_members?user_name=eq.${enc(cleanUser)}&select=league_id,joined_at`) ?? [];
    if (!memberships.length) return { ok: true, leagues: [] };

    const ids = memberships.map((m: any) => m.league_id);
    const idList = ids.map((v: any) => enc(String(v))).join(',');
    const leagues = await db(`private_leagues?id=in.(${idList})&is_active=eq.true&order=created_at.desc`) ?? [];

    const allMembers = await db(`private_league_members?league_id=in.(${idList})&select=league_id`) ?? [];
    const counts: Record<string, number> = {};
    allMembers.forEach((m: any) => { counts[m.league_id] = (counts[m.league_id] || 0) + 1; });

    const list = leagues.map((l: any) => ({
      id: l.id, name: l.name, emoji: l.emoji, inviteCode: l.invite_code,
      membersCount: counts[l.id] || 0, createdAt: l.created_at,
      isCreator: l.creator_user_name === cleanUser,
    }));

    return { ok: true, leagues: list };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

// ------------------------------------------------------------
//  getAvailableMatchesForLeague (только создатель)
// ------------------------------------------------------------
export async function getAvailableMatchesForLeague(leagueId: unknown, _chatId: unknown, userName: unknown) {
  try {
    const cleanUser = String(userName || '').trim();
    const leagueRows = await db(`private_leagues?id=eq.${enc(String(leagueId))}`) ?? [];
    if (!leagueRows.length) return { ok: false, error: 'Лига не найдена' };
    if (leagueRows[0].creator_user_name !== cleanUser) return { ok: false, error: 'Только создатель может добавлять матчи' };

    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayIso = todayStart.toISOString();

    const matches = await db(`matches?real_score=is.null&utc_date=gte.${enc(todayIso)}&order=utc_date.asc&limit=100`) ?? [];

    const existing = await db(`private_league_matches?league_id=eq.${enc(String(leagueId))}&select=match_id`) ?? [];
    const existingIds: Record<string, boolean> = {};
    existing.forEach((e: any) => { existingIds[e.match_id] = true; });

    const list = matches.map((m: any) => ({
      id: m.id,
      leagueCode: m.league_code,
      matchName: m.match_name,
      timeStr: m.utc_date ? formatDateMsk(m.utc_date, 'dd.MM HH:mm') : '',
      isAdded: !!existingIds[m.id],
    }));

    return { ok: true, matches: list };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

// ------------------------------------------------------------
//  addMatchesToLeague (только создатель)
// ------------------------------------------------------------
export async function addMatchesToLeague(leagueId: unknown, matchIds: unknown, _chatId: unknown, userName: unknown) {
  try {
    const cleanUser = String(userName || '').trim();
    const leagueRows = await db(`private_leagues?id=eq.${enc(String(leagueId))}`) ?? [];
    if (!leagueRows.length) return { ok: false, error: 'Лига не найдена' };
    if (leagueRows[0].creator_user_name !== cleanUser) return { ok: false, error: 'Только создатель может добавлять матчи' };
    if (!Array.isArray(matchIds) || !matchIds.length) return { ok: false, error: 'Выберите хотя бы один матч' };

    const body = matchIds.map((id) => ({ league_id: leagueId, match_id: parseInt(String(id), 10) }));

    await db('private_league_matches', {
      method: 'post',
      body,
      prefer: 'return=minimal,resolution=ignore-duplicates',
    });

    invalidatePrivateRatingCache(String(leagueId));
    return { ok: true, added: body.length };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

// ------------------------------------------------------------
//  getLeagueMatchesList
// ------------------------------------------------------------
export async function getLeagueMatchesList(leagueId: unknown, _chatId: unknown, userName: unknown) {
  try {
    const rows = await db(`private_league_matches?league_id=eq.${enc(String(leagueId))}&select=match_id,matches(id,league_code,match_name,match_norm,real_score,utc_date)`) ?? [];

    const userPreds = await db(`predictions?user_name=eq.${enc(String(userName || '').trim())}&select=league_code,match_norm,outcome,score`) ?? [];
    const predMap: Record<string, any> = {};
    userPreds.forEach((p: any) => { predMap[p.league_code + '||' + p.match_norm] = { outcome: p.outcome, score: p.score }; });

    const list = rows.map((r: any) => {
      const m = r.matches;
      if (!m) return null;
      return {
        id: m.id,
        matchName: m.match_name,
        matchNorm: m.match_norm,
        realScore: m.real_score,
        timeStr: m.utc_date ? formatDateMsk(m.utc_date, 'dd.MM HH:mm') : '',
        leagueCode: m.league_code,
        matchDateStr: m.utc_date,
        userPrediction: predMap[m.league_code + '||' + m.match_norm] || null,
      };
    }).filter(Boolean);

    list.sort((a: any, b: any) => String(a.matchDateStr || '').localeCompare(String(b.matchDateStr || '')));
    return { ok: true, matches: list };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

// ------------------------------------------------------------
//  getPrivateLeagueRating (кэш 60с, инвалидация при добавлении матчей)
// ------------------------------------------------------------
const plRatingCache = new Map<string, { at: number; data: any }>();

function invalidatePrivateRatingCache(leagueId: string): void {
  plRatingCache.delete(leagueId);
}

export async function getPrivateLeagueRating(leagueId: unknown, _chatId: unknown, userName: unknown) {
  try {
    const cleanUser = String(userName || '').trim();
    const cleanId = String(leagueId || '').trim();
    if (!cleanId) return { ok: false, error: 'Не указана лига' };

    const cached = plRatingCache.get(cleanId);
    if (cached && Date.now() - cached.at < 60_000) return cached.data;

    const leagueRows = await db(`private_leagues?id=eq.${enc(cleanId)}`) ?? [];
    if (!leagueRows.length) return { ok: false, error: 'Лига не найдена' };
    const league = leagueRows[0];

    const members = await db(`private_league_members?league_id=eq.${enc(cleanId)}&select=user_name,joined_at&order=joined_at.asc`) ?? [];

    const leaguePayload = {
      id: league.id, name: league.name, emoji: league.emoji,
      inviteCode: league.invite_code, creator: league.creator_user_name,
      createdAt: league.created_at, membersCount: members.length,
      scoringMode: league.scoring_mode,
    };

    if (!members.length) {
      return { ok: true, league: leaguePayload, rating: [], isCreator: league.creator_user_name === cleanUser };
    }

    const memberNames: string[] = members.map((m: any) => m.user_name);

    const leagueMatches = await db(`private_league_matches?league_id=eq.${enc(cleanId)}&select=match_id,matches(match_name,real_score,league_code,match_norm)`) ?? [];

    const realMap: Record<string, string> = {};
    leagueMatches.forEach((lm: any) => {
      const m = lm.matches;
      if (!m) return;
      if (m.real_score) realMap[m.league_code + '||' + m.match_norm] = m.real_score;
    });

    if (!leagueMatches.length) {
      const zeroRating = memberNames.map((u) => ({ userName: u, points: 0, predictions: 0, resolved: 0, place: 1 }));
      return { ok: true, league: leaguePayload, rating: zeroRating, isCreator: league.creator_user_name === cleanUser, noPlayedYet: true };
    }

    let allPreds: any[] = [];
    for (let i = 0; i < memberNames.length; i += 10) {
      const chunk = memberNames.slice(i, i + 10);
      const preds = await db(`predictions?user_name=in.(${chunk.map(enc).join(',')})&select=user_name,league_code,match_norm,outcome,score`) ?? [];
      allPreds = allPreds.concat(preds);
    }

    const stats: Record<string, { points: number; predictions: number; resolved: number }> = {};
    memberNames.forEach((u) => { stats[u] = { points: 0, predictions: 0, resolved: 0 }; });

    allPreds.forEach((p: any) => {
      if (!stats[p.user_name]) return;
      const realScore = realMap[p.league_code + '||' + p.match_norm];
      stats[p.user_name].predictions += 1;
      if (!realScore) return;
      const res = calcPointsForPrediction(p.outcome, p.score, realScore);
      stats[p.user_name].points += res.points;
      stats[p.user_name].resolved += 1;
    });

    const rating = memberNames.map((u) => ({ userName: u, points: stats[u].points, predictions: stats[u].predictions, resolved: stats[u].resolved }));
    rating.sort((a, b) => b.points - a.points || a.userName.localeCompare(b.userName, 'ru'));

    let lastPts: number | null = null; let lastPlace = 0;
    rating.forEach((r, i) => {
      if (r.points === lastPts) (r as any).place = lastPlace;
      else { (r as any).place = i + 1; lastPts = r.points; lastPlace = (r as any).place; }
    });

    const result = { ok: true, league: leaguePayload, rating, isCreator: league.creator_user_name === cleanUser };
    plRatingCache.set(cleanId, { at: Date.now(), data: result });
    return result;
  } catch (e: any) { return { ok: false, error: e.message }; }
}

// ------------------------------------------------------------
//  leavePrivateLeague (не создатель)
// ------------------------------------------------------------
export async function leavePrivateLeague(_chatId: unknown, userName: unknown, leagueId: unknown) {
  try {
    const cleanUser = String(userName || '').trim();
    const cleanId = String(leagueId || '').trim();

    const leagueRows = await db(`private_leagues?id=eq.${enc(cleanId)}`) ?? [];
    if (!leagueRows.length) return { ok: false, error: 'Лига не найдена' };
    if (leagueRows[0].creator_user_name === cleanUser) {
      return { ok: false, error: 'Создатель не может покинуть лигу. Удалите её.' };
    }

    await db(`private_league_members?league_id=eq.${enc(cleanId)}&user_name=eq.${enc(cleanUser)}`, {
      method: 'delete',
      prefer: 'return=minimal',
    });

    invalidatePrivateRatingCache(cleanId);
    return { ok: true };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

// ------------------------------------------------------------
//  deletePrivateLeague (только создатель)
// ------------------------------------------------------------
export async function deletePrivateLeague(_chatId: unknown, userName: unknown, leagueId: unknown) {
  try {
    const cleanUser = String(userName || '').trim();
    const cleanId = String(leagueId || '').trim();

    const leagueRows = await db(`private_leagues?id=eq.${enc(cleanId)}`) ?? [];
    if (!leagueRows.length) return { ok: false, error: 'Лига не найдена' };
    if (leagueRows[0].creator_user_name !== cleanUser) {
      return { ok: false, error: 'Только создатель может удалить лигу' };
    }

    await db(`private_leagues?id=eq.${enc(cleanId)}`, { method: 'delete', prefer: 'return=minimal' });

    invalidatePrivateRatingCache(cleanId);
    return { ok: true };
  } catch (e: any) { return { ok: false, error: e.message }; }
}
