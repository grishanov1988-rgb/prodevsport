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
      const titles = Array.from(byTitle.keys());
      const CHUNK = 40;
      for (let i = 0; i < titles.length && Date.now() - started < 110000; i += CHUNK) {
        const chunk = titles.slice(i, i + CHUNK);
        const d = await wikiJson({
          action: 'query', prop: 'pageimages|description', redirects: '1',
          pithumbsize: '300', titles: chunk.join('|'),
        });
        const norm: Record<string, string> = {};
        for (const n of d?.query?.normalized || []) norm[n.from] = n.to;
        for (const r of d?.query?.redirects || []) norm[r.from] = r.to;
        const pages = d?.query?.pages ? Object.values(d.query.pages) : [];
        const found = new Map<string, string>();
        for (const p of pages as any[]) {
          if (p.missing !== undefined || !p.title) continue;
          const desc = String(p.description || '').toLowerCase();
          const bad = /basketball|ice hockey|handball|volleyball|american football/.test(desc);
          if (p.thumbnail?.source && !bad) found.set(String(p.title), String(p.thumbnail.source).split('?')[0]);
        }
        for (const t of chunk) {
          const target = norm[t] || t;
          const photo = found.get(target) || null;
          const ids = byTitle.get(t) || [];
          for (const id of ids) {
            if (photo) {
              await db(`cards_catalog?id=eq.${id}`, { method: 'patch', body: { image_url: photo }, prefer: 'return=minimal' });
              updated++;
            } else miss++;
          }
        }
        await new Promise((res) => setTimeout(res, 1600));
      }
      return json({ ok: true, refill: true, taken: rows.length, updated, miss, ms: Date.now() - started });
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
