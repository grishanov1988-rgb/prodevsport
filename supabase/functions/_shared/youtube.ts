// ============================================================
//  YOUTUBE — поиск видеообзоров матчей
//  Источники (без API-ключа): Piped API → Invidious API →
//  скрейпинг HTML-страницы поиска YouTube (последний фолбэк).
//  Результат кэшируется в памяти 6 часов.
// ============================================================

const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://api.piped.private.coffee',
  'https://pipedapi.adminforge.de',
  'https://pipedapi.reallyaweso.me',
];

const INVIDIOUS_INSTANCES = [
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://yewtu.be',
  'https://invidious.f5.si',
];

const CACHE_TTL = 6 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; videos: { videoId: string; title: string }[] }>();

function parseDurationSec(v: unknown): number {
  if (typeof v === 'number' && isFinite(v)) return v; // piped: секунды
  const m = String(v || '').match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/); // "MM:SS" или "HH:MM:SS"
  if (!m) return -1;
  if (m[3] !== undefined) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  return Number(m[1]) * 60 + Number(m[2]);
}

function pickBest(items: { videoId: string; title: string; durSec: number; views?: number }[], limit = 3) {
  const kw = /обзор|голы|highlights|review|матч/i;
  const usable = items.filter((it) => it.videoId && (it.durSec < 0 || (it.durSec >= 45 && it.durSec <= 30 * 60)));
  const withKw = usable.filter((it) => kw.test(it.title));
  const pool = (withKw.length ? withKw : usable).slice(0, limit);
  return pool.map(({ videoId, title }) => ({ videoId, title }));
}

async function searchPiped(query: string) {
  for (const base of PIPED_INSTANCES) {
    try {
      const r = await fetch(`${base}/search?q=${encodeURIComponent(query)}&filter=videos`, {
        signal: AbortSignal.timeout(9000),
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
      });
      if (!r.ok) continue;
      const data = await r.json();
      const items = (Array.isArray(data.items) ? data.items : [])
        .filter((it: any) => it && it.type === 'stream' && typeof it.url === 'string')
        .map((it: any) => {
          const m = it.url.match(/[?&]v=([\w-]{6,})/);
          return {
            videoId: m ? m[1] : '',
            title: String(it.title || '').trim(),
            durSec: parseDurationSec(it.duration),
            views: Number(it.views) || 0,
          };
        })
        .filter((it: any) => it.videoId);
      if (items.length) return items;
    } catch { /* пробуем следующий инстанс */ }
  }
  return [];
}

async function searchInvidious(query: string) {
  for (const base of INVIDIOUS_INSTANCES) {
    try {
      const r = await fetch(`${base}/api/v1/search?q=${encodeURIComponent(query)}&type=video`, {
        signal: AbortSignal.timeout(9000),
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
      });
      if (!r.ok) continue;
      const data = await r.json();
      const items = (Array.isArray(data) ? data : [])
        .filter((it: any) => it && it.type === 'video' && typeof it.videoId === 'string')
        .map((it: any) => ({
          videoId: it.videoId,
          title: String(it.title || '').trim(),
          durSec: Number(it.lengthSeconds) || -1,
          views: Number(it.viewCount) || 0,
        }))
        .filter((it: any) => it.videoId);
      if (items.length) return items;
    } catch { /* пробуем следующий инстанс */ }
  }
  return [];
}

async function searchYoutubeScrape(query: string) {
  try {
    const r = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, {
      signal: AbortSignal.timeout(10000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
      },
    });
    if (!r.ok) return [];
    const html = await r.text();
    const seen = new Set<string>();
    const out: { videoId: string; title: string; durSec: number }[] = [];
    const re = /"videoId":"([\w-]{6,})"(?:(?!.{0,400}?"videoId":).)*?"title":\{"runs":\[\{"text":"([^"]+)"/gs;
    let m;
    while ((m = re.exec(html)) && out.length < 15) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      out.push({ videoId: m[1], title: m[2].replace(/\\u0026/g, '&'), durSec: -1 });
    }
    return out;
  } catch { return []; }
}

// Поиск обзоров матча по русскому названию «Дома - В гостях».
// Возвращает до 3 роликов { videoId, title }.
export async function searchYouTubeMatchVideos(matchName: string): Promise<{ videoId: string; title: string }[]> {
  const clean = String(matchName || '').trim();
  if (!clean) return [];

  const cached = cache.get(clean);
  if (cached && Date.now() - cached.at < CACHE_TTL) return cached.videos;

  const teams = clean.split(/\s+[-–—]\s+/).map((s) => s.trim()).filter(Boolean).join(' ');
  const base = teams || clean;
  const queries = [`${base} обзор матча`, `${base} голы`];

  let items: { videoId: string; title: string; durSec: number; views?: number }[] = [];
  for (const q of queries) {
    items = await searchPiped(q);
    if (!items.length) items = await searchInvidious(q);
    if (!items.length) items = await searchYoutubeScrape(q);
    if (items.length) break;
  }

  const videos = pickBest(items);
  cache.set(clean, { at: Date.now(), videos });
  return videos;
}
