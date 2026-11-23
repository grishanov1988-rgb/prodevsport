// ============================================================
//  TELEGRAM BOT API — порт sendText / sendWebAppMenu из Code.gs
// ============================================================

import { BOT_TOKEN, MINIAPP_URL } from './config.ts';

export interface TgResult { ok: boolean; error?: string }

export async function sendText(chatId: string | number, text: string, keyboard?: unknown): Promise<TgResult> {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
  };
  if (keyboard) payload.reply_markup = keyboard;

  try {
    let res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      // fallback без Markdown (как в GAS-версии)
      const clone = { ...payload } as Record<string, unknown>;
      delete clone.parse_mode;
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(clone),
      });
    }
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && (data as { ok?: boolean }).ok === true, error: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** Кнопка открытия Mini App — ведёт на MINIAPP_URL (GitHub Pages) */
export async function sendWebAppMenu(chatId: string | number, userName: string): Promise<void> {
  if (!MINIAPP_URL) {
    await sendText(chatId, 'URL приложения не настроен (MINIAPP_URL).');
    return;
  }
  await sendText(chatId, 'Нажмите кнопку ниже, чтобы открыть приложение:', {
    inline_keyboard: [[{ text: 'Открыть прогнозы', web_app: { url: MINIAPP_URL } }]],
  });
}

export async function answerCallbackQuery(id: string, text?: string): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: id, text }),
    });
  } catch { /* не критично */ }
}
