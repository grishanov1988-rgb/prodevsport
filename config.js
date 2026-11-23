// ============================================================
//  КОНФИГУРАЦИЯ ФРОНТЕНДА (Telegram Mini App)
//  Файл публичный — НЕ храните здесь секреты!
// ============================================================

// URL Supabase Edge Function (заменил Google Apps Script)
const API_URL = "https://wtiiokkgemyozclnallj.supabase.co/functions/v1/miniapp";

// Username вашего бота без @ — для ссылок-приглашений в приватные лиги
const BOT_USERNAME = "devsport_bot";

// Экспорт для внутреннего использования (не переопределяет существующие)
window.API_URL = window.API_URL || API_URL;
window.BOT_USERNAME = window.BOT_USERNAME || BOT_USERNAME;
