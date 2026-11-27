// ============================================================
//  POSTGRES (Supabase) — единая точка входа
//  Тонкий порт supabaseRequest_ из Code.gs: те же строки-запросы,
//  те же заголовки Prefer/on_conflict — поведение 1:1.
// ============================================================

import { SUPABASE_URL, SUPABASE_SERVICE_KEY } from './config.ts';

export interface DbOptions {
  method?: 'get' | 'post' | 'patch' | 'delete';
  body?: unknown;
  prefer?: string; // например 'return=minimal,resolution=merge-duplicates'
  noCache?: boolean;
}

export async function db(endpoint: string, options: DbOptions = {}): Promise<any> {
  const method = options.method ?? 'get';
  const url = `${SUPABASE_URL}/rest/v1/${endpoint}`;
  const headers: Record<string, string> = {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Accept-Profile': 'public',
    'Content-Profile': 'public',
  };
  if (method === 'post' || method === 'patch') headers['Content-Type'] = 'application/json';
  if (options.prefer) headers['Prefer'] = options.prefer;

  const res = await fetch(url, {
    method: method.toUpperCase(),
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase ${method.toUpperCase()} ${endpoint} → ${res.status}: ${text.slice(0, 300)}`);
  }

  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const data = await res.json();
    // PostgREST без Prefer возвращает массив; с return=minimal — пустое тело
    return data === null ? [] : data;
  }
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

/** Точное число строк: HEAD + Prefer: count=exact → content-range: 0-0/N */
export async function dbCount(endpoint: string): Promise<number> {
  const url = `${SUPABASE_URL}/rest/v1/${endpoint}`;
  const res = await fetch(url, {
    method: 'HEAD',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Accept-Profile': 'public',
      Prefer: 'count=exact',
    },
  });
  if (!res.ok) throw new Error(`Supabase HEAD ${endpoint} → ${res.status}`);
  const range = res.headers.get('content-range') ?? '';
  const total = range.split('/')[1];
  return Number(total) || 0;
}

/** Все строки: пагинация Range-заголовками по chunk (обходит max-rows PostgREST) */
export async function dbAll(endpoint: string, chunk = 1000): Promise<any[]> {
  const sep = endpoint.includes('?') ? '&' : '?';
  const base = endpoint.includes('select=')
    ? `${SUPABASE_URL}/rest/v1/${endpoint}`
    : `${SUPABASE_URL}/rest/v1/${endpoint}${sep}select=*`;
  const out: any[] = [];
  let from = 0;
  for (;;) {
    const res = await fetch(base, {
      method: 'GET',
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Accept-Profile': 'public',
        Range: `${from}-${from + chunk - 1}`,
      },
    });
    if (!res.ok) throw new Error(`Supabase GET ${endpoint} range ${from} → ${res.status}`);
    const rows: any[] = await res.json();
    out.push(...rows);
    const contentRange = res.headers.get('content-range') ?? '';
    const total = Number(contentRange.split('/')[1]) || 0;
    from += chunk;
    if (rows.length < chunk || from >= total) break;
  }
  return out;
}
export async function upsert(table: string, rows: unknown[], onConflict?: string): Promise<void> {
  let ep = `${table}?on_conflict=${onConflict ?? 'user_name'}`;
  await db(ep, {
    method: 'post',
    body: rows,
    prefer: 'return=minimal,resolution=merge-duplicates',
  });
}

/** upsert с ignore-duplicates (не перезаписывать существующие) */
export async function upsertIgnore(table: string, rows: unknown[], onConflict?: string): Promise<void> {
  let ep = `${table}?on_conflict=${onConflict ?? 'user_name'}`;
  await db(ep, {
    method: 'post',
    body: rows,
    prefer: 'return=minimal,resolution=ignore-duplicates',
  });
}
