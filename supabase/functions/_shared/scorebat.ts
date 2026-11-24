// ============================================================
//  VIDEOBAT/SCOREBAT — реальные видеообзоры матчей
//  Бесплатный фид https://www.scorebat.com/video-api/v3/ (кэш 1ч)
// ============================================================

import { TEAM_TRANSLATIONS } from './translations.ts';

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
  'hotspurs': ['spurs'],
  'wanderers': ['wolves'],
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

export async function getScorebatFeed(): Promise<any[]> {
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

// Найти видеообзоры матча по русскому названию «Дома - В гостях».
// Возвращает [] если матча нет в фиде.
export async function findScorebatVideos(matchName: string): Promise<{ embed: string; title: string }[]> {
  const cleanMatch = String(matchName || '').trim();
  if (!cleanMatch) return [];
  const parts = cleanMatch.split(/\s+[-–—]\s+/);
  const homeRu = (parts[0] || '').trim();
  const awayRu = (parts[1] || '').trim();
  if (!homeRu || !awayRu) return [];

  const homeTokens = teamTokensRuToEn(homeRu);
  const awayTokens = teamTokensRuToEn(awayRu);
  if (!homeTokens.length || !awayTokens.length) return [];

  const feed = await getScorebatFeed();
  if (!feed.length) return [];

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
  if (!best) return [];

  return (Array.isArray(best.videos) ? best.videos : [])
    .map((v: any) => {
      const m = String(v.embed || '').match(/src='([^']+)'/);
      const src = m ? m[1] : '';
      if (src.indexOf('https://www.scorebat.com/embed/') !== 0) return null;
      return { embed: src, title: String(v.title || '').trim() };
    })
    .filter(Boolean) as { embed: string; title: string }[];
}
