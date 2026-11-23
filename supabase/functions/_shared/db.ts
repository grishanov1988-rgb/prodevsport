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

/** upsert по конфликт-ключам (resolution=merge-duplicates) */
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
