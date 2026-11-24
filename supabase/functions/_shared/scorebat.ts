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

// Сборные: русское название → английское (для матчей Лиги наций / Евро / ЧМ).
// Названия в матчName — сокращённые («Босния», «Сев.Ирландия»), поэтому много синонимов.
const NATIONAL_RU_EN: Record<string, string> = {
  'россия': 'Russia', 'германия': 'Germany', 'франция': 'France', 'италия': 'Italy',
  'испания': 'Spain', 'англия': 'England', 'португалия': 'Portugal', 'нидерланды': 'Netherlands',
  'голландия': 'Netherlands', 'бельгия': 'Belgium', 'австрия': 'Austria', 'швейцария': 'Switzerland',
  'хорватия': 'Croatia', 'дания': 'Denmark', 'швеция': 'Sweden', 'норвегия': 'Norway',
  'финляндия': 'Finland', 'польша': 'Poland', 'чехия': 'Czech Republic', 'чехия республика': 'Czech Republic',
  'словакия': 'Slovakia', 'словения': 'Slovenia', 'венгрия': 'Hungary', 'румыния': 'Romania',
  'болгария': 'Bulgaria', 'сербия': 'Serbia', 'черногория': 'Montenegro', 'албания': 'Albania',
  'греция': 'Greece', 'турецкая республика': 'Turkiye', 'турция': 'Turkiye', 'украина': 'Ukraine',
  'беларусь': 'Belarus', 'молдова': 'Moldova', 'литва': 'Lithuania', 'латвия': 'Latvia',
  'эстония': 'Estonia', 'казахстан': 'Kazakhstan', 'грузия': 'Georgia', 'армения': 'Armenia',
  'азербайджан': 'Azerbaijan', 'израиль': 'Israel', 'шотландия': 'Scotland',
  'сев.ирландия': 'Northern Ireland', 'северная ирландия': 'Northern Ireland',
  'уэльс': 'Wales', 'ирландия': 'Ireland', 'косово': 'Kosovo',
  'босния': 'Bosnia', 'сев. македония': 'Macedonia', 'македония': 'Macedonia',
  'фарерские': 'Faroe', 'фареры': 'Faroe', 'фарерские острова': 'Faroe Islands',
  'гибралтар': 'Gibraltar', 'люксембург': 'Luxembourg', 'мальта': 'Malta', 'кипр': 'Cyprus',
  'андорра': 'Andorra', 'лихтенштейн': 'Liechtenstein', 'сан-марино': 'San Marino',
  'великобритания': 'England',
  'сша': 'USA', 'мексика': 'Mexico', 'бразилия': 'Brazil', 'аргентина': 'Argentina',
  'канада': 'Canada', 'япония': 'Japan', 'корея республика': 'South Korea', 'корея южная': 'South Korea',
  'саудовская аравия': 'Saudi Arabia', 'австралия': 'Australia', 'египет': 'Egypt',
  'марокко': 'Morocco', 'тунис': 'Tunisia', 'нигерия': 'Nigeria', 'сент-китс': 'St Kitts',
};

// Приблизительная транслитерация русских названий (фолбэк, когда нет в картах)
const CYR_TO_LAT: Record<string, string> = {
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e', 'ж': 'zh', 'з': 'z',
  'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r',
  'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'c', 'ч': 'ch', 'ш': 'sh', 'щ': 'sch',
  'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya', 'і': 'i', 'є': 'e', 'ї': 'yi', 'ґ': 'g',
};

function translitRu(s: string): string {
  return foldDiacritics(String(s || '')).toLowerCase().split('').map((ch) => {
    const lat = CYR_TO_LAT[ch];
    if (lat !== undefined) return lat;
    if (/[a-z0-9]/.test(ch)) return ch;
    return ' ';
  }).join('').replace(/\s+/g, ' ').trim();
}

// Одинаковая «прессованная» форма для containment-проверки (транслитерирует кириллицу)
function squashNorm(s: string): string {
  return translitRu(s).replace(/[^a-z0-9]/g, '');
}

// Покрытие биграмм имени в строке (0..1): какая доля биграмм названия команды
// встречается в заголовке. Ловит «Леверкузен»↔«Leverkusen», «Атлетико»↔«Atletico».
function bigramCoverage(name: string, hay: string): number {
  if (name.length < 2 || hay.length < 2) return 0;
  if (hay.indexOf(name) !== -1) return 1;
  let total = 0, hit = 0;
  for (let i = 0; i < name.length - 1; i++) {
    total++;
    if (hay.indexOf(name.slice(i, i + 2)) !== -1) hit++;
  }
  return total ? hit / total : 0;
}

// Клубы, где транслитерация расходится с латинским написанием (умляуты и т.п.)
const CLUB_RU_EN: Record<string, string> = {
  'кельн': 'Koln', 'мёнхенгладбах': 'Monchengladbach', 'moenchengladbach': 'Monchengladbach',
  'шальке': 'Schalke', 'нюрнберг': 'Nurnberg', 'кайзерслаутерн': 'Kaiserslautern',
};

// Все английские варианты названия команды: карта клубов + карта сборных + транслит
function enNameVariants(ruName: string): string[] {
  const out: string[] = [];
  const key = foldDiacritics(ruName).toLowerCase().trim();
  const nat = NATIONAL_RU_EN[key];
  if (nat) out.push(nat);
  const club = CLUB_RU_EN[key];
  if (club) out.push(club);
  out.push(translitRu(ruName));
  return out;
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

  const homeVariants = enNameVariants(homeRu);
  const awayVariants = enNameVariants(awayRu);
  const homeTokens = teamTokensRuToEn(homeRu);
  const awayTokens = teamTokensRuToEn(awayRu);
  if (!homeTokens.length && !homeVariants.length) return [];
  if (!awayTokens.length && !awayVariants.length) return [];

  const feed = await getScorebatFeed();
  if (!feed.length) return [];

  const homeNatSquash = homeVariants.map(squashNorm).filter((s) => s.length >= 4);
  const awayNatSquash = awayVariants.map(squashNorm).filter((s) => s.length >= 4);

  let best: any = null;
  let bestScore = 0;
  // Сила совпадения одной команды: 3 = containment, 2 = нечёткое, 1 = токены, 0 = нет
  const teamHit = (tokens: string[], variants: string[], titleSet: Set<string>, tq: string): number => {
    if (variants.some((s) => s.length >= 4 && tq.indexOf(s) !== -1)) return 3;
    if (variants.some((s) => s.length >= 4 && bigramCoverage(s, tq) >= 0.55)) return 2;
    if (tokens.length && countTokenMatches(tokens, titleSet) > 0) return 1;
    return 0;
  };
  for (const item of feed) {
    const titleRaw = String(item.title || '').split('|')[0];
    const titleSet = new Set(tokenize(titleRaw));
    if (!titleSet.size) continue;
    const tq = squashNorm(titleRaw);

    const H = teamHit(homeTokens, homeNatSquash, titleSet, tq);
    const A = teamHit(awayTokens, awayNatSquash, titleSet, tq);
    if (H === 0 || A === 0) continue;
    const score = H + A;
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
