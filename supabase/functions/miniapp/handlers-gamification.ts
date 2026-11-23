// ============================================================
//  ГЕЙМИФИКАЦИЯ — порт miniApp_getGamification / miniApp_claimTask
// ============================================================

import { db } from '../_shared/db.ts';
import { enc, getPeriodKey } from '../_shared/util.ts';
import { getXPProfile, getTaskTemplates, getTasksWithProgress, addXP } from '../_shared/gamification.ts';

export async function getGamification(_chatId: unknown, userName: unknown) {
  try {
    const clean = String(userName || '').trim();
    const profile = await getXPProfile(clean);
    const tasks = await getTasksWithProgress(clean);
    return { ok: true, profile, tasks };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

export async function claimTask(_chatId: unknown, userName: unknown, taskId: unknown) {
  try {
    const clean = String(userName || '').trim();
    const id = String(taskId || '').trim();
    const templates = await getTaskTemplates();
    const tpl = templates.find((t) => t.id === id);
    if (!tpl) return { ok: false, error: 'Задание не найдено' };
    const key = getPeriodKey(tpl.periodType);
    const rows = await db(`tasks_progress?user_name=eq.${enc(clean)}&task_id=eq.${enc(id)}&period_key=eq.${enc(key)}`) ?? [];
    if (!rows.length) return { ok: false, error: 'Нет прогресса' };
    const row = rows[0];
    if (!row.completed) return { ok: false, error: 'Задание не выполнено' };
    if (row.claimed) return { ok: false, error: 'Награда уже получена' };
    await db(`tasks_progress?id=eq.${row.id}`, {
      method: 'patch',
      body: { claimed: true, updated_at: new Date().toISOString() },
      prefer: 'return=minimal',
    });
    const xpResult = await addXP(clean, tpl.xpReward, 'taskClaim');
    return { ok: true, xp: xpResult, xpReward: tpl.xpReward };
  } catch (e: any) { return { ok: false, error: e.message }; }
}
