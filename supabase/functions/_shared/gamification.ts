// ============================================================
//  ГЕЙМИФИКАЦИЯ: XP-движок, задания, ачивки, джокер
//  Точный порт из Code.gs (getXPProfile_, addXP_, задания,
//  checkStreakAchievements_, activateJoker_, spendXP_)
// ============================================================

import { db, upsert } from './db.ts';
import { XP_ACHIEVEMENTS } from './config.ts';
import { enc, getPeriodKey, formatDateMsk } from './util.ts';
import { getUserAchievements } from './core.ts';

export const XP_REWARDS = { prediction: 5, streakBonus: 10, outcomeHit: 10, diffHit: 20, exactScore: 40, taskClaim: 0 };

export function xpForLevel(level: number): number { return 50 * Math.pow(level, 2); }
export function calcLevel(xp: number): number { return Math.floor(Math.sqrt(Math.max(0, xp) / 50)); }

const LEVEL_TITLES = [
  { min: 0, title: 'Новичок', icon: '🐣' }, { min: 3, title: 'Любитель', icon: '⚽' },
  { min: 5, title: 'Знаток', icon: '🎓' },  { min: 8, title: 'Эксперт', icon: '🧠' },
  { min: 12, title: 'Пророк', icon: '🔮' }, { min: 17, title: 'Оракул', icon: '🌟' },
  { min: 25, title: 'Легенда', icon: '👑' },
];

function getLevelTitle(level: number) {
  let t = LEVEL_TITLES[0];
  for (const item of LEVEL_TITLES) if (level >= item.min) t = item;
  return t;
}

export interface XPProfile {
  totalXP: number; level: number; levelTitle: string; levelIcon: string;
  xpToday: number; xpWeek: number; streak: number; exactScores: number; totalPredictions: number;
  curLevelMinXP: number; nextLevelMinXP: number; xpInLevel: number; xpLevelSpan: number;
  xpToNext: number; pct: number;
}

export async function getXPProfile(userName: string): Promise<XPProfile> {
  const clean = String(userName || '').trim();
  const todayKey = getPeriodKey('daily');
  const weekKey = getPeriodKey('weekly');
  const rows = await db(`xp_profiles?user_name=eq.${enc(clean)}`) ?? [];
  const profile = rows.length ? rows[0] : null;
  const p: any = profile ?? { total_xp: 0, level: 0, xp_today: 0, xp_week: 0, streak: 0, exact_scores: 0, total_predictions: 0 };
  const xpToday = p.last_reset_date === todayKey ? Number(p.xp_today) || 0 : 0;
  const xpWeek  = p.last_reset_week === weekKey  ? Number(p.xp_week)  || 0 : 0;
  const totalXP = Math.max(0, Number(p.total_xp) || 0);
  const level = Math.max(0, Number(p.level) || 0);
  const cur = xpForLevel(level), next = xpForLevel(level + 1);
  const xpInLevel = totalXP - cur;
  const span = next - cur;
  const title = getLevelTitle(level);
  return {
    totalXP, level, levelTitle: title.title, levelIcon: title.icon,
    xpToday, xpWeek, streak: Number(p.streak) || 0,
    exactScores: Number(p.exact_scores) || 0, totalPredictions: Number(p.total_predictions) || 0,
    curLevelMinXP: cur, nextLevelMinXP: next, xpInLevel, xpLevelSpan: span,
    xpToNext: next - totalXP, pct: span > 0 ? Math.min(100, Math.round((xpInLevel / span) * 100)) : 100,
  };
}

export async function addXP(userName: string, amount: number, reason: string) {
  if (!userName || !amount) return null;
  const clean = String(userName).trim();
  const todayKey = getPeriodKey('daily');
  const weekKey = getPeriodKey('weekly');
  const rows = await db(`xp_profiles?user_name=eq.${enc(clean)}`) ?? [];
  const profile = rows.length ? rows[0] : null;
  let totalXP = profile ? Number(profile.total_xp) || 0 : 0;
  const oldLevel = profile ? Number(profile.level) || 0 : 0;
  let xpBalance = profile && profile.xp_balance != null ? Number(profile.xp_balance) : totalXP;
  let xpToday = (profile && profile.last_reset_date === todayKey) ? Number(profile.xp_today) || 0 : 0;
  let xpWeek  = (profile && profile.last_reset_week === weekKey)  ? Number(profile.xp_week)  || 0 : 0;
  let streak = profile ? Number(profile.streak) || 0 : 0;
  let lastPred = profile ? String(profile.last_prediction_day || '') : '';
  let predsCount = profile ? Number(profile.total_predictions) || 0 : 0;
  let exactCount = profile ? Number(profile.exact_scores) || 0 : 0;

  let actualAmount = amount;
  const extraXP = 0;
  if (reason === 'prediction') {
    if (lastPred !== todayKey) {
      const yest = new Date(Date.now() - 86400000);
      const yKey = formatDateMsk(yest.toISOString(), 'yyyy-MM-dd');
      streak = lastPred === yKey ? streak + 1 : 1;
      lastPred = todayKey;
      actualAmount = 10;
    } else actualAmount = 5;
    predsCount += 1;
  }
  if (reason === 'exactScore') exactCount += 1;

  const totalAdd = actualAmount + extraXP;
  totalXP += totalAdd; xpToday += totalAdd; xpWeek += totalAdd; xpBalance += totalAdd;
  const newLevel = calcLevel(totalXP);
  const leveledUp = newLevel > oldLevel;

  await upsert('xp_profiles', [{
    user_name: clean, total_xp: totalXP, level: newLevel, xp_balance: xpBalance,
    xp_today: xpToday, xp_week: xpWeek,
    last_reset_date: todayKey, last_reset_week: weekKey,
    streak, last_prediction_day: lastPred,
    total_predictions: predsCount, exact_scores: exactCount,
    updated_at: new Date().toISOString(),
  }]);

  return { totalXP, level: newLevel, leveledUp, xpGained: totalAdd, streakBonus: extraXP, streak, balance: xpBalance };
}

export async function wasXPAwarded(userName: string, matchKey: string, reason: string): Promise<boolean> {
  try {
    const rows = await db(`xp_logs?user_name=eq.${enc(userName)}&match_key=eq.${enc(matchKey)}&reason=eq.${enc(reason)}`) ?? [];
    return rows.length > 0;
  } catch { return false; }
}

export async function logXPAward(userName: string, matchKey: string, reason: string, xp: number): Promise<void> {
  try {
    await db('xp_logs?on_conflict=user_name,match_key,reason', {
      method: 'post',
      body: [{ user_name: userName, match_key: matchKey, reason, xp }],
      prefer: 'return=minimal,resolution=ignore-duplicates',
    });
  } catch { /* ignore */ }
}

export async function spendXP(userName: string, amount: number, reason: string) {
  const clean = String(userName || '').trim();
  if (!clean || !amount || amount <= 0) return { ok: false, error: 'Некорректная сумма' };
  const rows = await db(`xp_profiles?user_name=eq.${enc(clean)}`) ?? [];
  if (!rows.length) return { ok: false, error: 'Профиль не найден' };
  const profile = rows[0];
  const balance = profile.xp_balance != null ? Number(profile.xp_balance) : Number(profile.total_xp) || 0;
  if (balance < amount) return { ok: false, error: `Недостаточно XP. Нужно ${amount}, у вас ${balance}` };
  const newBalance = balance - amount;
  await upsert('xp_profiles', [{ user_name: clean, xp_balance: newBalance, updated_at: new Date().toISOString() }]);
  try {
    await db('xp_logs?on_conflict=user_name,match_key,reason', {
      method: 'post',
      body: [{ user_name: clean, match_key: 'spend_' + Date.now(), reason: 'spend_' + (reason || 'shop'), xp: -amount }],
      prefer: 'return=minimal,resolution=ignore-duplicates',
    });
  } catch { /* ignore */ }
  return { ok: true, newBalance, spent: amount };
}

// ------------------------------------------------------------
//  Джокер (activateJoker_)
// ------------------------------------------------------------
export async function activateJoker(userName: string) {
  const clean = String(userName || '').trim();
  const currentWeek = getPeriodKey('weekly');
  const rows = await db(`xp_profiles?user_name=eq.${enc(clean)}&select=jokers_count,last_joker_week`) ?? [];
  const p: any = rows[0] || {};
  const count = Number(p.jokers_count) || 0;
  if (count < 1) return { ok: false, error: 'Нет джокеров. Купите в магазине.' };
  if (String(p.last_joker_week || '') === currentWeek) {
    return { ok: false, error: 'Джокер уже использован на этой неделе' };
  }
  await upsert('xp_profiles', [{
    user_name: clean, jokers_count: count - 1, last_joker_week: currentWeek, updated_at: new Date().toISOString(),
  }]);
  return { ok: true, remainingJokers: count - 1, week: currentWeek };
}

/** Откат джокера при дубле прогноза (порт из savePrediction) */
export async function rollbackJoker(userName: string, remainingJokers: number): Promise<void> {
  try {
    await upsert('xp_profiles', [{
      user_name: userName, jokers_count: remainingJokers + 1, last_joker_week: null,
    }]);
  } catch { /* ignore */ }
}

// ------------------------------------------------------------
//  Задания (task_templates / tasks_progress)
// ------------------------------------------------------------
interface TaskTpl { id: string; title: string; description: string; periodType: string; target: number; xpReward: number; icon: string }

let tplCache: { at: number; list: TaskTpl[] } | null = null;

export async function getTaskTemplates(): Promise<TaskTpl[]> {
  if (tplCache && Date.now() - tplCache.at < 300_000) return tplCache.list;
  const rows = await db('task_templates?is_active=eq.true') ?? [];
  const list: TaskTpl[] = rows.map((r: any) => ({
    id: String(r.id).trim(), title: String(r.title || ''), description: String(r.description || ''),
    periodType: String(r.period_type || 'daily'), target: Number(r.target) || 1,
    xpReward: Number(r.xp_reward) || 0, icon: String(r.icon || '🎯'),
  }));
  tplCache = { at: Date.now(), list };
  return list;
}

export function invalidateTaskTemplates(): void { tplCache = null; }

export async function bumpTasks(userName: string, event: string): Promise<void> {
  const templates = await getTaskTemplates();
  const mapping: Record<string, string[]> = {
    prediction: ['daily_1_prediction', 'daily_3_predictions', 'weekly_10_predictions', 'monthly_50_predictions'],
    outcomeHit: ['daily_1_outcome', 'weekly_5_outcomes'],
    diffHit: [],
    exactScore: ['daily_1_exact', 'weekly_3_exact', 'weekly_10_exact'],
    bothScoredTrigger: ['weekly_both_scored'],
  };
  const affected = mapping[event] || [];
  const clean = String(userName).trim();
  for (const taskId of affected) {
    const tpl = templates.find((t) => t.id === taskId);
    if (!tpl) continue;
    const periodKey = getPeriodKey(tpl.periodType);
    const rows = await db(`tasks_progress?user_name=eq.${enc(clean)}&task_id=eq.${enc(taskId)}&period_key=eq.${enc(periodKey)}`) ?? [];
    const currentProgress = rows.length ? Number(rows[0].progress) || 0 : 0;
    const currentClaimed = rows.length ? !!rows[0].claimed : false;
    if (currentProgress >= tpl.target) continue;
    const newProgress = currentProgress + 1;
    await upsert('tasks_progress', [{
      user_name: clean, task_id: taskId, period_type: tpl.periodType, period_key: periodKey,
      progress: newProgress, target: tpl.target, completed: newProgress >= tpl.target,
      claimed: currentClaimed, xp_reward: tpl.xpReward, updated_at: new Date().toISOString(),
    }], 'user_name,task_id,period_key');
  }
}

export async function bumpTaskLeagues(userName: string, leagueCode: string): Promise<void> {
  const taskId = 'daily_3_leagues';
  const tpl = (await getTaskTemplates()).find((t) => t.id === taskId);
  if (!tpl) return;
  const periodKey = getPeriodKey('daily');
  const rows = await db(`tasks_progress?user_name=eq.${enc(userName)}&task_id=eq.${enc(taskId)}&period_key=eq.${enc(periodKey)}`) ?? [];
  const row: any = rows[0] || { progress: 0, leagues: [] };
  const leagues: string[] = Array.isArray(row.leagues) ? row.leagues.slice() : [];
  if (leagues.indexOf(leagueCode) === -1) leagues.push(leagueCode);
  const progress = leagues.length;
  await upsert('tasks_progress', [{
    user_name: userName, task_id: taskId, period_type: 'daily', period_key: periodKey,
    progress, target: tpl.target, completed: progress >= tpl.target,
    claimed: !!row.claimed, xp_reward: tpl.xpReward,
    updated_at: new Date().toISOString(), leagues,
  }], 'user_name,task_id,period_key');
}

export async function checkBothScoredTask(userName: string, realScore: string): Promise<void> {
  const m = String(realScore || '').match(/^(\d+)-(\d+)$/);
  if (!m) return;
  if (Number(m[1]) === 0 || Number(m[2]) === 0) return;
  await bumpTasks(userName, 'bothScoredTrigger');
}

export async function checkStreakAchievements(userName: string): Promise<void> {
  const profile = await getXPProfile(userName);
  const toAdd: { code: string; name: string }[] = [];
  if (profile.streak >= 3) toAdd.push(XP_ACHIEVEMENTS.streak_3);
  if (profile.streak >= 7) toAdd.push(XP_ACHIEVEMENTS.streak_7);
  if (profile.streak >= 30) toAdd.push(XP_ACHIEVEMENTS.streak_30);
  if (profile.exactScores >= 10) toAdd.push(XP_ACHIEVEMENTS.exact_10);
  if (profile.exactScores >= 50) toAdd.push(XP_ACHIEVEMENTS.exact_50);
  if (profile.totalPredictions >= 100) toAdd.push(XP_ACHIEVEMENTS.predictions_100);
  if (profile.level >= 5) toAdd.push(XP_ACHIEVEMENTS.level_5);
  if (profile.level >= 10) toAdd.push(XP_ACHIEVEMENTS.level_10);
  if (!toAdd.length) return;
  const existing = (await getUserAchievements(userName)).map((a) => a.code);
  for (const a of toAdd) {
    if (existing.indexOf(a.code) !== -1) continue;
    try {
      await upsert('achievements', [{ user_name: userName, code: a.code, name: a.name }], 'user_name,code');
    } catch { /* ignore */ }
  }
}

export async function getTasksWithProgress(userName: string) {
  const templates = await getTaskTemplates();
  const dailyKey = getPeriodKey('daily');
  const weeklyKey = getPeriodKey('weekly');
  const monthlyKey = getPeriodKey('monthly');
  const progressRows = await db(`tasks_progress?user_name=eq.${enc(userName)}`) ?? [];
  const progressMap: Record<string, any> = {};
  progressRows.forEach((r: any) => { progressMap[r.task_id + '||' + r.period_key] = r; });
  const result: Record<string, any[]> = { daily: [], weekly: [], monthly: [] };
  for (const tpl of templates) {
    const key = tpl.periodType === 'daily' ? dailyKey : tpl.periodType === 'weekly' ? weeklyKey : monthlyKey;
    const p = progressMap[tpl.id + '||' + key];
    const progress = p ? Number(p.progress) || 0 : 0;
    const item = {
      id: tpl.id, title: tpl.title, description: tpl.description, icon: tpl.icon,
      target: tpl.target, progress, completed: p ? !!p.completed : false, claimed: p ? !!p.claimed : false,
      xpReward: tpl.xpReward, pct: Math.min(100, Math.round((progress / tpl.target) * 100)),
    };
    if (result[tpl.periodType]) result[tpl.periodType].push(item);
  }
  return result;
}
