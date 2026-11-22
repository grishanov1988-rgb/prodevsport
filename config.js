// ============================================================
//  КОНФИГУРАЦИЯ ФРОНТЕНДА (Telegram Mini App)
//  Файл публичный — НЕ храните здесь секреты!
// ============================================================

// URL деплоя Google Apps Script (заканчивается на /exec).
// Берётся после «Развернуть → Управление развёртываниями» в GAS.
const API_URL = "https://script.google.com/macros/s/ВАШ_DEPLOYMENT_ID/exec";

// Username вашего бота без @ — для ссылок-приглашений в приватные лиги
const BOT_USERNAME = "devsport_bot";

// Экспорт для внутреннего использования (не переопределяет существующие)
window.API_URL = window.API_URL || API_URL;
window.BOT_USERNAME = window.BOT_USERNAME || BOT_USERNAME;
