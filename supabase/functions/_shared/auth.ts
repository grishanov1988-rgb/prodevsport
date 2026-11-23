// ============================================================
//  АВТОРИЗАЦИЯ — порт handleApiRequest_/applyIdentity_ из Code.gs.
//  Идентификатор пользователя берётся из валидированного initData,
//  клиент не может выдать себя за другого.
// ============================================================

import { validateInitData } from './crypto.ts';
import { BOT_TOKEN, ADMIN_SECRET, ADMIN_CHAT_ID } from './config.ts';

export interface TgUser { id?: number; first_name?: string; last_name?: string; username?: string }

// Позиции chatId/userName в аргументах miniApp_* (0-based) — 1:1 с API_IDENTITY_MAP_
const IDENTITY_MAP: Record<string, { chatId?: number; userName?: number; payload?: boolean }> = {
  miniApp_getBootstrap:                 { chatId: 0, userName: 1 },
  miniApp_getUserPredictions:           { chatId: 0, userName: 1 },
  miniApp_getProfileDashboard:          { chatId: 0, userName: 1 },
  miniApp_getNotifySettings:            { chatId: 0, userName: 1 },
  miniApp_saveNotifySettings:           { chatId: 0, userName: 1 },
  miniApp_createPrivateLeague:          { chatId: 0, userName: 1 },
  miniApp_joinPrivateLeague:            { chatId: 0, userName: 1 },
  miniApp_getMyPrivateLeagues:          { chatId: 0, userName: 1 },
  miniApp_getAvailableMatchesForLeague: { chatId: 1, userName: 2 },
  miniApp_addMatchesToLeague:           { chatId: 2, userName: 3 },
  miniApp_getLeagueMatchesList:         { chatId: 1, userName: 2 },
  miniApp_getPrivateLeagueRating:       { chatId: 1, userName: 2 },
  miniApp_leavePrivateLeague:           { chatId: 0, userName: 1 },
  miniApp_deletePrivateLeague:          { chatId: 0, userName: 1 },
  miniApp_getGamification:              { chatId: 0, userName: 1 },
  miniApp_claimTask:                    { chatId: 0, userName: 1 },
  miniApp_getShop:                      { chatId: 0, userName: 1 },
  miniApp_openBox:                      { chatId: 0, userName: 1 },
  miniApp_claimDailyBox:                { chatId: 0, userName: 1 },
  miniApp_getCollection:                { chatId: 0, userName: 1 },
  miniApp_buyJoker:                     { chatId: 0, userName: 1 },
  miniApp_getJokerStatus:               { chatId: 0, userName: 1 },
  miniApp_getTeamBuilder:               { chatId: 0, userName: 1 },
  miniApp_saveTeam:                     { chatId: 0, userName: 1 },
  miniApp_getMyTeam:                    { chatId: 0, userName: 1 },
  miniApp_startTeamBattle:              { chatId: 0, userName: 1 },
  miniApp_getBattleHistory:             { chatId: 0, userName: 1 },
  miniApp_getWheelStatus:               { chatId: 0, userName: 1 },
  miniApp_spinWheel:                    { chatId: 0, userName: 1 },
  miniApp_sellCard:                     { chatId: 0, userName: 1 },
  miniApp_getXPHistory:                 { chatId: 0, userName: 1 },
  miniApp_getLeagueMatches:             { chatId: 1, userName: 2 },
  miniApp_getMatchPredictions:          { chatId: 2, userName: 3 },
  miniApp_savePrediction:               { payload: true },
  // Публичные данные / чужой профиль — без подмены:
  miniApp_getUserStats:                 {},
  miniApp_getAvailableTours:            {},
  miniApp_getTourRating:                {},
  miniApp_getMatchHighlights:           {},
};

export function userDisplayName(tgUser: TgUser): string {
  return ([tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') || tgUser.username || 'Участник').trim();
}

/** Подмена chatId/userName аргументов данными из валидированного initData */
export function applyIdentity(fn: string, args: unknown[], tgUser: TgUser): unknown[] {
  const map = IDENTITY_MAP[fn];
  if (!map) return args;
  const chatId = tgUser.id ? String(tgUser.id) : undefined;
  const userName = userDisplayName(tgUser);

  if (map.payload) {
    if (args[0] && typeof args[0] === 'object') {
      args[0] = { ...(args[0] as Record<string, unknown>), userName, chatId };
    }
    return args;
  }
  if (typeof map.chatId === 'number' && args.length > map.chatId && chatId) args[map.chatId] = chatId;
  if (typeof map.userName === 'number' && args.length > map.userName) args[map.userName] = userName;
  return args;
}

export function validateRequest(initData: string): TgUser | null {
  return validateInitData(initData, BOT_TOKEN) as TgUser | null;
}

export function requireAdmin(key: unknown, chatId: unknown): void {
  if (String(key) !== String(ADMIN_SECRET)) throw new Error('403 Unauthorized');
  if (String(chatId) !== String(ADMIN_CHAT_ID)) throw new Error('403 Forbidden');
}
