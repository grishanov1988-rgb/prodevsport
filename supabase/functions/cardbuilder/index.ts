// ============================================================
//  CARDBUILDER — разовый импорт каталога карточек
//  Принимает батч карточек, резолвит фото через Wikipedia API,
//  вставляет в cards_catalog. Требует ADMIN_SECRET.
// ============================================================
import { db } from '../_shared/db.ts';

const ADMIN_SECRET = Deno.env.get('ADMIN_SECRET') ?? '';
const WIKI = 'https://en.wikipedia.org/w/api.php';

async function wikiJson(params: Record<string, string>, attempt = 0): Promise<any> {
  const qs = new URLSearchParams({ format: 'json', ...params });
  try {
    const r = await fetch(`${WIKI}?${qs}`, {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'DevSportBot/1.0 (football app)' },
    });
    if (r.status === 429 || r.status === 503) {
      if (attempt < 3) {
        await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
        return wikiJson(params, attempt + 1);
      }
      return null;
    }
    if (!r.ok) return null;
    return await r.json().catch(() => null);
  } catch (e) {
    if (attempt < 2) {
      await new Promise((res) => setTimeout(res, 1200));
      return wikiJson(params, attempt + 1);
    }
    return null;
  }
}

// Прямой поиск статьи: точное название → "Name footballer" → "Name (footballer)"
async function resolvePhoto(name: string): Promise<string | null> {
  const titles = [name, `${name} footballer`, `${name} (footballer)`];
  for (const t of titles) {
    try {
      const d = await wikiJson({
        action: 'query', prop: 'pageimages|description', redirects: '1',
        pithumbsize: '300', titles: t,
      });
      const pages = d?.query?.pages ? Object.values(d.query.pages) : [];
      for (const p of pages as any[]) {
        if (p.missing !== undefined) continue;
        const desc = String(p.description || '').toLowerCase();
        const bad = /basketball|ice hockey|handball|volleyball|american|manager\)/.test(desc);
        if (p.thumbnail?.source && !bad) {
          return String(p.thumbnail.source).split('?')[0];
        }
      }
    } catch { /* следующий вариант */ }
  }
  // Полнотекстовый поиск как фолбэк
  try {
    const d = await wikiJson({
      action: 'query', list: 'search', srsearch: `"${name}" footballer`, srlimit: '1',
    });
    const hit = d?.query?.search?.[0];
    if (hit?.title) {
      const d2 = await wikiJson({
        action: 'query', prop: 'pageimages', pithumbsize: '300', titles: hit.title,
      });
      const pages = d2?.query?.pages ? Object.values(d2.query.pages) : [];
      for (const p of pages as any[]) {
        if (p.thumbnail?.source) return String(p.thumbnail.source).split('?')[0];
      }
    }
  } catch { /* ignore */ }
  return null;
}

async function runPool(items: any[], concurrency: number, fn: (it: any) => Promise<void>) {
  const queue = items.slice();
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const it = queue.shift();
      if (it) await fn(it);
    }
  });
  await Promise.all(workers);
}

Deno.serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    if (String(body.key) !== String(ADMIN_SECRET)) {
      return json({ ok: false, error: 'unauthorized' }, 403);
    }

    // Сброс каталога (первый батч)
    if (body.reset) {
      await db('user_cards', { method: 'delete', prefer: 'return=minimal' }).catch(() => null);
      await db('cards_catalog', { method: 'delete', prefer: 'return=minimal' }).catch(() => null);
    }

    // Отладочный проход одного имени
    if (body.debug && body.name) {
      const out: any = { tries: [] };
      const titles = [String(body.name), `${body.name} footballer`];
      for (const t of titles) {
        try {
          const qs = new URLSearchParams({ format: 'json', maxlag: '5', action: 'query', prop: 'pageimages|description', redirects: '1', pithumbsize: '300', titles: t });
          const r = await fetch(`${WIKI}?${qs}`, { signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'DevSportCards/1.0 (telegram football app)' } });
          const text = (await r.text()).slice(0, 300);
          out.tries.push({ t, status: r.status, body: text });
        } catch (e: any) { out.tries.push({ t, err: String(e?.message || e) }); }
      }
      return json(out);
    }

    const cards: any[] = Array.isArray(body.cards) ? body.cards.slice(0, 250) : [];
    const started = Date.now();
    let resolved = 0, failed = 0;

    // Режим дозаливки фото: пакетные запросы к Wikipedia (40 имён за раз)
    if (body.refill) {
      const limit = Math.min(Number(body.limit) || 500, 800);
      const rows = await db(`cards_catalog?image_url=is.null&select=id,name&order=id&limit=${limit}`) ?? [];
      const byTitle = new Map<string, number[]>();
      rows.forEach((r: any) => {
        const t = String(r.name).trim();
        if (!byTitle.has(t)) byTitle.set(t, []);
        byTitle.get(t)!.push(r.id);
      });
      let updated = 0, miss = 0;
      const names = Array.from(byTitle.keys());
      const BAD = /basketball|ice hockey|handball|volleyball|american football/;
      const BALL = /football|soccer|player|manager|winger|midfield|defender|forward|goalkeeper|strik|winger|fullback|centre-back|left-back|right-back/i;
      let diag: any = null;

      // Фаза 1: пакетно имя + вариант "(footballer)" — по 25 имён (50 тайтлов) на запрос
      const CHUNK = 25;
      const unresolved: string[] = [];
      for (let i = 0; i < names.length && Date.now() - started < 60000; i += CHUNK) {
        const chunk = names.slice(i, i + CHUNK);
        const variants: string[] = [];
        for (const n of chunk) variants.push(n, `${n} (footballer)`);
        const d = await wikiJson({
          action: 'query', prop: 'pageimages|description', redirects: '1',
          pithumbsize: '300', titles: variants.join('|'),
        });
        if (body.debug && !diag) {
          diag = {
            chunkSample: chunk.slice(0, 6),
            pages: d?.query?.pages ? (Object.values(d.query.pages) as any[]).slice(0, 5).map((p) => JSON.stringify(p).slice(0, 220)) : null,
          };
        }
        if (!d?.query?.pages) { unresolved.push(...chunk); continue; }
        const norm: Record<string, string> = {};
        for (const n2 of d.query.normalized || []) norm[n2.from] = n2.to;
        for (const r of d.query.redirects || []) norm[r.from] = r.to;
        const pageByTitle: Record<string, any> = {};
        for (const p of Object.values(d.query.pages) as any[]) pageByTitle[String(p.title)] = p;
        const walk = (t: string): any => {
          let seen = 0;
          while (norm[t] && seen++ < 5) t = norm[t];
          return pageByTitle[t];
        };
        for (const n of chunk) {
          let photo: string | null = null;
          // 1) вариант "X (footballer)" — принимаем, если нет явно чужого вида спорта
          const fb = walk(`${n} (footballer)`);
          if (fb && fb.missing === undefined && fb.thumbnail?.source && !BAD.test(String(fb.description || '').toLowerCase())) {
            photo = String(fb.thumbnail.source).split('?')[0];
          }
          // 2) само имя — только с футбольным описанием (защита от городов/однофамильцев)
          if (!photo) {
            const pl = walk(n);
            if (pl && pl.missing === undefined && pl.thumbnail?.source
              && !BAD.test(String(pl.description || '').toLowerCase())
              && BALL.test(String(pl.description || ''))) {
              photo = String(pl.thumbnail.source).split('?')[0];
            }
          }
          const ids = byTitle.get(n) || [];
          if (photo) {
            for (const id of ids) {
              await db(`cards_catalog?id=eq.${id}`, { method: 'patch', body: { image_url: photo }, prefer: 'return=minimal' });
              updated++;
            }
          } else {
            unresolved.push(n);
            miss += ids.length;
          }
        }
        await new Promise((res) => setTimeout(res, 1600));
      }

      // Фаза 2: поисковый фолбэк по одному для оставшихся (полное имя из поиска)
      let searched = 0;
      for (const n of unresolved) {
        if (Date.now() - started > 105000) break;
        const photo = await resolvePhoto(n);
        searched++;
        const ids = byTitle.get(n) || [];
        if (photo) {
          for (const id of ids) {
            await db(`cards_catalog?id=eq.${id}`, { method: 'patch', body: { image_url: photo }, prefer: 'return=minimal' });
            updated++;
          }
          miss = Math.max(0, miss - ids.length);
        }
        await new Promise((res) => setTimeout(res, 200));
      }
      return json({ ok: true, refill: true, taken: rows.length, updated, miss, searched, ms: Date.now() - started, diag });
    }

    await runPool(cards, 2, async (c: any) => {
      if (Date.now() - started > 115000) { failed++; return; }
      const photo = await resolvePhoto(String(c.name));
      if (photo) { c.image_url = photo; resolved++; } else { c.image_url = null; failed++; }
      await new Promise((res) => setTimeout(res, 120));
    });

    // Вставка батчами по 200
    const rows = cards.map((c: any) => ({
      name: c.name, position: c.position, club: c.club,
      country: c.country, country_code: c.country_code || null,
      ovr: c.ovr, rarity: c.rarity, image_url: c.image_url,
      pac: c.pac, sho: c.sho, pas: c.pas, dri: c.dri, def: c.def, phy: c.phy,
      is_gk: !!c.is_gk, is_active: true,
      card_kind: c.kind === 'coach' ? 'coach' : c.kind === 'legend' ? 'legend' : 'player',
    }));
    for (let i = 0; i < rows.length; i += 200) {
      await db('cards_catalog', { method: 'post', body: rows.slice(i, i + 200), prefer: 'return=minimal' });
    }

    return json({ ok: true, received: cards.length, resolved, failed, ms: Date.now() - started });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || 'error' }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}
