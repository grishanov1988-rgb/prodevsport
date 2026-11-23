// ============================================================
//  MINI APP API — HTTP-диспетчер (порт handleApiRequest_ из Code.gs)
//
//  Принимает POST { fn, args, initData } (Content-Type: text/plain
//  для совместимости с текущим фронтендом) и JSON.
//  Порядок: admin_* → key; miniApp_* → валидация initData →
//  подмена личности (applyIdentity) → вызов обработчика.
// ============================================================

import { validateRequest, applyIdentity, requireAdmin } from '../_shared/auth.ts';
import * as core from './handlers-core.ts';
import * as gam from './handlers-gamification.ts';
import * as priv from './handlers-private.ts';
import * as shop from './handlers-shop.ts';
import * as team from './handlers-team.ts';

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
  });

// Реестр функций: этапы 1–2 реализованы; остальные — заглушки до своих этапов.
const HANDLERS: Record<string, (...args: any[]) => Promise<unknown> | unknown> = {
  // --- Ядро (этап 2) ---
  miniApp_getBootstrap: core.getBootstrap,
  miniApp_getLeagueMatches: core.getLeagueMatches,
  miniApp_savePrediction: core.savePrediction,
  miniApp_getUserPredictions: core.getUserPredictions,
  miniApp_getUserStats: core.getUserStats,
  miniApp_getMatchPredictions: core.getMatchPredictions,
  miniApp_getProfileDashboard: core.getProfileDashboard,
  miniApp_getAvailableTours: core.getAvailableTours,
  miniApp_getTourRating: core.getTourRating,
  miniApp_getNotifySettings: core.getNotifySettings,
  miniApp_saveNotifySettings: core.saveNotifySettings,

  // --- Геймификация (этап 4) ---
  miniApp_getGamification: gam.getGamification,
  miniApp_claimTask: gam.claimTask,

  // --- Приватные лиги (этап 3) ---
  miniApp_createPrivateLeague: priv.createPrivateLeague,
  miniApp_joinPrivateLeague: priv.joinPrivateLeague,
  miniApp_getMyPrivateLeagues: priv.getMyPrivateLeagues,
  miniApp_getAvailableMatchesForLeague: priv.getAvailableMatchesForLeague,
  miniApp_addMatchesToLeague: priv.addMatchesToLeague,
  miniApp_getLeagueMatchesList: priv.getLeagueMatchesList,
  miniApp_getPrivateLeagueRating: priv.getPrivateLeagueRating,
  miniApp_leavePrivateLeague: priv.leavePrivateLeague,
  miniApp_deletePrivateLeague: priv.deletePrivateLeague,

  // --- Магазин (этап 5) ---
  miniApp_getShop: shop.getShop,
  miniApp_openBox: shop.openBox,
  miniApp_claimDailyBox: shop.claimDailyBox,
  miniApp_getCollection: shop.getCollection,
  miniApp_getMatchHighlights: shop.getMatchHighlights,
  miniApp_buyJoker: shop.buyJoker,
  miniApp_getJokerStatus: shop.getJokerStatus,
  miniApp_getWheelStatus: shop.getWheelStatus,
  miniApp_spinWheel: shop.spinWheel,
  miniApp_sellCard: shop.sellCard,
  miniApp_getXPHistory: shop.getXPHistory,

  // --- Team Builder + битвы (этап 6) ---
  miniApp_getTeamBuilder: team.getTeamBuilder,
  miniApp_saveTeam: team.saveTeam,
  miniApp_getMyTeam: team.getMyTeam,
  miniApp_startTeamBattle: team.startTeamBattle,
  miniApp_getBattleHistory: team.getBattleHistory,
};

// Функции будущих этапов — явные заглушки (чтобы фронт получал осмысленный ответ)
const STUBBED = new Set([] as string[]);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } });
  }
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' });

  let data: any;
  try { data = await req.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }); }

  const fn = String(data.fn || '');
  const args = Array.isArray(data.args) ? data.args : [];
  const initData = String(data.initData || '');

  // --- Админские функции: по key + chatId ---
  if (fn.indexOf('admin_') === 0) {
    try {
      requireAdmin(data.key, data.chatId);
      return json({ ok: false, error: 'admin handlers: этап 8 (пока не перенесены)' });
    } catch (e: any) {
      return json({ ok: false, error: e.message || 'unauthorized' });
    }
  }

  if (fn.indexOf('miniApp_') !== 0) return json({ ok: false, error: 'Unknown function' });

  // --- Валидация Telegram initData ---
  const tgUser = validateRequest(initData);
  if (!tgUser) {
    return json({ ok: false, error: 'auth', message: 'Ошибка авторизации Telegram. Закройте и откройте приложение заново.' });
  }

  if (STUBBED.has(fn)) {
    return json({ ok: false, error: 'Временно недоступно' });
  }

  const handler = HANDLERS[fn];
  if (!handler) return json({ ok: false, error: 'Function not found: ' + fn });

  try {
    const finalArgs = applyIdentity(fn, args, tgUser);
    const result = await handler(...(finalArgs as any[]));
    return json(result);
  } catch (e: any) {
    return json({ ok: false, error: e.message || 'Internal error' });
  }
});
