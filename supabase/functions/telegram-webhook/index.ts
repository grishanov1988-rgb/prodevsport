// ============================================================
//  TELEGRAM WEBHOOK — порт doPost из Code.gs
//  Маршруты: callback_query (3 колбека), /admin, /start (+deep-link),
//  /whoami, upsert users, текстовые команды (профиль/рейтинг/правила/меню)
// ============================================================

import { db, upsert } from '../_shared/db.ts';
import { ADMIN_SECRET, ADMIN_CHAT_ID, ADMIN_URL, MINIAPP_URL } from '../_shared/config.ts';
import { sendText, sendWebAppMenu, answerCallbackQuery } from '../_shared/telegram.ts';
import { buildRating } from '../_shared/core.ts';
import { escapeMd, enc } from '../_shared/util.ts';

const json = (obj: unknown) =>
  new Response(JSON.stringify(obj), { headers: { 'Content-Type': 'application/json' } });

async function isDuplicate(updateId: number): Promise<boolean> {
  try {
    const key = `upd_${updateId}`;
    const rows = await db(`rate_limits?k=eq.${enc(key)}&select=k`) ?? [];
    if (rows.length) return true;
    // помечаем; запись удаляется очисткой (см. migration 0001)
    await upsert('rate_limits', [{ k: key, count: 1, created_at: new Date().toISOString() }], 'k');
    return false;
  } catch { return false; }
}

async function upsertUser(chatId: number | string, user: { first_name?: string; last_name?: string; username?: string }, userName: string): Promise<void> {
  try {
    await db('users?on_conflict=user_name', {
      method: 'post',
      body: [{
        chat_id: Number(chatId),
        user_name: String(userName).trim(),
        first_name: user.first_name || '',
        last_name: user.last_name || '',
        username: user.username || '',
      }],
      prefer: 'return=minimal,resolution=merge-duplicates',
    });
  } catch (e) {
    console.error('users upsert error:', e);
  }
}

async function showProfile(chatId: number, userName: string, user: { first_name?: string; last_name?: string }): Promise<void> {
  try {
    const cleanUser = String(userName).trim();
    const preds = await db(`predictions?user_name=eq.${enc(cleanUser)}&select=id`) ?? [];
    const totalPredictions = preds.length;
    const ratingData = await buildRating();
    let place: number | string = '-', points = 0;
    const totalPlayers = ratingData.length;
    for (let i = 0; i < ratingData.length; i++) {
      if (ratingData[i].name === cleanUser) { place = i + 1; points = ratingData[i].points; break; }
    }
    const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ') || userName;
    const msg = `Профиль\n${escapeMd(fullName)}\n\nПрогнозов: ${totalPredictions}\nМесто: ${place} из ${totalPlayers}\nОчков: ${points}\n`;
    await sendText(chatId, msg, { inline_keyboard: [
      [{ text: 'Обновить', callback_data: 'profile_refresh' }],
      [{ text: 'Рейтинг', callback_data: 'refresh_rating' }],
    ] });
  } catch {
    await sendText(chatId, 'Ошибка профиля.');
  }
}

async function showRating(chatId: number): Promise<void> {
  try {
    const ratingData = await buildRating();
    if (!ratingData.length) { await sendText(chatId, 'Рейтинг пуст.'); return; }
    let resp = 'Текущий рейтинг:\n\n';
    for (let i = 0; i < Math.min(ratingData.length, 20); i++) {
      resp += `${i + 1}. ${escapeMd(ratingData[i].name)} - ${ratingData[i].points}\n`;
    }
    await sendText(chatId, resp, { inline_keyboard: [[{ text: 'Обновить', callback_data: 'refresh_rating' }]] });
  } catch {
    await sendText(chatId, 'Ошибка рейтинга.');
  }
}

async function showRules(chatId: number): Promise<void> {
  await sendText(chatId, 'Правила игры\n\nУгадан исход: +1\nУгадана разница: +3\nТочный счет: +5\n\nПрогноз - до начала матча.');
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: true });

  let data: any;
  try {
    data = await req.json();
  } catch {
    return new Response('ok');
  }

  // ==== MINI APP API-стиль запросов сюда не шлём (это /functions/v1/miniapp) ====

  const updateId = data.update_id;
  if (updateId && (await isDuplicate(Number(updateId)))) {
    return new Response('ok');
  }

  // === CALLBACK QUERY ===
  if (data.callback_query) {
    try {
      const cbId = data.callback_query.id;
      const cb = data.callback_query.data;
      const user = data.callback_query.from || {};
      const chatId = data.callback_query.message?.chat?.id;
      const userName = (user.first_name || '').trim() || (user.username || '').trim() || 'Участник';
      if (!chatId) return new Response('ok');

      if (cb === 'back_to_menu')    { await answerCallbackQuery(cbId); await sendWebAppMenu(chatId, userName); return new Response('ok'); }
      if (cb === 'refresh_rating')  { await answerCallbackQuery(cbId); await showRating(chatId); return new Response('ok'); }
      if (cb === 'profile_refresh') { await answerCallbackQuery(cbId); await showProfile(chatId, userName, user); return new Response('ok'); }
    } catch (e) {
      console.error('callback_query error:', e);
    }
    return new Response('ok');
  }

  // === MESSAGE ===
  if (data.message) {
    try {
      const rawText = data.message.text || '';
      const user = data.message.from || {};
      const chat = data.message.chat || {};
      const chatId = chat.id;
      const userName = (user.first_name || '').trim() || (user.username || '').trim() || 'Участник';
      if (!chatId) return new Response('ok');

      const text = String(rawText).replace(/[​-‍﻿]/g, '').trim().toLowerCase();
      console.log(`webhook: chatId=${chatId} text="${text}"`);

      // 1. /admin — без обращения к БД
      if (text.indexOf('/admin') === 0) {
        if (String(chatId) !== String(ADMIN_CHAT_ID)) {
          await sendText(chatId, '❌ Доступ запрещён.');
          return new Response('ok');
        }
        const adminUrl = ADMIN_URL
          ? `${ADMIN_URL}?key=${encodeURIComponent(ADMIN_SECRET)}&chatId=${chatId}&v=${Date.now()}`
          : '';
        if (!adminUrl) {
          await sendText(chatId, '⚠️ ADMIN_URL не настроен (админка ещё не перенесена — этап 8).');
          return new Response('ok');
        }
        const res = await sendText(chatId, '🔧 *Админ-панель*', {
          inline_keyboard: [[{ text: 'Открыть', web_app: { url: adminUrl } }]],
        });
        if (!res.ok) await sendText(chatId, `⚠️ Ошибка кнопки. Ссылка:\n\n${adminUrl}`);
        return new Response('ok');
      }

      // 2. /start (+deep-link league_CODE)
      if (text === '/start' || text === 'start' || text === 'меню' || text.indexOf('/start') === 0) {
        const parts = String(rawText).trim().split(/\s+/);
        const payload = parts.length > 1 ? parts[1].trim() : '';
        if (payload && payload.indexOf('league_') === 0) {
          const code = payload.substring(7).toUpperCase().replace(/[^A-Z0-9]/g, '');
          // TODO(этап 3): miniApp_joinPrivateLeague — пока сообщаем, что скоро
          await sendText(chatId, `🔗 Код лиги «${code}» получен. Вступление через приложение: Рейтинг → Мои лиги.`);
        }
        await sendWebAppMenu(chatId, userName);
        return new Response('ok');
      }

      // 3. /whoami
      if (text === '/whoami' || text === 'кто я') {
        await sendText(chatId, `👤 *Твои данные*\n\nchat_id: \`${chatId}\`\nИмя: ${escapeMd((user.first_name || '') + ' ' + (user.last_name || ''))}`);
        return new Response('ok');
      }

      // 4. Сохраняем юзера
      await upsertUser(chatId, user, userName);

      // 5. Текстовые команды
      if (text === 'профиль' || text === 'profile') { await showProfile(chatId, userName, user); return new Response('ok'); }
      if (text === 'рейтинг' || text === 'rating')  { await showRating(chatId); return new Response('ok'); }
      if (text === 'правила' || text === 'rules')   { await showRules(chatId); return new Response('ok'); }
      if (text === 'статистика' || text === 'stats') { await showRating(chatId); return new Response('ok'); }

      await sendWebAppMenu(chatId, userName);
    } catch (e) {
      console.error('message error:', e);
    }
    return new Response('ok');
  }

  return new Response('ok');
});
