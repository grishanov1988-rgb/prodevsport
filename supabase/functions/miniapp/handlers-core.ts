// ============================================================
//  ЯДРО MINI APP API — порт из Code.gs (этап 2)
//  bootstrap, матчи, прогнозы, рейтинг туров, статистика,
//  дашборд профиля, настройки уведомлений
// ============================================================

import { db, upsert } from '../_shared/db.ts';
import { LEAGUES, XP_ACHIEVEMENTS, PREDICTION_LOCK_BEFORE_MS, RATE_LIMIT_PRED_PER_MIN } from '../_shared/config.ts';
import { enc, formatDateMsk, calcPointsForPrediction, normalizeMatchName } from '../_shared/util.ts';
import { buildRating, getTeamsMap, resolveTeams, getUserAchievements, checkRateLimit } from '../_shared/core.ts';
import { getXPProfile, addXP, bumpTasks, bumpTaskLeagues, checkStreakAchievements, activateJoker, rollbackJoker } from '../_shared/gamification.ts';

function uiLeagues() {
  const out: Record<string, any> = {};
  for (const code in LEAGUES) {
    const L: any = (LEAGUES as any)[code];
    out[code] = { code: L.code, name: L.name, emoji: L.emoji, flagClass: L.flagClass || '', sheetName: L.sheetName, competition: L.competition };
  }
  return out;
}

// ------------------------------------------------------------
//  getBootstrap
// ------------------------------------------------------------
export async function getBootstrap(_chatId: unknown, userName: unknown) {
  try {
    const cleanUser = String(userName).trim();
    const rating = await buildRating();
    const userPreds = await db(`predictions?user_name=eq.${enc(cleanUser)}&select=id,league_code`) ?? [];
    const totalPredictions = userPreds.length;
    const leagueStats: Record<string, any> = {};
    for (const code in LEAGUES) {
      const L: any = (LEAGUES as any)[code];
      leagueStats[code] = { name: L.name, emoji: L.emoji, flagClass: L.flagClass || '', count: 0, points: 0 };
    }
    userPreds.forEach((p: any) => { if (leagueStats[p.league_code]) leagueStats[p.league_code].count++; });
    let place: number | string = '-'; let points = 0;
    for (let i = 0; i < rating.length; i++) {
      if (rating[i].name === cleanUser) {
        place = i + 1; points = rating[i].points;
        for (const code in rating[i].leagues) { if (leagueStats[code]) leagueStats[code].points = rating[i].leagues[code]; }
        break;
      }
    }
    const ratingFormatted = rating.map((r) => ({ name: r.name, points: r.points, leagues: r.leagues, move: null }));
    const achs = await getUserAchievements(cleanUser);
    return {
      ok: true, leagues: uiLeagues(), rating: ratingFormatted,
      profile: { place, points, totalPredictions, totalAchievements: Object.keys(XP_ACHIEVEMENTS).length, achievements: achs, leagueStats },
    };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

// ------------------------------------------------------------
//  getLeagueMatches
// ------------------------------------------------------------
export async function getLeagueMatches(leagueCode: unknown, _chatId: unknown, userName: unknown) {
  try {
    const cleanUser = String(userName).trim();
    const code = String(leagueCode);
    const allMatches = await db(`matches?league_code=eq.${enc(code)}&order=tour_num.asc,utc_date.asc`) ?? [];
    if (!allMatches.length) return { ok: true, matches: [] };
    const toursMap: Record<number, any[]> = {};
    allMatches.forEach((m: any) => {
      const t = Number(m.tour_num); if (!t) return;
      if (!toursMap[t]) toursMap[t] = [];
      toursMap[t].push(m);
    });
    const tourNumbers = Object.keys(toursMap).map(Number).sort((a, b) => a - b);
    if (!tourNumbers.length) return { ok: true, matches: [] };
    // Текущий тур = тур ближайшего предстоящего/идущего матча.
    // Дополнительно: если недавно завершившийся матч (≤30ч назад) ещё без счёта —
    // держим его тур (запас парсеру), пока он не станет старше или не появится счёт.
    // Перенесённые матчи старше 30ч тур не держат: показывается ближайший будущий тур.
    const now = Date.now();
    const hasValidScore = (s: unknown) => !!s && /^\d+\s*[-:]\s*\d+$/.test(String(s));
    const SCORE_GRACE_MS = 30 * 3600 * 1000;
    let upcomingTour: number | null = null;
    let upcomingTime = Infinity;
    let graceTour: number | null = null;
    for (const tNum of tourNumbers) {
      for (const m of toursMap[tNum]) {
        const scored = hasValidScore(m.real_score);
        if (!m.utc_date) {
          if (!scored && graceTour === null) graceTour = tNum;
          continue;
        }
        const t = new Date(m.utc_date).getTime();
        if (isNaN(t)) {
          if (!scored && graceTour === null) graceTour = tNum;
          continue;
        }
        if (t + 4 * 3600 * 1000 > now && t < upcomingTime) { upcomingTime = t; upcomingTour = tNum; }
        if (!scored && t <= now && t + SCORE_GRACE_MS > now) {
          if (graceTour === null || tNum < graceTour) graceTour = tNum;
        }
      }
    }
    let currentTour: number | null = null;
    if (graceTour !== null && (upcomingTour === null || graceTour < upcomingTour)) currentTour = graceTour;
    else if (upcomingTour !== null) currentTour = upcomingTour;
    if (currentTour === null) currentTour = tourNumbers[tourNumbers.length - 1];
    const matches = toursMap[currentTour] || [];
    const userPreds = await db(`predictions?user_name=eq.${enc(cleanUser)}&league_code=eq.${enc(code)}`) ?? [];
    const predMap: Record<string, any> = {};
    userPreds.forEach((p: any) => { predMap[p.match_norm] = p; });
    const result: any[] = [];
    for (const m of matches) {
      const up = predMap[m.match_norm] || null;
      const teams = await resolveTeams(m.match_name);
      result.push({
        matchName: m.match_name,
        time: m.utc_date ? formatDateMsk(m.utc_date, 'dd.MM HH:mm') : '',
        leagueCode: code, tourNum: currentTour, matchDateStr: m.utc_date || null,
        realScore: m.real_score || null, homeTeam: teams.home, awayTeam: teams.away,
        userPrediction: up ? { outcome: up.outcome, score: up.score, isJoker: up.is_joker === true } : null,
      });
    }
    result.sort((a, b) => String(a.matchDateStr || '').localeCompare(String(b.matchDateStr || '')));
    return { ok: true, matches: result, currentTour };
  } catch (e: any) { return { ok: false, error: e.message, matches: [] }; }
}

// ------------------------------------------------------------
//  savePrediction (с джокером и XP)
// ------------------------------------------------------------
export async function savePrediction(payload: any) {
  try {
    const userName = String(payload.userName || '').trim();
    const matchName = String(payload.matchName || '').trim();
    const leagueCode = String(payload.leagueCode || '').trim();
    const outcome = String(payload.outcome || '').trim();
    const score = String(payload.score || '').trim();
    const useJoker = payload.useJoker === true;

    if (!userName || !matchName || !leagueCode || !outcome || !score) return { ok: false, error: 'Не все поля заполнены' };
    if (!/^\d+\s*-\s*\d+$/.test(score)) return { ok: false, error: 'Неверный формат счета' };
    if (!(await checkRateLimit('pred_' + userName, RATE_LIMIT_PRED_PER_MIN))) return { ok: false, error: 'Слишком много запросов.' };

    const matchNorm = normalizeMatchName(matchName);
    const matchRows = await db(`matches?league_code=eq.${enc(leagueCode)}&match_norm=eq.${enc(matchNorm)}&select=utc_date`) ?? [];
    if (matchRows.length && matchRows[0].utc_date) {
      const matchTime = new Date(matchRows[0].utc_date).getTime();
      if (Date.now() >= matchTime - PREDICTION_LOCK_BEFORE_MS) {
        return { ok: false, error: 'Приём прогнозов закрыт (матч начнётся менее чем через 5 минут).' };
      }
    }

    let jokerResult: any = null;
    if (useJoker) {
      jokerResult = await activateJoker(userName);
      if (!jokerResult.ok) return jokerResult;
    }

    try {
      await db('predictions?on_conflict=user_name,league_code,match_norm', {
        method: 'post',
        body: [{
          chat_id: Number(payload.chatId) || 0, user_name: userName, league_code: leagueCode,
          match_name: matchName, match_norm: matchNorm, outcome,
          score: score.replace(/\s/g, '').replace(/:/g, '-'), is_joker: !!useJoker,
        }],
        prefer: 'return=minimal,resolution=ignore-duplicates',
      });
    } catch (e: any) {
      if (useJoker && jokerResult) await rollbackJoker(userName, jokerResult.remainingJokers || 0);
      // 409 бывает и при нарушении FK (неизвестный пользователь) —
      // считаем «дублем» только если запись реально существует
      try {
        const existsNow = await db(`predictions?user_name=eq.${enc(userName)}&league_code=eq.${enc(leagueCode)}&match_norm=eq.${enc(matchNorm)}&select=id`) ?? [];
        if (existsNow.length) return { ok: false, error: 'Вы уже сделали прогноз на этот матч', alreadyExists: true };
      } catch { /* ignore */ }
      throw e;
    }

    const checkExists = await db(`predictions?user_name=eq.${enc(userName)}&league_code=eq.${enc(leagueCode)}&match_norm=eq.${enc(matchNorm)}&select=id,saved_at`) ?? [];
    let isNew = false;
    if (checkExists.length) {
      const savedAt = checkExists[0].saved_at ? new Date(checkExists[0].saved_at).getTime() : 0;
      if (Date.now() - savedAt < 15000) isNew = true;
    }
    if (!isNew && checkExists.length) {
      if (useJoker && jokerResult) await rollbackJoker(userName, jokerResult.remainingJokers || 0);
      return { ok: false, error: 'Вы уже сделали прогноз на этот матч', alreadyExists: true };
    }

    const xpResult = await addXP(userName, 5, 'prediction');
    await bumpTasks(userName, 'prediction');
    await bumpTaskLeagues(userName, leagueCode);
    await checkStreakAchievements(userName);

    return {
      ok: true,
      saved: { matchName, outcome, score: score.replace(/\s/g, '').replace(/:/g, '-'), isJoker: !!useJoker },
      xp: xpResult, joker: jokerResult,
    };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

// ------------------------------------------------------------
//  getUserPredictions
// ------------------------------------------------------------
export async function getUserPredictions(_chatId: unknown, userName: unknown) {
  try {
    const cleanUser = String(userName || '').trim();
    const allowedLeagues = new Set(Object.keys(LEAGUES));
    const preds = (await db(`predictions?user_name=eq.${enc(cleanUser)}&select=id,user_name,league_code,match_name,match_norm,outcome,score,saved_at&order=id.desc&limit=100`) ?? [])
      .filter((p: any) => allowedLeagues.has(p.league_code))
      .slice(0, 25);
    if (!preds.length) return { ok: true, predictions: [] };
    const leagueSet: Record<string, boolean> = {}; const normsSet: Record<string, boolean> = {};
    preds.forEach((p: any) => { leagueSet[p.league_code] = true; if (p.match_norm) normsSet[p.match_norm] = true; });
    const leagueCodes = Object.keys(leagueSet); const norms = Object.keys(normsSet);
    const matchMap: Record<string, any> = {};
    if (leagueCodes.length && norms.length) {
      const CHUNK = 10;
      for (let i = 0; i < norms.length; i += CHUNK) {
        const chunkNorms = norms.slice(i, i + CHUNK);
        try {
          const allMatches = await db(`matches?league_code=in.(${leagueCodes.map(enc).join(',')})&match_norm=in.(${chunkNorms.map(enc).join(',')})&select=league_code,match_norm,match_name,real_score,utc_date`) ?? [];
          allMatches.forEach((m: any) => { matchMap[m.league_code + '||' + m.match_norm] = m; });
        } catch { /* ignore chunk */ }
      }
    }
    const list: any[] = [];
    for (const p of preds) {
      const m = matchMap[p.league_code + '||' + p.match_norm];
      const teams = await resolveTeams(p.match_name);
      const realScore = m ? m.real_score : null;
      let points: number | null = null;
      if (realScore) points = calcPointsForPrediction(p.outcome, p.score, realScore).points;
      const L: any = (LEAGUES as any)[p.league_code] || {};
      list.push({
        id: p.id, matchName: p.match_name, leagueCode: p.league_code,
        leagueName: L.name || p.league_code, leagueEmoji: L.emoji || '', leagueFlagClass: L.flagClass || '',
        homeTeam: teams.home, awayTeam: teams.away,
        dateStr: m && m.utc_date ? formatDateMsk(m.utc_date, 'dd.MM.yyyy HH:mm') : formatDateMsk(p.saved_at, 'dd.MM.yyyy HH:mm'),
        matchTs: m && m.utc_date ? new Date(m.utc_date).getTime() : 0,
        savedTs: p.saved_at ? new Date(p.saved_at).getTime() / 1000 : 0,
        outcome: p.outcome, score: p.score, realScore, points,
      });
    }

    return { ok: true, predictions: list };
  } catch (e: any) { return { ok: false, error: e.message, predictions: [] }; }
}

// ------------------------------------------------------------
//  getUserStats
// ------------------------------------------------------------
export async function getUserStats(targetUserName: unknown) {
  try {
    const cleanTarget = String(targetUserName || '').trim();
    if (!cleanTarget) return { ok: false, error: 'Не указано имя пользователя' };
    const ratingData = await buildRating();
    let place: number | string = '-'; let totalPoints = 0;
    const totalPlayers = ratingData.length;
    const leaguePoints: Record<string, number> = {};
    for (const c in LEAGUES) leaguePoints[c] = 0;
    for (let i = 0; i < ratingData.length; i++) {
      if (ratingData[i].name === cleanTarget) {
        place = i + 1; totalPoints = ratingData[i].points;
        for (const code in ratingData[i].leagues) leaguePoints[code] = ratingData[i].leagues[code];
        break;
      }
    }
    const preds = await db(`predictions?user_name=eq.${enc(cleanTarget)}&select=league_code,match_norm,match_name,outcome,score,saved_at`) ?? [];
    const totalPredictions = preds.length;
    let lastPredictionDate: Date | null = null;
    const userByLeague: Record<string, Record<string, any>> = {};
    const leagueSet: Record<string, boolean> = {};
    preds.forEach((p: any) => {
      const lc = p.league_code;
      if (p.saved_at) { const d = new Date(p.saved_at); if (!lastPredictionDate || d > lastPredictionDate) lastPredictionDate = d; }
      if (!userByLeague[lc]) userByLeague[lc] = {};
      leagueSet[lc] = true;
      userByLeague[lc][p.match_norm] = { outcome: p.outcome, score: p.score };
    });
    const userLeagues = Object.keys(leagueSet);
    const allMatches = userLeagues.length
      ? await db(`matches?real_score=not.is.null&league_code=in.(${userLeagues.map(enc).join(',')})&select=league_code,match_norm,real_score`) ?? []
      : [];
    const realByLeague: Record<string, Record<string, any>> = {};
    allMatches.forEach((m: any) => {
      if (!realByLeague[m.league_code]) realByLeague[m.league_code] = {};
      realByLeague[m.league_code][m.match_norm] = m.real_score;
    });
    const leagues: any[] = [];
    let totPreds = 0, totResolved = 0, totOutcomeHit = 0, totDiffHit = 0, totScoreHit = 0, totPointsCalc = 0;
    for (const code in LEAGUES) {
      const userMatches = userByLeague[code] || {};
      const realMatches = realByLeague[code] || {};
      let predictions = 0, resolved = 0, outcomeHit = 0, diffHit = 0, scoreHit = 0, points = 0;
      for (const mn in userMatches) {
        predictions++;
        const real = realMatches[mn];
        if (!real) continue;
        resolved++;
        const res = calcPointsForPrediction(userMatches[mn].outcome, userMatches[mn].score, real);
        if (res.exactScore) scoreHit++;
        if (res.correctDiff) diffHit++;
        if (res.correctOutcome) outcomeHit++;
        points += res.points;
      }
      const pctOf = (hit: number) => (resolved ? Math.round((hit * 100) / resolved) : 0);
      totPreds += predictions; totResolved += resolved; totOutcomeHit += outcomeHit; totDiffHit += diffHit; totScoreHit += scoreHit; totPointsCalc += points;
      const L: any = (LEAGUES as any)[code];
      leagues.push({
        code, name: L.name, emoji: L.emoji, flagClass: L.flagClass || '',
        predictions, resolved, pending: predictions - resolved, points,
        pointsFromRating: leaguePoints[code] || 0,
        outcomeHit, diffHit, scoreHit,
        pctOutcome: pctOf(outcomeHit), pctDiff: pctOf(diffHit), pctScore: pctOf(scoreHit),
      });
    }
    const leaguesFiltered = leagues.filter((x) => x.predictions > 0);
    const total = {
      predictions: totPreds, resolved: totResolved, pending: totPreds - totResolved, points: totPointsCalc,
      outcomeHit: totOutcomeHit, diffHit: totDiffHit, scoreHit: totScoreHit,
      pctOutcome: totResolved ? Math.round((totOutcomeHit * 100) / totResolved) : 0,
      pctDiff: totResolved ? Math.round((totDiffHit * 100) / totResolved) : 0,
      pctScore: totResolved ? Math.round((totScoreHit * 100) / totResolved) : 0,
    };
    const achievements = await getUserAchievements(cleanTarget);
    const lpd = lastPredictionDate as Date | null;
    const lastDateStr = lpd ? formatDateMsk(lpd.toISOString(), 'dd.MM.yyyy') : '';
    return {
      ok: true, userName: cleanTarget, place, totalPlayers, totalPoints, totalPredictions,
      lastPredictionDate: lastDateStr, total, leagues: leaguesFiltered,
      achievements, totalAchievements: Object.keys(XP_ACHIEVEMENTS).length,
    };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

// ------------------------------------------------------------
//  getMatchPredictions
// ------------------------------------------------------------
export async function getMatchPredictions(leagueCode: unknown, matchName: unknown, _chatId: unknown, userName: unknown) {
  try {
    const cleanMatch = String(matchName || '').trim();
    const cleanLeague = String(leagueCode || '').trim();
    const me = String(userName || '').trim();
    const teams = await resolveTeams(cleanMatch);
    const targetNorm = normalizeMatchName(cleanMatch);
    const preds = await db(`predictions?league_code=eq.${enc(cleanLeague)}&match_norm=eq.${enc(targetNorm)}&order=saved_at.desc`) ?? [];
    const byUser: Record<string, any> = {};
    preds.forEach((p: any) => {
      const rowUser = p.user_name; if (!rowUser) return;
      const ts = p.saved_at ? new Date(p.saved_at).getTime() : 0;
      if (!byUser[rowUser] || ts >= byUser[rowUser].savedTs) byUser[rowUser] = { userName: rowUser, outcome: p.outcome, score: p.score, savedTs: ts };
    });
    const list = Object.keys(byUser).map((k) => byUser[k]);
    let countP1 = 0, countDraw = 0, countP2 = 0, countOther = 0;
    list.forEach((item) => {
      const o = item.outcome;
      if (o === 'П1') countP1++; else if (o === 'П2') countP2++; else if (o === 'Ничья' || String(o).toLowerCase() === 'ничья') countDraw++; else countOther++;
    });
    const total = list.length;
    const pct = (n: number) => (total ? Math.round((n * 100) / total) : 0);
    list.sort((a, b) => {
      if (a.userName === me && b.userName !== me) return -1;
      if (b.userName === me && a.userName !== me) return 1;
      return a.userName.localeCompare(b.userName, 'ru');
    });
    const L: any = (LEAGUES as any)[cleanLeague] || null;
    return {
      ok: true, matchName: cleanMatch,
      leagueName: L ? L.name : cleanLeague, leagueEmoji: L ? L.emoji : '', leagueFlagClass: L ? (L.flagClass || '') : '',
      homeTeam: teams.home, awayTeam: teams.away, isMe: me,
      stats: { total, P1: countP1, Draw: countDraw, P2: countP2, Other: countOther, pctP1: pct(countP1), pctDraw: pct(countDraw), pctP2: pct(countP2) },
      predictions: list, total,
    };
  } catch (e: any) { return { ok: false, error: e.message, predictions: [] }; }
}

// ------------------------------------------------------------
//  getProfileDashboard
// ------------------------------------------------------------
export async function getProfileDashboard(_chatId: unknown, userName: unknown) {
  try {
    const cleanUser = String(userName || '').trim();
    const ratingData = await buildRating();
    let place: number | null = null; let points = 0;
    const totalPlayers = ratingData.length;
    for (let i = 0; i < ratingData.length; i++) {
      if (ratingData[i].name === cleanUser) { place = i + 1; points = ratingData[i].points; break; }
    }
    const preds = await db(`predictions?user_name=eq.${enc(cleanUser)}&select=league_code,match_norm,outcome,score,saved_at`) ?? [];
    const totalPredictions = preds.length;
    const userByLeague: Record<string, Record<string, any>> = {};
    const leagueSet: Record<string, boolean> = {};
    preds.forEach((p: any) => {
      const lc = p.league_code; const mn = p.match_norm; if (!mn) return;
      leagueSet[lc] = true;
      if (!userByLeague[lc]) userByLeague[lc] = {};
      const ts = p.saved_at ? new Date(p.saved_at).getTime() : 0;
      const prev = userByLeague[lc][mn];
      if (!prev || ts >= prev.savedTs) userByLeague[lc][mn] = { outcome: p.outcome, score: p.score, savedTs: ts };
    });
    const userLeagues = Object.keys(leagueSet);
    const allMatches = userLeagues.length
      ? await db(`matches?real_score=not.is.null&league_code=in.(${userLeagues.map(enc).join(',')})&select=league_code,match_norm,real_score`) ?? []
      : [];
    const realByLeague: Record<string, Record<string, any>> = {};
    allMatches.forEach((m: any) => {
      if (!realByLeague[m.league_code]) realByLeague[m.league_code] = {};
      realByLeague[m.league_code][m.match_norm] = m.real_score;
    });
    const leagues: any[] = [];
    let totPreds = 0, totResolved = 0, totOutcomeHit = 0, totDiffHit = 0, totScoreHit = 0, totPoints = 0;
    for (const code in LEAGUES) {
      const userMatches = userByLeague[code] || {};
      const realMatches = realByLeague[code] || {};
      let predictions = 0, resolvedL = 0, outcomeHitL = 0, diffHitL = 0, scoreHitL = 0, ptsL = 0;
      for (const mn in userMatches) {
        predictions++;
        const real = realMatches[mn]; if (!real) continue;
        resolvedL++;
        const res = calcPointsForPrediction(userMatches[mn].outcome, userMatches[mn].score, real);
        if (res.exactScore) scoreHitL++;
        if (res.correctDiff) diffHitL++;
        if (res.correctOutcome) outcomeHitL++;
        ptsL += res.points;
      }
      const pctOf = (hit: number) => (resolvedL ? Math.round((hit * 100) / resolvedL) : 0);
      const L: any = (LEAGUES as any)[code];
      leagues.push({
        code, name: L.name, emoji: L.emoji, flagClass: L.flagClass || '',
        predictions, resolved: resolvedL, pending: predictions - resolvedL, points: ptsL,
        outcomeHit: outcomeHitL, diffHit: diffHitL, scoreHit: scoreHitL,
        pctOutcome: pctOf(outcomeHitL), pctDiff: pctOf(diffHitL), pctScore: pctOf(scoreHitL),
      });
      totPreds += predictions; totResolved += resolvedL; totOutcomeHit += outcomeHitL; totDiffHit += diffHitL; totScoreHit += scoreHitL; totPoints += ptsL;
    }
    const leaguesFiltered = leagues.filter((x) => x.predictions > 0);
    const total = {
      predictions: totPreds, resolved: totResolved, pending: totPreds - totResolved, points: totPoints,
      outcomeHit: totOutcomeHit, diffHit: totDiffHit, scoreHit: totScoreHit,
      pctOutcome: totResolved ? Math.round((totOutcomeHit * 100) / totResolved) : 0,
      pctDiff: totResolved ? Math.round((totDiffHit * 100) / totResolved) : 0,
      pctScore: totResolved ? Math.round((totScoreHit * 100) / totResolved) : 0,
    };
    const achievements = await getUserAchievements(cleanUser);
    return {
      ok: true, userName: cleanUser, place, totalPlayers, points, totalPredictions, total,
      leagues: leaguesFiltered, achievements, totalAchievements: Object.keys(XP_ACHIEVEMENTS).length,
      xp: await getXPProfile(cleanUser),
    };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

// ------------------------------------------------------------
//  Настройки уведомлений
// ------------------------------------------------------------
export async function getNotifySettings(_chatId: unknown, userName: unknown) {
  try {
    const clean = String(userName || '').trim();
    const rows = await db(`subscriptions?user_name=eq.${enc(clean)}`) ?? [];
    let leagues: string[] | null = null;
    if (rows.length) leagues = rows[0].leagues || [];
    const all: Record<string, any> = {};
    for (const code in LEAGUES) {
      const L: any = (LEAGUES as any)[code];
      all[code] = { code, name: L.name, emoji: L.emoji, flagClass: L.flagClass || '', enabled: leagues === null ? true : leagues.indexOf(code) !== -1 };
    }
    return { ok: true, leagues: all, saved: leagues !== null };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

export async function saveNotifySettings(chatId: unknown, userName: unknown, leagueCodes: unknown) {
  try {
    const clean = String(userName || '').trim();
    const codes = Array.isArray(leagueCodes) ? (leagueCodes as unknown[]).slice() : [];
    const valid = codes.filter((c) => !!(LEAGUES as any)[String(c)]);
    await upsert('subscriptions', [{ user_name: clean, chat_id: Number(chatId) || 0, leagues: valid }], 'user_name');
    return { ok: true, saved: valid };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

// ------------------------------------------------------------
//  Туры: список и рейтинг тура
// ------------------------------------------------------------
export async function getAvailableTours(leagueCode: unknown) {
  try {
    const rows = await db(`matches?league_code=eq.${enc(String(leagueCode))}&select=tour_num,real_score`) ?? [];
    const map: Record<number, { total: number; played: number }> = {};
    rows.forEach((r: any) => {
      const tourNum = Number(r.tour_num);
      if (isNaN(tourNum) || !tourNum) return;
      const isPlayed = !!(r.real_score && /^\d+\s*[-:]\s*\d+$/.test(String(r.real_score)));
      if (!map[tourNum]) map[tourNum] = { total: 0, played: 0 };
      map[tourNum].total++;
      if (isPlayed) map[tourNum].played++;
    });
    const tours = Object.keys(map).map(Number).sort((a, b) => a - b).map((num) => ({
      number: num, label: 'Тур ' + num, played: map[num].played, total: map[num].total,
      finished: map[num].played === map[num].total && map[num].total > 0,
    }));
    return { ok: true, tours };
  } catch (e: any) { return { ok: false, error: e.message, tours: [] }; }
}

export async function getTourRating(leagueCode: unknown, tourNumber: unknown) {
  try {
    const L: any = (LEAGUES as any)[String(leagueCode)];
    if (!L) return { ok: false, error: 'Лига не найдена', rating: [] };
    const tn = parseInt(String(tourNumber), 10);
    if (isNaN(tn)) return { ok: false, error: 'Неверный тур', rating: [] };
    const matchesRows = await db(`matches?league_code=eq.${enc(String(leagueCode))}&tour_num=eq.${tn}&select=match_norm,match_name,real_score`) ?? [];
    const tourMatches: Record<string, any> = {};
    let totalMatches = 0, playedMatches = 0;
    matchesRows.forEach((m: any) => {
      if (!m.match_norm) return;
      const isPlayed = !!(m.real_score && /^\d+\s*[-:]\s*\d+$/.test(String(m.real_score)));
      tourMatches[m.match_norm] = { realScore: isPlayed ? String(m.real_score).replace(/:/g, '-').replace(/\s/g, '') : null, isPlayed };
      totalMatches++;
      if (isPlayed) playedMatches++;
    });
    if (totalMatches === 0) {
      return { ok: true, leagueCode: String(leagueCode), leagueName: L.name, leagueEmoji: L.emoji, leagueFlagClass: L.flagClass || '', tourNumber: tn, totalMatches: 0, playedMatches: 0, rating: [] };
    }
    const predRows = await db(`predictions?league_code=eq.${enc(String(leagueCode))}&select=user_name,match_norm,outcome,score,saved_at`) ?? [];
    const userPreds: Record<string, Record<string, any>> = {};
    predRows.forEach((p: any) => {
      const user = p.user_name; if (!user) return;
      const norm = p.match_norm; if (!tourMatches[norm]) return;
      const ts = p.saved_at ? new Date(p.saved_at).getTime() : 0;
      if (!userPreds[user]) userPreds[user] = {};
      const prev = userPreds[user][norm];
      if (!prev || ts > prev.date) userPreds[user][norm] = { outcome: p.outcome, score: p.score, date: ts };
    });
    const entries: any[] = [];
    for (const user in userPreds) {
      const predsMap = userPreds[user];
      let points = 0, count = 0, resolved = 0, exactCount = 0, diffCount = 0, outcomeCount = 0;
      for (const norm in predsMap) {
        const p = predsMap[norm]; const m = tourMatches[norm];
        count++;
        if (!m.isPlayed) continue;
        resolved++;
        const res = calcPointsForPrediction(p.outcome, p.score, m.realScore);
        points += res.points;
        if (res.exactScore) exactCount++; else if (res.correctDiff) diffCount++; else if (res.correctOutcome) outcomeCount++;
      }
      entries.push({ userName: user, points, count, resolved, exactCount, diffCount, outcomeCount });
    }
    entries.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.exactCount !== a.exactCount) return b.exactCount - a.exactCount;
      return a.userName.localeCompare(b.userName, 'ru');
    });
    let lastPoints: number | null = null; let lastPlace = 0;
    entries.forEach((e, i) => {
      if (e.points === lastPoints) e.place = lastPlace;
      else { e.place = i + 1; lastPoints = e.points; lastPlace = e.place; }
    });
    return {
      ok: true, leagueCode: String(leagueCode), leagueName: L.name, leagueEmoji: L.emoji, leagueFlagClass: L.flagClass || '',
      tournament: tn, totalMatches, playedMatches, rating: entries,
    };
  } catch (e: any) { return { ok: false, error: e.message, rating: [] }; }
}
