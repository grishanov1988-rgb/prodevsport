// ============================================================
//  ПЕРЕСЧЁТ ОЧКОВ (порт recalcUserPoints_ / updateAllRatings из Code.gs)
//  Общий для jobs-parse и admin-обработчиков
// ============================================================

import { db } from './db.ts';
import { enc, calcPointsForPrediction } from './util.ts';
import { invalidateRating } from './core.ts';
import { XP_REWARDS, addXP, wasXPAwarded, logXPAward, bumpTasks, checkBothScoredTask, checkStreakAchievements } from './gamification.ts';

// XP за попадания (только один раз на match+reason) — порт шага 3 updateAllRatings.
// Джокер удваивает и XP: передаём базовые очки (1/3/5) и множитель.
async function awardHitXP(userName: string, leagueCode: string, matchNorm: string, basePoints: number, realScore: string, jokerMult: number) {
  const gmMatchKey = leagueCode + '||' + matchNorm;
  if (basePoints === 5) {
    if (!(await wasXPAwarded(userName, gmMatchKey, 'exactScore'))) {
      const xp = XP_REWARDS.exactScore * jokerMult;
      await addXP(userName, xp, 'exactScore');
      await logXPAward(userName, gmMatchKey, 'exactScore', xp);
      await bumpTasks(userName, 'exactScore');
      await bumpTasks(userName, 'outcomeHit');
      await checkBothScoredTask(userName, realScore);
      await checkStreakAchievements(userName);
    }
  } else if (basePoints === 3) {
    if (!(await wasXPAwarded(userName, gmMatchKey, 'diffHit'))) {
      const xp = XP_REWARDS.diffHit * jokerMult;
      await addXP(userName, xp, 'diffHit');
      await logXPAward(userName, gmMatchKey, 'diffHit', xp);
      await bumpTasks(userName, 'outcomeHit');
      await checkBothScoredTask(userName, realScore);
      await checkStreakAchievements(userName);
    }
  } else if (basePoints === 1) {
    if (!(await wasXPAwarded(userName, gmMatchKey, 'outcomeHit'))) {
      const xp = XP_REWARDS.outcomeHit * jokerMult;
      await addXP(userName, xp, 'outcomeHit');
      await logXPAward(userName, gmMatchKey, 'outcomeHit', xp);
      await bumpTasks(userName, 'outcomeHit');
      await checkStreakAchievements(userName);
    }
  }
}

export async function recalcUserPoints(userName: string): Promise<void> {
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
      const basePts = calcPointsForPrediction(p.outcome, p.score, real).points;
      const jokerMult = p.is_joker === true ? 2 : 1;
      // Джокер удваивает ТОЛЬКО XP; рейтинговые очки нетронуты: 5/3/1
      const pts = basePts;
      total += pts;
      perLeague[p.league_code] = (perLeague[p.league_code] || 0) + pts;
      await awardHitXP(clean, p.league_code, p.match_norm, basePts, real, jokerMult);
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

export async function recalcUsers(userNames: string[]): Promise<number> {
  let n = 0;
  for (const name of userNames) { await recalcUserPoints(name); n++; }
  if (n) invalidateRating();
  return n;
}

// rebuildAllUserPoints_ — все пользователи из users + predictions
export async function rebuildAllUserPoints(): Promise<number> {
  const names = new Set<string>();
  try {
    const all = await db('users?select=user_name&limit=1000') ?? [];
    all.forEach((u: any) => { if (u.user_name) names.add(u.user_name); });
  } catch { /* ignore */ }
  try {
    const predUsers = await db('predictions?select=user_name') ?? [];
    predUsers.forEach((p: any) => { if (p.user_name) names.add(p.user_name); });
  } catch { /* ignore */ }
  return recalcUsers(Array.from(names));
}
