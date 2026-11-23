// ============================================================
//  УТИЛИТЫ — порт из Code.gs
// ============================================================

export function escapeMd(text: string): string {
  if (!text) return '';
  return String(text)
    .replace(/\\/g, '\\\\').replace(/_/g, '\\_')
    .replace(/\*/g, '\\*').replace(/`/g, '\\`').replace(/\[/g, '\\[');
}

export function normalizeMatchName(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/ /g, ' ')
    .replace(/ё/g, 'е')
    .replace(/\s*[-–—]\s*/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeTeamName(s: string): string {
  return normalizeMatchName(s).replace(/-/g, ' ');
}

export function splitMatchTeams_(matchName: string): { home: string; away: string } {
  const parts = String(matchName || '').split(/\s*[-–—]\s*/);
  return { home: (parts[0] || '').trim(), away: (parts[1] || '').trim() };
}

export interface PointsResult {
  points: number; correctOutcome: boolean; correctDiff: boolean; exactScore: boolean;
}

/** Правила: точный счёт +5, разница +3, исход +1 (порт calcPointsForPrediction_) */
export function calcPointsForPrediction(outcome: string, predScore: string, realScore: string): PointsResult {
  const res: PointsResult = { points: 0, correctOutcome: false, correctDiff: false, exactScore: false };
  const pm = String(predScore || '').match(/^(\d+)\s*-\s*(\d+)$/);
  const rm = String(realScore || '').match(/^(\d+)\s*-\s*(\d+)$/);
  if (!rm) return res;
  const rh = Number(rm[1]), ra = Number(rm[2]);
  const realOutcome = rh > ra ? 'П1' : rh < ra ? 'П2' : 'Ничья';
  if (pm) {
    const ph = Number(pm[1]), pa = Number(pm[2]);
    const predOutcome = ph > pa ? 'П1' : ph < pa ? 'П2' : 'Ничья';
    if (ph === rh && pa === ra) { res.exactScore = true; res.correctDiff = true; res.correctOutcome = true; res.points = 5; return res; }
    if (ph - pa === rh - ra) { res.correctDiff = true; res.correctOutcome = true; res.points = 3; return res; }
    if (predOutcome === realOutcome) { res.correctOutcome = true; res.points = 1; return res; }
    return res;
  }
  if (outcome === realOutcome) { res.correctOutcome = true; res.points = 1; }
  return res;
}

const pad2 = (n: number) => (n < 10 ? '0' : '') + n;

/** Форматирование даты в Europe/Moscow (аналог Utilities.formatDate) */
export function formatDateMsk(iso: string | null | undefined, pattern: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  if (pattern === 'dd.MM HH:mm') return `${get('day')}.${get('month')} ${get('hour')}:${get('minute')}`;
  return `${get('day')}.${get('month')}.${get('year')} ${get('hour')}:${get('minute')}`;
}

/** Период-ключ заданий: daily/weekly/monthly (порт getPeriodKey_) */
export function getPeriodKey(periodType: string): string {
  const now = new Date();
  const msk = new Date(now.getTime() + (now.getTimezoneOffset() + 180) * 60000); // UTC+3
  const y = msk.getFullYear();
  const m = pad2(msk.getMonth() + 1);
  const d = pad2(msk.getDate());
  if (periodType === 'daily') return `${y}-${m}-${d}`;
  if (periodType === 'weekly') {
    // ISO-неделя
    const date = new Date(Date.UTC(msk.getFullYear(), msk.getMonth(), msk.getDate()));
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return `${date.getUTCFullYear()}-W${pad2(week)}`;
  }
  if (periodType === 'monthly') return `${y}-${m}`;
  return `${y}-${m}-${d}`;
}

export function enc(s: string): string {
  return encodeURIComponent(s);
}
