// ============================================================
//  КОНФИГ — читается из env (Supabase Dashboard → Edge Functions → Secrets)
//  Имена совпадают со Script Properties из GAS-версии
// ============================================================

export const BOT_TOKEN = Deno.env.get('BOT_TOKEN') ?? '';
export const BOT_USERNAME = (Deno.env.get('BOT_USERNAME') ?? 'devsport_bot').replace(/^@/, '');
export const ADMIN_SECRET = Deno.env.get('ADMIN_SECRET') ?? '';
export const ADMIN_CHAT_ID = Deno.env.get('ADMIN_CHAT_ID') ?? '';
export const FOOTBALL_API_KEY = Deno.env.get('FOOTBALL_API_KEY') ?? '';
export const GIPHY_API_KEY = Deno.env.get('GIPHY_API_KEY') ?? '';
export const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
export const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
// Публичный URL Mini App (кнопка в Telegram). После переноса админки:
export const MINIAPP_URL = Deno.env.get('MINIAPP_URL') ?? '';
// URL админки (GitHub Pages)
export const ADMIN_URL = Deno.env.get('ADMIN_URL') ?? '';

export const LEAGUES: Record<string, {
  code: string; name: string; emoji: string; flagClass: string;
  competition: string | null;
}> = {
  PL:  { code: 'PL',  name: 'Английская Премьер-лига',    emoji: '🏴', flagClass: 'flag-eng', competition: 'PL'  },
  CL:  { code: 'CL',  name: 'Лига Чемпионов',             emoji: '🏆', flagClass: '',         competition: 'CL'  },
  PD:  { code: 'PD',  name: 'Ла Лига',                    emoji: '🇪🇸', flagClass: 'flag-es',  competition: 'PD'  },
  SA:  { code: 'SA',  name: 'Серия А',                    emoji: '🇮🇹', flagClass: 'flag-it',  competition: 'SA'  },
  FL1: { code: 'FL1', name: 'Лига 1 (Франция)',           emoji: '🇫🇷', flagClass: 'flag-fr',  competition: 'FL1' },
  ELC: { code: 'ELC', name: 'Чемпионшип (Англия)',        emoji: '🏴', flagClass: 'flag-eng', competition: 'ELC' },
  PPL: { code: 'PPL', name: 'Примейра-лига (Португалия)', emoji: '🇵🇹', flagClass: 'flag-pt',  competition: 'PPL' },
  UNL: { code: 'UNL', name: 'Лига наций',                 emoji: '🌍', flagClass: '',         competition: null  },
};

export const XP_ACHIEVEMENTS: Record<string, { code: string; name: string }> = {
  level_5:       { code: 'level_5',       name: '🎓 Знаток (5 ур.)' },
  level_10:      { code: 'level_10',      name: '🧠 Эксперт (10 ур.)' },
  streak_3:      { code: 'streak_3',      name: '🔥 3 дня подряд' },
  streak_7:      { code: 'streak_7',      name: '🔥 Неделя без пропусков' },
  streak_30:     { code: 'streak_30',     name: '💎 Месяц подряд' },
  exact_10:      { code: 'exact_10',      name: '🎪 10 точных счётов' },
  exact_50:      { code: 'exact_50',      name: '🏹 Снайпер (50 точных)' },
  predictions_100: { code: 'predictions_100', name: '💯 100 прогнозов' },
};

export const PREDICTION_LOCK_BEFORE_MS = 5 * 60 * 1000;
export const RATE_LIMIT_PRED_PER_MIN = 10;

export function requireEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Env ${name} is not set`);
  return v;
}
