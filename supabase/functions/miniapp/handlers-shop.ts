// ============================================================
//  МАГАЗИН (этап 5) — порт из Code.gs:
//  getShop, openBox, claimDailyBox, getCollection, getMatchHighlights,
//  buyJoker, getJokerStatus, getWheelStatus, spinWheel, sellCard, getXPHistory
// ============================================================

import { db } from '../_shared/db.ts';
import { enc, getPeriodKey } from '../_shared/util.ts';
import { TEAM_TRANSLATIONS } from '../_shared/translations.ts';
import { checkRateLimit } from '../_shared/core.ts';
import { getXPProfile, addXP, spendXP, wasXPAwarded, logXPAward } from '../_shared/gamification.ts';

const JOKER_PRICE_XP = 500;
const WHEEL_SEGMENTS = [25, 100, 50, 200, 75, 150, 25, 300];
const WHEEL_WEIGHTS = [22, 12, 20, 6, 16, 8, 12, 4];
const WHEEL_PAID_PRICE = 100;
const CARD_SELL_MULT: Record<string, number> = { common: 1, rare: 2, epic: 3, legendary: 5, mythic: 8 };

function rollRarity(weights: Record<string, number>): string {
  const keys = Object.keys(weights);
  let total = 0;
  keys.forEach((k) => { total += Number(weights[k]) || 0; });
  if (total <= 0) return keys[0];
  const r = Math.random() * total;
  let acc = 0;
  for (let i = 0; i < keys.length; i++) {
    acc += Number(weights[keys[i]]) || 0;
    if (r < acc) return keys[i];
  }
  return keys[keys.length - 1];
}

function hashString(s: string): string {
  let h = 0;
  const str = String(s || '');
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}

// ------------------------------------------------------------
//  getShop
// ------------------------------------------------------------
export async function getShop(_chatId: unknown, userName: unknown) {
  try {
    const clean = String(userName || '').trim();
    const xp = await getXPProfile(clean);
    let balance = (xp && xp.totalXP) || 0;
    try {
      const rows = await db(`xp_profiles?user_name=eq.${enc(clean)}&select=xp_balance`) ?? [];
      if (rows.length && rows[0].xp_balance != null) balance = Number(rows[0].xp_balance);
    } catch { /* ignore */ }
    const boxes = await db('box_types?is_active=eq.true&order=price_xp.asc') ?? [];
    const cards = await db(`user_cards?user_name=eq.${enc(clean)}&select=card_id,quantity`) ?? [];
    const totalCards = cards.reduce((s: number, c: any) => s + (Number(c.quantity) || 0), 0);
    const uniqueCards = cards.length;
    const catalog = await db('cards_catalog?select=id&is_active=eq.true') ?? [];
    return {
      ok: true, balance,
      boxes: boxes.map((b: any) => ({
        code: b.code, name: b.name, emoji: b.emoji, price: b.price_xp,
        cardsPerBox: b.cards_per_box, weights: b.rarity_weights,
        canAfford: balance >= b.price_xp,
      })),
      stats: {
        balance, totalCards, uniqueCards, catalogTotal: catalog.length,
        completionPct: catalog.length ? Math.round((uniqueCards / catalog.length) * 100) : 0,
      },
    };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

// ------------------------------------------------------------
//  openBox
// ------------------------------------------------------------
export async function openBox(_chatId: unknown, userName: unknown, boxCode: unknown) {
  try {
    const clean = String(userName || '').trim();
    const code = String(boxCode || '').trim().toLowerCase();
    if (!clean || !code) return { ok: false, error: 'Неверные параметры' };
    if (!(await checkRateLimit('box_' + clean, 20))) return { ok: false, error: 'Слишком часто. Подождите.' };

    const boxRows = await db(`box_types?code=eq.${enc(code)}&is_active=eq.true`) ?? [];
    if (!boxRows.length) return { ok: false, error: 'Бокс не найден' };
    const box = boxRows[0];
    const price = Number(box.price_xp);

    const spend = await spendXP(clean, price, 'box_' + code);
    if (!spend.ok) return spend;

    const catalog = await db('cards_catalog?is_active=eq.true&select=id,name,position,club,country,country_code,ovr,rarity,image_url,pac,sho,pas,dri,def,phy,is_gk') ?? [];
    const byRarity: Record<string, any[]> = {};
    catalog.forEach((c: any) => { (byRarity[c.rarity] = byRarity[c.rarity] || []).push(c); });

    const weights = box.rarity_weights || { common: 55, rare: 30, epic: 12, legendary: 3 };
    const cardsPerBox = Number(box.cards_per_box) || 3;
    const received: any[] = [];
    for (let i = 0; i < cardsPerBox; i++) {
      let rarity = rollRarity(weights);
      let pool = byRarity[rarity] || [];
      let attempts = 0;
      while (!pool.length && attempts < 5) { rarity = rollRarity(weights); pool = byRarity[rarity] || []; attempts++; }
      if (!pool.length) pool = catalog;
      received.push(pool[Math.floor(Math.random() * pool.length)]);
    }

    for (const card of received) {
      try {
        const existing = await db(`user_cards?user_name=eq.${enc(clean)}&card_id=eq.${card.id}&select=id,quantity`) ?? [];
        if (existing.length) {
          await db(`user_cards?id=eq.${existing[0].id}`, {
            method: 'patch',
            body: { quantity: (Number(existing[0].quantity) || 0) + 1 },
            prefer: 'return=minimal',
          });
        } else {
          await db('user_cards', {
            method: 'post',
            body: [{ user_name: clean, card_id: card.id, quantity: 1 }],
            prefer: 'return=minimal,resolution=ignore-duplicates',
          });
        }
      } catch { /* ignore */ }
    }

    try {
      await db('box_openings', {
        method: 'post',
        body: [{ user_name: clean, box_code: code, card_ids: received.map((c) => c.id), xp_spent: price }],
        prefer: 'return=minimal',
      });
    } catch { /* ignore */ }

    return {
      ok: true, newBalance: (spend as any).newBalance, spent: price,
      cards: received.map((c) => ({
        id: c.id, name: c.name, position: c.position, club: c.club, country: c.country,
        countryCode: c.country_code, ovr: c.ovr, rarity: c.rarity, imageUrl: c.image_url,
        pac: c.pac, sho: c.sho, pas: c.pas, dri: c.dri, def: c.def, phy: c.phy, isGk: c.is_gk,
      })),
    };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

// ------------------------------------------------------------
//  claimDailyBox — 1 бесплатная карточка в день
// ------------------------------------------------------------
export async function claimDailyBox(_chatId: unknown, userName: unknown) {
  try {
    const clean = String(userName || '').trim();
    if (!clean) return { ok: false, error: 'Не указан пользователь' };

    const todayKey = getPeriodKey('daily');
    const rows = await db(`xp_profiles?user_name=eq.${enc(clean)}&select=last_daily_box`) ?? [];
    const last = (rows[0] && rows[0].last_daily_box) || null;
    if (last === todayKey) return { ok: false, error: 'Сегодня уже забирали. Приходите завтра!', alreadyClaimed: true };

    const weights = { common: 60, rare: 25, epic: 10, legendary: 4, mythic: 1 };
    const catalog = await db('cards_catalog?is_active=eq.true&select=id,name,position,club,country,country_code,ovr,rarity,image_url,pac,sho,pas,dri,def,phy,is_gk') ?? [];
    if (!catalog.length) return { ok: false, error: 'Каталог карточек пуст' };

    const byRarity: Record<string, any[]> = {};
    catalog.forEach((c: any) => { (byRarity[c.rarity] = byRarity[c.rarity] || []).push(c); });

    const rarity = rollRarity(weights);
    const pool = byRarity[rarity] || catalog;
    const card = pool[Math.floor(Math.random() * pool.length)];

    try {
      const existing = await db(`user_cards?user_name=eq.${enc(clean)}&card_id=eq.${card.id}&select=id,quantity`) ?? [];
      if (existing.length) {
        await db(`user_cards?id=eq.${existing[0].id}`, {
          method: 'patch',
          body: { quantity: (Number(existing[0].quantity) || 0) + 1 },
          prefer: 'return=minimal',
        });
      } else {
        await db('user_cards', {
          method: 'post',
          body: [{ user_name: clean, card_id: card.id, quantity: 1 }],
          prefer: 'return=minimal,resolution=ignore-duplicates',
        });
      }
    } catch { /* ignore */ }

    await db('xp_profiles?on_conflict=user_name', {
      method: 'post',
      body: [{ user_name: clean, last_daily_box: todayKey, updated_at: new Date().toISOString() }],
      prefer: 'return=minimal,resolution=merge-duplicates',
    });

    try {
      await db('box_openings', {
        method: 'post',
        body: [{ user_name: clean, box_code: 'daily_free', card_ids: [card.id], xp_spent: 0 }],
        prefer: 'return=minimal',
      });
    } catch { /* ignore */ }

    return {
      ok: true,
      card: {
        id: card.id, name: card.name, position: card.position, club: card.club,
        country: card.country, countryCode: card.country_code, ovr: card.ovr,
        rarity: card.rarity, imageUrl: card.image_url,
        pac: card.pac, sho: card.sho, pas: card.pas, dri: card.dri, def: card.def, phy: card.phy, isGk: card.is_gk,
      },
    };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

// ------------------------------------------------------------
//  getCollection
// ------------------------------------------------------------
export async function getCollection(_chatId: unknown, userName: unknown) {
  try {
    const clean = String(userName || '').trim();
    const rows = await db(`user_cards?user_name=eq.${enc(clean)}&select=card_id,quantity,first_obtained_at,cards_catalog(id,name,position,club,country,country_code,ovr,rarity,image_url)&order=first_obtained_at.desc`) ?? [];
    const byRarity: Record<string, number> = { common: 0, rare: 0, epic: 0, legendary: 0, mythic: 0 };
    const list = rows.map((r: any) => {
      const c = r.cards_catalog || {};
      if (byRarity[c.rarity] != null) byRarity[c.rarity] += Number(r.quantity) || 0;
      return {
        cardId: r.card_id, name: c.name, position: c.position, club: c.club, country: c.country,
        countryCode: c.country_code, ovr: c.ovr, rarity: c.rarity, imageUrl: c.image_url,
        pac: c.pac, sho: c.sho, pas: c.pas, dri: c.dri, def: c.def, phy: c.phy, isGk: c.is_gk,
        quantity: Number(r.quantity) || 1, obtainedAt: r.first_obtained_at,
      };
    });
    const order: Record<string, number> = { mythic: 0, legendary: 1, epic: 2, rare: 3, common: 4 };
    list.sort((a: any, b: any) => {
      const d = (order[a.rarity] ?? 9) - (order[b.rarity] ?? 9);
      if (d !== 0) return d;
      return (Number(b.ovr) || 0) - (Number(a.ovr) || 0);
    });
    const totalCatalog = await db('cards_catalog?select=id&is_active=eq.true') ?? [];
    return {
      ok: true, cards: list,
      stats: {
        totalCards: list.reduce((s: number, c: any) => s + c.quantity, 0),
        uniqueCards: list.length,
        catalogTotal: totalCatalog.length,
        completionPct: totalCatalog.length ? Math.round((list.length / totalCatalog.length) * 100) : 0,
        byRarity,
      },
    };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

// ------------------------------------------------------------
//  getMatchHighlights (ScoreBat — реальные видеообзоры) — кэш 1ч
// ------------------------------------------------------------
const SCOREBAT_URL = 'https://www.scorebat.com/video-api/v3/';
const SB_FEED_TTL = 60 * 60 * 1000;
let sbFeedCache: { at: number; data: any[] } | null = null;
let sbFeedPromise: Promise<any[]> | null = null;

const TOKEN_STOP = new Set([
  'fc', 'afc', 'cf', 'sc', 'ac', 'cd', 'ud', 'rc', 'rcd', 'club', 'de', 'fk', 'sk',
  'kv', 'vfb', 'the', 'and', 'city', '04',
]);
const TOKEN_ALIASES: Record<string, string[]> = {
  'internazionale': ['inter'],
  'munchen': ['munich'],
  'paris': ['psg'], 'saint': ['psg'], 'germain': ['psg'],
  'hotspur': ['spurs'],
  'wanderers': ['wolves'],
  'hotspurs': ['spurs'],
};

function foldDiacritics(s: string): string {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function tokenize(s: string): string[] {
  const out = new Set<string>();
  for (const t of foldDiacritics(s).toLowerCase().split(/[^a-z0-9а-я]+/)) {
    if (t.length >= 2 && !TOKEN_STOP.has(t)) out.add(t);
  }
  return Array.from(out);
}

let ruToEn: Record<string, string> | null = null;
function teamTokensRuToEn(ruName: string): string[] {
  if (!ruToEn) {
    ruToEn = {};
    for (const en of Object.keys(TEAM_TRANSLATIONS)) {
      const ru = (TEAM_TRANSLATIONS as any)[en];
      if (ru && !ruToEn[ru]) ruToEn[ru] = en;
    }
  }
  const en = ruToEn[ruName] || ruName;
  const toks = tokenize(en);
  // Альтернативные варианты токенов (прозвища клубов)
  const expanded = new Set<string>(toks);
  for (const t of toks) {
    const al = TOKEN_ALIASES[t];
    if (al) al.forEach((a) => expanded.add(a));
  }
  return Array.from(expanded);
}

function countTokenMatches(teamTokens: string[], titleSet: Set<string>): number {
  let n = 0;
  for (const t of teamTokens) if (titleSet.has(t)) n++;
  return n;
}

async function getScorebatFeed(): Promise<any[]> {
  if (sbFeedCache && Date.now() - sbFeedCache.at < SB_FEED_TTL) return sbFeedCache.data;
  if (sbFeedPromise) return sbFeedPromise;
  sbFeedPromise = (async () => {
    try {
      const resp = await fetch(SCOREBAT_URL, { signal: AbortSignal.timeout(15000) });
      if (!resp.ok) return [];
      const data = await resp.json();
      const feed = Array.isArray(data.response) ? data.response : [];
      sbFeedCache = { at: Date.now(), data: feed };
      return feed;
    } catch {
      return sbFeedCache?.data ?? [];
    } finally {
      sbFeedPromise = null;
    }
  })();
  return sbFeedPromise;
}

export async function getMatchHighlights(_leagueCode: unknown, matchName: unknown, _realScore: unknown) {
  try {
    const cleanMatch = String(matchName || '').trim();
    if (!cleanMatch) return { ok: false, error: 'Не указан матч' };

    const parts = cleanMatch.split(/\s+[-–—]\s+/);
    const homeRu = (parts[0] || '').trim();
    const awayRu = (parts[1] || '').trim();
    if (!homeRu || !awayRu) return { ok: false, error: 'Не указан матч' };

    const homeTokens = teamTokensRuToEn(homeRu);
    const awayTokens = teamTokensRuToEn(awayRu);
    if (!homeTokens.length || !awayTokens.length) return { ok: true, videos: [] };

    const feed = await getScorebatFeed();
    if (!feed.length) return { ok: true, videos: [] };

    let best: any = null;
    let bestScore = 0;
    for (const item of feed) {
      const titleSet = new Set(tokenize(String(item.title || '').split('|')[0]));
      if (!titleSet.size) continue;
      const h = countTokenMatches(homeTokens, titleSet);
      const a = countTokenMatches(awayTokens, titleSet);
      if (h === 0 || a === 0) continue;
      const score = h + a;
      if (score > bestScore) { bestScore = score; best = item; }
    }

    if (!best) return { ok: true, videos: [] };

    const videos = (Array.isArray(best.videos) ? best.videos : [])
      .map((v: any) => {
        const m = String(v.embed || '').match(/src='([^']+)'/);
        const src = m ? m[1] : '';
        if (src.indexOf('https://www.scorebat.com/embed/') !== 0) return null;
        return { embed: src, title: String(v.title || '').trim() };
      })
      .filter(Boolean);

    return { ok: true, videos, matchTitle: String(best.title || '').split('|')[0].trim() };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

// ------------------------------------------------------------
//  buyJoker / getJokerStatus
// ------------------------------------------------------------
export async function buyJoker(_chatId: unknown, userName: unknown) {
  try {
    const clean = String(userName || '').trim();
    if (!clean) return { ok: false, error: 'Не указан пользователь' };

    const spend = await spendXP(clean, JOKER_PRICE_XP, 'joker_purchase');
    if (!spend.ok) return spend;

    const rows = await db(`xp_profiles?user_name=eq.${enc(clean)}&select=jokers_count`) ?? [];
    const current = (rows[0] && rows[0].jokers_count) || 0;
    const newCount = Number(current) + 1;

    await db('xp_profiles?on_conflict=user_name', {
      method: 'post',
      body: [{ user_name: clean, jokers_count: newCount, updated_at: new Date().toISOString() }],
      prefer: 'return=minimal,resolution=merge-duplicates',
    });

    return { ok: true, newBalance: (spend as any).newBalance, jokersCount: newCount };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

export async function getJokerStatus(_chatId: unknown, userName: unknown) {
  try {
    const clean = String(userName || '').trim();
    const rows = await db(`xp_profiles?user_name=eq.${enc(clean)}&select=jokers_count,last_joker_week,xp_balance`) ?? [];
    const p: any = rows[0] || {};
    const currentWeek = getPeriodKey('weekly');
    const usedThisWeek = String(p.last_joker_week || '') === currentWeek;
    return {
      ok: true,
      jokersCount: Number(p.jokers_count) || 0,
      usedThisWeek,
      canUseNow: (Number(p.jokers_count) || 0) > 0 && !usedThisWeek,
      price: JOKER_PRICE_XP,
      currentWeek,
    };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

// ------------------------------------------------------------
//  Колесо фортуны
// ------------------------------------------------------------
export async function getWheelStatus(_chatId: unknown, userName: unknown) {
  try {
    const clean = String(userName || '').trim();
    if (!clean) return { ok: false, error: 'Не указан пользователь' };
    const todayKey = getPeriodKey('daily');
    const freeAvailable = !(await wasXPAwarded(clean, 'wheel_' + todayKey, 'wheel_free_spin'));
    let balance = 0;
    try {
      const rows = await db(`xp_profiles?user_name=eq.${enc(clean)}&select=xp_balance,total_xp`) ?? [];
      if (rows.length) balance = rows[0].xp_balance != null ? Number(rows[0].xp_balance) : (Number(rows[0].total_xp) || 0);
    } catch { /* ignore */ }
    return {
      ok: true,
      segments: WHEEL_SEGMENTS,
      freeAvailable,
      paidPrice: WHEEL_PAID_PRICE,
      canPaid: balance >= WHEEL_PAID_PRICE,
      balance,
    };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

export async function spinWheel(_chatId: unknown, userName: unknown) {
  try {
    const clean = String(userName || '').trim();
    if (!clean) return { ok: false, error: 'Не указан пользователь' };
    if (!(await checkRateLimit('wheel_' + clean, 15))) return { ok: false, error: 'Слишком часто. Подождите минуту.' };

    const todayKey = getPeriodKey('daily');
    const freeUsed = await wasXPAwarded(clean, 'wheel_' + todayKey, 'wheel_free_spin');
    const paid = freeUsed; // первый спин за день бесплатный, далее платный
    if (paid) {
      const spend = await spendXP(clean, WHEEL_PAID_PRICE, 'wheel_paid_spin');
      if (!spend.ok) return spend;
    }

    // Сервер — единственный источник результата
    let total = 0;
    WHEEL_WEIGHTS.forEach((w) => { total += w; });
    const r = Math.random() * total;
    let acc = 0, idx = 0;
    for (let i = 0; i < WHEEL_WEIGHTS.length; i++) {
      acc += WHEEL_WEIGHTS[i];
      if (r < acc) { idx = i; break; }
    }
    const prizeXP = WHEEL_SEGMENTS[idx];
    const xpRes = await addXP(clean, prizeXP, 'wheelPrize');
    if (!paid) await logXPAward(clean, 'wheel_' + todayKey, 'wheel_free_spin', 0);

    try {
      await db('box_openings', {
        method: 'post',
        body: [{ user_name: clean, box_code: 'wheel_spin', card_ids: [], xp_spent: paid ? WHEEL_PAID_PRICE : 0 }],
        prefer: 'return=minimal',
      });
    } catch { /* ignore */ }

    return { ok: true, prizeIndex: idx, prizeXP, paid, newBalance: xpRes ? (xpRes as any).balance : null, xp: xpRes };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

// ------------------------------------------------------------
//  sellCard
// ------------------------------------------------------------
export async function sellCard(_chatId: unknown, userName: unknown, cardId: unknown) {
  try {
    const clean = String(userName || '').trim();
    const cid = Number(cardId) || 0;
    if (!clean || !cid) return { ok: false, error: 'Неверные параметры' };
    if (!(await checkRateLimit('sell_' + clean, 20))) return { ok: false, error: 'Слишком часто. Подождите минуту.' };

    const rows = await db(`user_cards?user_name=eq.${enc(clean)}&card_id=eq.${cid}&select=id,quantity,cards_catalog(ovr,rarity,name)`) ?? [];
    if (!rows.length) return { ok: false, error: 'Карточка не найдена' };
    const row = rows[0];
    const qty = Number(row.quantity) || 0;
    if (qty < 1) return { ok: false, error: 'Нечего продавать' };

    const cat = row.cards_catalog || {};
    const price = (Number(cat.ovr) || 50) * (CARD_SELL_MULT[cat.rarity] || 1);
    const newQty = qty - 1;
    if (newQty > 0) {
      await db(`user_cards?id=eq.${row.id}`, { method: 'patch', body: { quantity: newQty }, prefer: 'return=minimal' });
    } else {
      await db(`user_cards?id=eq.${row.id}`, { method: 'delete', prefer: 'return=minimal' });
    }

    const xpRes = await addXP(clean, price, 'sellCard');
    return { ok: true, gained: price, quantity: newQty, cardName: cat.name || '', xp: xpRes };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

// ------------------------------------------------------------
//  getXPHistory
// ------------------------------------------------------------
export async function getXPHistory(_chatId: unknown, userName: unknown) {
  try {
    const clean = String(userName || '').trim();
    if (!clean) return { ok: false, error: 'Не указан пользователь' };
    const rows = await db(`xp_logs?user_name=eq.${enc(clean)}&order=id.desc&limit=30`) ?? [];
    const items = rows.map((r: any) => ({
      reason: String(r.reason || ''), xp: Number(r.xp) || 0, matchKey: String(r.match_key || ''),
    }));
    return { ok: true, items };
  } catch (e: any) { return { ok: false, error: e.message }; }
}
