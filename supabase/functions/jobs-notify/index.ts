// ============================================================
//  JOBS-NOTIFY (этап 7) — уведомления о приближающихся матчах.
//  Порт notifyUpcomingMatches из Code.gs:
//  • за 3 часа до матча — «Скоро начало»
//  • за 1 час — «Последний шанс»
//  • не шлём тем, кто уже сделал прогноз или отписался от лиги
//  • дедупликация через notify_log
//
//  Плюс служебная очистка: notify_log (>48ч) и rate_limits (>2ч).
//
//  Защита: Authorization: Bearer <ADMIN_SECRET>.
//  Вешается на расписание через Supabase Cron ( supabase/functions/jobs-notify )
//  или внешний cron: curl -H "Authorization: Bearer $ADMIN_SECRET" \
//    https://<проект>.supabase.co/functions/v1/jobs-notify
// ============================================================

import { db } from '../_shared/db.ts';
import { LEAGUES, ADMIN_SECRET, MINIAPP_URL } from '../_shared/config.ts';
import { enc, formatDateMsk } from '../_shared/util.ts';
import { sendText } from '../_shared/telegram.ts';
import { getUserChats } from '../_shared/core.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

// ------------------------------------------------------------
//  notify_log — дедупликация отправок
// ------------------------------------------------------------
async function getNotifyLogFromDB(): Promise<Record<string, boolean>> {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const rows = await db(`notify_log?select=user_name,match_key,type_key&sent_at=gte.${enc(cutoff)}`) ?? [];
    const map: Record<string, boolean> = {};
    rows.forEach((r: any) => { map[r.user_name + '||' + r.match_key + '||' + r.type_key] = true; });
    return map;
  } catch { return {}; }
}

async function saveNotifyLogDB(userName: string, matchKey: string, typeKey: string): Promise<void> {
  try {
    await db('notify_log?on_conflict=user_name,match_key,type_key', {
      method: 'post',
      body: [{ user_name: userName, match_key: matchKey, type_key: typeKey, sent_at: new Date().toISOString() }],
      prefer: 'return=minimal,resolution=ignore-duplicates',
    });
  } catch { /* ignore */ }
}

async function cleanup(): Promise<void> {
  try {
    const cutoffNotify = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    await db(`notify_log?sent_at=lt.${enc(cutoffNotify)}`, { method: 'delete', prefer: 'return=minimal' });
  } catch { /* ignore */ }
  try {
    await db('rpc/rate_limits_cleanup', { method: 'post', body: {} });
  } catch { /* ignore */ }
}

// ------------------------------------------------------------
//  Основная логика
// ------------------------------------------------------------
async function notifyUpcomingMatches(): Promise<{ sent3h: number; sent1h: number }> {
  const now = Date.now();
  const w3Start = new Date(now + 2 * 60 * 60 * 1000).toISOString();
  const w3End = new Date(now + 3 * 60 * 60 * 1000 + 30 * 60 * 1000).toISOString();
  const w1Start = new Date(now + 30 * 60 * 1000).toISOString();
  const w1End = new Date(now + 60 * 60 * 1000 + 30 * 60 * 1000).toISOString();

  const matches3h = await db(`matches?real_score=is.null&utc_date=gte.${enc(w3Start)}&utc_date=lte.${enc(w3End)}&order=utc_date.asc`) ?? [];
  const matches1h = await db(`matches?real_score=is.null&utc_date=gte.${enc(w1Start)}&utc_date=lte.${enc(w1End)}&order=utc_date.asc`) ?? [];

  if (!matches3h.length && !matches1h.length) return { sent3h: 0, sent1h: 0 };

  const allPreds = await db('predictions?select=user_name,league_code,match_norm') ?? [];
  const madeByUser: Record<string, Record<string, boolean>> = {};
  allPreds.forEach((p: any) => {
    if (!p.user_name || !p.match_norm) return;
    if (!madeByUser[p.user_name]) madeByUser[p.user_name] = {};
    madeByUser[p.user_name][p.league_code + '||' + p.match_norm] = true;
  });

  const subsRows = await db('subscriptions?select=user_name,leagues') ?? [];
  const subMap: Record<string, any> = {};
  subsRows.forEach((r: any) => { subMap[r.user_name] = r.leagues; });

  const sentLog = await getNotifyLogFromDB();
  const userChats = await getUserChats();
  if (!Object.keys(userChats).length) return { sent3h: 0, sent1h: 0 };

  async function sendBatch(matches: any[], typeKey: string, headerText: string): Promise<number> {
    if (!matches.length) return 0;
    let sent = 0;
    for (const userName in userChats) {
      const chatId = userChats[userName];
      if (!chatId) continue;
      const userSubs = subMap[userName];
      const need: any[] = [];
      for (const m of matches) {
        if (userSubs !== undefined && userSubs !== null) {
          if (Array.isArray(userSubs) && userSubs.indexOf(m.league_code) === -1) continue;
        }
        const predKey = m.league_code + '||' + m.match_norm;
        if (madeByUser[userName] && madeByUser[userName][predKey]) continue;
        const logKey = userName + '||' + m.league_code + '||' + m.match_norm + '||' + typeKey;
        if (sentLog[logKey]) continue;
        need.push(m);
      }
      if (!need.length) continue;

      let text = headerText + '\n\n';
      need.slice(0, 8).forEach((m) => {
        const d = formatDateMsk(m.utc_date, 'HH:mm');
        const lg = (LEAGUES as any)[m.league_code];
        const lgPrefix = lg ? lg.emoji + ' ' : '';
        text += lgPrefix + m.match_name + ' — *' + d + '*\n';
      });
      if (need.length > 8) text += '…и ещё ' + (need.length - 8) + ' матч(ей)\n';
      text += '\n👉 Откройте приложение, чтобы сделать прогноз.';

      const result = await sendText(chatId, text, {
        inline_keyboard: [[{ text: 'Открыть прогнозы', web_app: { url: MINIAPP_URL } }]],
      });
      if (result && result.ok) {
        for (const m of need) {
          await saveNotifyLogDB(userName, m.league_code + '||' + m.match_norm, typeKey);
          sentLog[userName + '||' + m.league_code + '||' + m.match_norm + '||' + typeKey] = true;
        }
        sent++;
      }
    }
    return sent;
  }

  const sent3h = await sendBatch(matches3h, '3h', '⏰ *Скоро начало матчей*\n\nНе забудьте сделать прогноз:');
  const sent1h = await sendBatch(matches1h, '1h', '🔥 *Матч начнётся меньше чем через час!*\n\nПоследний шанс сделать прогноз:');
  return { sent3h, sent1h };
}

// ------------------------------------------------------------
Deno.serve(async (req) => {
  const auth = req.headers.get('Authorization') || '';
  if (!ADMIN_SECRET || auth !== 'Bearer ' + ADMIN_SECRET) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  try {
    const result = await notifyUpcomingMatches();
    await cleanup();
    return json({ ok: true, ...result });
  } catch (e: any) {
    return json({ ok: false, error: e.message }, 500);
  }
});
