// ============================================================
//  БОТ ПРОГНОЗОВ — ПОЛНАЯ РАБОЧАЯ ВЕРСИЯ
// ============================================================

// ============================================================
//  КОНФИГУРАЦИЯ — ВСЕ СЕКРЕТЫ В SCRIPT PROPERTIES (см. README.md)
//  GAS: Проект → Настройки → Свойства скрипта → Свойства скрипта
//  BOT_TOKEN, SHEET_ID, ADMIN_SECRET, ADMIN_CHAT_ID,
//  FOOTBALL_API_KEY, SUPABASE_URL, SUPABASE_KEY,
//  WEBAPP_EXEC_URL (URL деплоя /exec), MINIAPP_URL (URL фронта),
//  GIPHY_API_KEY, BOT_USERNAME
// ============================================================
function prop_(key, fallback) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  return (v && String(v).trim()) ? String(v).trim() : (fallback || "");
}

const TOKEN          = prop_('BOT_TOKEN');
const SHEET_ID       = prop_('SHEET_ID');
const ADMIN_SECRET   = prop_('ADMIN_SECRET');
const ADMIN_CHAT_ID  = Number(prop_('ADMIN_CHAT_ID') || 0);
const ADMIN_CHAT_ID_STR = String(ADMIN_CHAT_ID);
const FOOTBALL_API_KEY = prop_('FOOTBALL_API_KEY');
const WEBAPP_URL_HARDCODED = prop_('WEBAPP_EXEC_URL'); // URL деплоя GAS /exec (вебхук)
const MINIAPP_URL    = prop_('MINIAPP_URL');           // URL фронта на GitHub Pages

if (!TOKEN)         Logger.log('\u26a0\ufe0f Задайте BOT_TOKEN в Script Properties!');
if (!SHEET_ID)      Logger.log('\u26a0\ufe0f Задайте SHEET_ID в Script Properties!');
if (!ADMIN_SECRET)  Logger.log('\u26a0\ufe0f Задайте ADMIN_SECRET в Script Properties!');
if (!ADMIN_CHAT_ID) Logger.log('\u26a0\ufe0f Задайте ADMIN_CHAT_ID в Script Properties!');

const HTML_FILE_NAME = "Index";
// \u26a0 НЕ «Рейтинг» — иначе снимок истории перезапишет боевой лист рейтинга
const RATING_HISTORY_SHEET = "Рейтинг_История";
const ADMIN_HTML_FILE_NAME = "Admin";
const ADMIN_USERNAME = "";
const BOT_USERNAME = "@" + prop_('BOT_USERNAME', 'devsport_bot').replace(/^@/, '');

// ============================================================
//  FOOTBALL-DATA.ORG API
// ============================================================
const FOOTBALL_API_BASE = "https://api.football-data.org/v4";

const FD_COMPETITIONS = {
  "PL":  "PL", "CL":  "CL", "PD":  "PD", "SA":  "SA",
  "FL1": "FL1", "ELC": "ELC", "PPL": "PPL", "UNL": null
};
const FD_SEASON = 2026;



const LEAGUES = {
  "PL":  { code:"PL",  name:"Английская Премьер-лига",  emoji:"🏴", flagClass:"flag-eng", sheetName:"Матчи",     competition:"PL"  },
  "CL":  { code:"CL",  name:"Лига Чемпионов",           emoji:"🏆", flagClass:"",         sheetName:"Матчи_CL",  competition:"CL"  },
  "PD":  { code:"PD",  name:"Ла Лига",                  emoji:"🇪🇸", flagClass:"flag-es",  sheetName:"Матчи_PD",  competition:"PD"  },
  "SA":  { code:"SA",  name:"Серия А",                  emoji:"🇮🇹", flagClass:"flag-it",  sheetName:"Матчи_SA",  competition:"SA"  },
  "FL1": { code:"FL1", name:"Лига 1 (Франция)",         emoji:"🇫🇷", flagClass:"flag-fr",  sheetName:"Матчи_FL1", competition:"FL1" },
  "ELC": { code:"ELC", name:"Чемпионшип (Англия)",      emoji:"🏴", flagClass:"flag-eng", sheetName:"Матчи_ELC", competition:"ELC" },
  "PPL": { code:"PPL", name:"Примейра-лига (Португалия)", emoji:"🇵🇹", flagClass:"flag-pt", sheetName:"Матчи_PPL", competition:"PPL" },
  "UNL": { code:"UNL", name:"Лига наций",               emoji:"🌍", flagClass:"",         sheetName:"Матчи_UNL", competition:"UNL" }
};

const ACHIEVEMENTS = {
  first_prediction: { code:"first_prediction", name:"Первый шаг" },
  hundred_points:   { code:"hundred_points",   name:"Сотка" },
  top3:             { code:"top3",             name:"В тройке" }
};

const PREDICTION_LOCK_BEFORE_MS = 5 * 60 * 1000;
const RATE_LIMIT_PRED_PER_MIN = 10;

// ============================================================
//  КЭШ-ХЕЛПЕРЫ
// ============================================================
function getCacheVersion_(table) {
  var cache = CacheService.getScriptCache();
  var key = 'cv_' + (table || 'global');
  var v = cache.get(key);
  if (!v) {
    v = String(Date.now());
    try { cache.put(key, v, 3600); } catch (e) {}
  }
  return v;
}

function bumpCacheVersion_(table) {
  try {
    var cache = CacheService.getScriptCache();
    var key = 'cv_' + (table || 'global');
    cache.put(key, String(Date.now()), 3600);
  } catch (e) {}
}

function bumpTablesCache_(tables) {
  (tables || []).forEach(function(t){ bumpCacheVersion_(t); });
}

function hashString_(s) {
  var h = 0;
  s = String(s || '');
  for (var i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}

// ============================================================
//  SUPABASE — ЕДИНАЯ ТОЧКА ВХОДА С КЭШЕМ
// ============================================================
var CACHE_DEPENDENCIES = {
  'predictions':     ['predictions', 'xp_profiles', 'tasks_progress', 'achievements', 'xp_logs', 'user_points'],
  'matches':         ['matches', 'user_points', 'private_leagues'],
  'users':           ['users'],
  'achievements':    ['achievements'],
  'subscriptions':   ['subscriptions'],
  'xp_profiles':     ['xp_profiles'],
  'tasks_progress':  ['tasks_progress'],
  'xp_logs':         ['xp_logs'],
  'user_points':     ['user_points'],
  'task_templates':  ['task_templates'],
  'private_leagues':         ['private_leagues', 'private_league_members'],
  'private_league_members':  ['private_league_members', 'private_leagues'],
  'notify_log':      []
};

function supabaseRequest_(endpoint, options) {
  options = options || {};

  var baseUrl = PropertiesService.getScriptProperties().getProperty('SUPABASE_URL');
  var key = PropertiesService.getScriptProperties().getProperty('SUPABASE_KEY');
  if (!baseUrl || !key) {
    throw new Error('SUPABASE_URL или SUPABASE_KEY не заданы в Script Properties');
  }

  baseUrl = String(baseUrl).replace(/\/+$/, '');
  var url = baseUrl + '/rest/v1/' + endpoint;
  var method = (options.method || 'get').toLowerCase();

  var table = String(endpoint).split('?')[0].split('/')[0];
  var CACHE_TTL = {
    'task_templates': 300, 'users': 60, 'achievements': 60, 'subscriptions': 60,
    'predictions': 15, 'matches': 20, 'xp_profiles': 20, 'tasks_progress': 15,
    'xp_logs': 30, 'user_points': 30
  };
  var ttl = CACHE_TTL[table] !== undefined ? CACHE_TTL[table] : 30;

  var cache = null;
  var cacheKey = null;
  if (method === 'get' && !options.noCache && ttl > 0) {
    cache = CacheService.getScriptCache();
    cacheKey = 'sb_' + table + '_' + getCacheVersion_(table) + '_' + hashString_(url);
    var cached = cache.get(cacheKey);
    if (cached) {
      try { return JSON.parse(cached); } catch (e) {}
    }
  }

  var headers = {
    'apikey': key,
    'Authorization': 'Bearer ' + key,
    'Content-Type': 'application/json'
  };
  if (options.prefer) headers['Prefer'] = options.prefer;

  var params = {
    method: method,
    headers: headers,
    muteHttpExceptions: true
  };
  if (options.body !== undefined) {
    params.payload = JSON.stringify(options.body);
  }

  var resp = UrlFetchApp.fetch(url, params);
  var code = resp.getResponseCode();
  var text = resp.getContentText();

  if (code === 409 && options.prefer && options.prefer.indexOf('ignore-duplicates') !== -1) {
    return null;
  }

  if (code >= 400) {
    Logger.log('Supabase error [' + code + '] ' + endpoint + ': ' + text.substring(0, 500));
    var err = new Error('Supabase ' + code + ': ' + text.substring(0, 300));
    err.status = code;
    err.body = text;
    throw err;
  }

  if (method !== 'get') {
    var deps = CACHE_DEPENDENCIES[table] || [table];
    bumpTablesCache_(deps);
    return (code === 204 || !text)
      ? null
      : (function(){ try { return JSON.parse(text); } catch (e) { return null; } })();
  }

  if (code === 204 || !text) return null;

  var result;
  try { result = JSON.parse(text); } catch (e) { return null; }

  if (cache && cacheKey && result !== null && ttl > 0) {
    try {
      var s = JSON.stringify(result);
      if (s.length < 95000) cache.put(cacheKey, s, ttl);
    } catch (e) {}
  }

  return result;
}

// ============================================================
//  TELEGRAM API
// ============================================================
function sendText(chatId, text, keyboard) {
  if (!chatId) return { ok: false, error: "no chatId" };

  const url = "https://api.telegram.org/bot" + TOKEN + "/sendMessage";
  const payload = { chat_id: String(chatId).trim(), text: text, parse_mode: "Markdown" };
  if (keyboard) payload.reply_markup = keyboard;

  try {
    const resp = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    const status = resp.getResponseCode();
    const body   = resp.getContentText();

    if (status !== 200) {
      Logger.log("❌ sendText FAILED [" + status + "] chatId=" + chatId);
      Logger.log("   TEXT: " + text.substring(0, 200));
      Logger.log("   RESPONSE: " + body);

      if (status === 400 && body.indexOf("can't parse entities") !== -1) {
        var plain = String(text).replace(/[_*`\[\]]/g, '');
        var p2 = { chat_id: String(chatId).trim(), text: plain };
        if (keyboard) p2.reply_markup = keyboard;
        var r2 = UrlFetchApp.fetch(url, {
          method: "post",
          contentType: "application/json",
          payload: JSON.stringify(p2),
          muteHttpExceptions: true
        });
        if (r2.getResponseCode() === 200) return { ok: true, status: 200, fallback: true };
      }

      return { ok: false, status: status, body: body };
    }
    return { ok: true, status: 200 };

  } catch (e) {
    Logger.log("❌ sendText EXCEPTION: " + e);
    return { ok: false, error: String(e) };
  }
}

function sendWebAppMenu(chatId, userName) {
  // Фронт на GitHub Pages (MINIAPP_URL) — иначе fallback на деплой GAS
  const isMini = MINIAPP_URL && MINIAPP_URL.indexOf('https') === 0;
  const webAppUrl = isMini ? MINIAPP_URL : getWebAppUrl();
  if (!webAppUrl) { sendText(chatId, "URL веб-приложения не настроен."); return; }

  const safeName = encodeURIComponent(userName || "Участник");
  const userWebAppUrl = isMini
    ? webAppUrl
    : webAppUrl + "?chatId=" + chatId + "&userName=" + safeName + "&v=" + Date.now();
  
  Logger.log("URL кнопки: " + userWebAppUrl);

  const keyboard = {
    inline_keyboard: [[
      { text: "Открыть прогнозы", web_app: { url: userWebAppUrl } }
    ]]
  };
  sendText(chatId, "Нажмите кнопку ниже, чтобы открыть приложение:", keyboard);
}

// ============================================================
//  WEB APP (doGet)
// ============================================================
function doGet(e) {
  e = e || {};
  const params = e.parameter || {};

  const chatId   = String(params.chatId   || "").replace(/[^0-9-]/g, '');
  const userName = String(params.userName || "").replace(/[<>"'&\\]/g, '');

  const wantsAdmin = String(params.admin) === '1';

  if (wantsAdmin) {
    const key = String(params.key || '');

    if (key !== ADMIN_SECRET) {
      Logger.log('⛔ admin: неверный key, chatId=' + chatId);
      return forbidden_();
    }

    if (chatId !== ADMIN_CHAT_ID_STR) {
      Logger.log('⛔ admin: чужой chat_id=' + chatId);
      return forbidden_();
    }

    Logger.log('✅ admin: доступ разрешён chatId=' + chatId);

    const template = HtmlService.createTemplateFromFile(ADMIN_HTML_FILE_NAME);
    template.chatId   = chatId;
    template.userName = userName;
    template.adminKey = ADMIN_SECRET;

    return template.evaluate()
      .setTitle("Админ-панель")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag("viewport", "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no");
  }

  Logger.log("doGet params: " + JSON.stringify({ chatId: chatId, userName: userName }));

  // Фронт живёт на GitHub Pages: старые ссылки редиректим туда
  if (MINIAPP_URL && MINIAPP_URL.indexOf('https') === 0) {
    return HtmlService.createHtmlOutput(
      '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      '<meta http-equiv="refresh" content="0; url=' + MINIAPP_URL + '">' +
      '<title>Перенаправление…</title></head>' +
      '<body style="font-family:sans-serif;text-align:center;padding:60px 20px;color:#888">' +
      'Открываем приложение…<br><a href="' + MINIAPP_URL + '" style="color:#a8842c">Перейти</a>' +
      '<script>location.replace(' + JSON.stringify(MINIAPP_URL) + ');</script>' +
      '</body></html>'
    ).setTitle("Прогнозы").setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  const template = HtmlService.createTemplateFromFile(HTML_FILE_NAME);
template.chatId      = chatId;
template.userName    = userName;
template.botUsername = BOT_USERNAME;  // 👈 НОВАЯ СТРОКА

return template.evaluate()
  .setTitle("Прогнозы")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag("viewport", "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no");
}

function forbidden_() {
  return HtmlService.createHtmlOutput(
    '<!DOCTYPE html><html><head><meta charset="utf-8"><title>404</title></head>' +
    '<body style="font-family:-apple-system,sans-serif;text-align:center;padding:80px 20px;color:#666">' +
    '<h1 style="font-size:72px;margin:0">404</h1>' +
    '<p>Страница не найдена</p>' +
    '</body></html>'
  ).setTitle("404");
}

function requireAdmin_(key, chatId, initData) {
  if (String(key) !== ADMIN_SECRET) {
    throw new Error('403 Unauthorized');
  }
  if (String(chatId) !== ADMIN_CHAT_ID_STR) {
    throw new Error('403 Forbidden');
  }
  return true;
}

// ============================================================
//  WEBHOOK (doPost)
// ============================================================
function doPost(e) {
  try {
    let data;
    try {
      data = JSON.parse(e.postData.contents);
    } catch (err) {
      Logger.log("doPost: not JSON");
      return ContentService.createTextOutput("ok");
    }

    // === MINI APP API: fetch с фронта (GitHub Pages) ===
    if (data.fn && Array.isArray(data.args)) {
      return handleApiRequest_(data);
    }

    const updateId = data.update_id;
    if (updateId) {
      const cache = CacheService.getScriptCache();
      const cacheKey = 'update_' + updateId;
      if (cache.get(cacheKey)) {
        Logger.log('Duplicate update_id skipped: ' + updateId);
        return ContentService.createTextOutput("ok");
      }
      cache.put(cacheKey, '1', 600);
    }

    // === CALLBACK QUERY ===
    if (data.callback_query) {
      try {
        const cb = data.callback_query.data;
        const user = data.callback_query.from || {};
        const chatId = data.callback_query.message && data.callback_query.message.chat
          ? data.callback_query.message.chat.id
          : null;
        const userName = (user.first_name || "").trim() || (user.username || "").trim() || "Участник";

        if (!chatId) return ContentService.createTextOutput("ok");

        if (cb === "back_to_menu")    { sendWebAppMenu(chatId, userName); return ContentService.createTextOutput("ok"); }
        if (cb === "refresh_rating")  { showRating(chatId); return ContentService.createTextOutput("ok"); }
        if (cb === "profile_refresh") { showProfile(chatId, userName, user); return ContentService.createTextOutput("ok"); }
      } catch (e) {
        Logger.log('callback_query error: ' + e);
      }
      return ContentService.createTextOutput("ok");
    }

    // === MESSAGE ===
    if (data.message) {
      try {
        const rawText = data.message.text || "";
        const user = data.message.from || {};
        const chat = data.message.chat || {};
        const chatId = chat.id;
        const userName = (user.first_name || "").trim() || (user.username || "").trim() || "Участник";

        if (!chatId) return ContentService.createTextOutput("ok");

        const text = String(rawText)
          .replace(/[\u200B-\u200D\uFEFF]/g, "")
          .trim()
          .toLowerCase();

        Logger.log('=== doPost: chatId=' + chatId + ' | text="' + text + '"');

        // 🔥 1. СНАЧАЛА ОБРАБАТЫВАЕМ /admin (чтобы БД не блокировала)
        if (text.indexOf("/admin") === 0) {
          try {
            sendText(chatId, "⏳ Команда /admin получена. Ваш ID: `" + chatId + "`", null);
            Logger.log('🔍 /admin from chatId=' + chatId);

            if (String(chatId) !== ADMIN_CHAT_ID_STR) {
              sendText(chatId, "❌ Доступ запрещен. В скрипте: `" + ADMIN_CHAT_ID_STR + "`, а ваш: `" + chatId + "`.");
              return ContentService.createTextOutput("ok");
            }

            var baseUrl = getWebAppUrl();
            if (!baseUrl) {
              sendText(chatId, "⚠️ Ошибка: URL веб-приложения не настроен.");
              return ContentService.createTextOutput("ok");
            }

            var adminUrl = baseUrl + "?admin=1&key=" + encodeURIComponent(ADMIN_SECRET) + "&chatId=" + chatId + "&userName=" + encodeURIComponent(userName || "") + "&v=" + Date.now();
            
            var res = sendText(chatId, "🔧 *Админ-панель*", {
              inline_keyboard: [[ { text: "Открыть", web_app: { url: adminUrl } } ]]
            });

            if (!res || !res.ok) {
              sendText(chatId, "⚠️ Ошибка кнопки. Ссылка:\n\n" + adminUrl, null);
            }
          } catch (e) {
            Logger.log('❌ ADMIN ERROR: ' + e);
            sendText(chatId, "Ошибка в /admin: " + e.message);
          }
          return ContentService.createTextOutput("ok");
        }

        // 🔥 2. ЗАТЕМ ОБРАБАТЫВАЕМ /start (ТОЖЕ БЕЗ БАЗЫ ДАННЫХ)
if (text === "/start" || text === "start" || text === "меню" || text.indexOf("/start") === 0) {
  // Разбираем deep-link: /start league_ABC123
  var startParts = String(rawText).trim().split(/\s+/);
  var startPayload = startParts.length > 1 ? startParts[1].trim() : '';

  if (startPayload && startPayload.indexOf('league_') === 0) {
    var leagueCode = startPayload.substring(7).toUpperCase().replace(/[^A-Z0-9]/g, '');
    try {
      var joinRes = miniApp_joinPrivateLeague(chatId, userName, leagueCode);
      if (joinRes && joinRes.ok) {
        var emoji = joinRes.league.emoji || '🏆';
        var msg = joinRes.alreadyMember
          ? "ℹ️ Вы уже в лиге *" + escapeMd(joinRes.league.name) + "*"
          : "✅ Вы вступили в лигу *" + escapeMd(joinRes.league.name) + "*!";
        sendText(chatId, emoji + " " + msg + "\n\nОткройте приложение → вкладка «Рейтинг» → «Мои лиги».", null);
      } else {
        sendText(chatId, "⚠️ Не удалось вступить в лигу: " + (joinRes && joinRes.error || 'неизвестная ошибка'), null);
      }
    } catch (e) {
      Logger.log('start league join error: ' + e);
    }
  }

  sendWebAppMenu(chatId, userName);
  return ContentService.createTextOutput("ok");
}

        // 🔥 3. КОМАНДА /whoami
        if (text === "/whoami" || text === "кто я") {
          sendText(chatId, "👤 *Твои данные*\n\nchat_id: `" + chatId + "`\nИмя: " + escapeMd((user.first_name || '') + ' ' + (user.last_name || '')), null);
          return ContentService.createTextOutput("ok");
        }

        // 🔥 4. ТЕПЕРЬ СОХРАНЯЕМ ЮЗЕРА В БАЗУ (если это не команда выше)
        try {
          supabaseRequest_('users?on_conflict=user_name', {
            method: 'post',
            body: [{
              chat_id: Number(chatId),
              user_name: String(userName).trim(),
              first_name: user.first_name || '',
              last_name: user.last_name || '',
              username: user.username || ''
            }],
            prefer: 'return=minimal,resolution=merge-duplicates'
          });
        } catch (err2) {
          Logger.log('users upsert error: ' + err2);
        }

        // 🔥 5. ОСТАЛЬНЫЕ КОМАНДЫ (им нужна база данных)
        // Профиль
        if (text === "мой профиль" || text === "/profile" || text === "профиль") {
          showProfile(chatId, userName, user);
          return ContentService.createTextOutput("ok");
        }

        // Рейтинг
        if (text === "посмотреть рейтинг" || text === "/рейтинг" || text === "рейтинг") {
          showRating(chatId);
          return ContentService.createTextOutput("ok");
        }

        // Правила
        if (text === "правила" || text === "/rules") {
          showRules(chatId);
          return ContentService.createTextOutput("ok");
        }

        sendText(chatId, "Неизвестная команда. Напишите /start.");
      } catch (e) {
        Logger.log('message handler error: ' + e);
      }
    }
  } catch (outerErr) {
    Logger.log('doPost CRITICAL error: ' + outerErr);
  }

  return ContentService.createTextOutput("ok");
}

// ============================================================
//  URL
// ============================================================
function getWebAppUrl() {
  const saved = PropertiesService.getScriptProperties().getProperty("WEBAPP_URL");
  if (saved && saved.indexOf("/exec") !== -1) return saved;
  if (WEBAPP_URL_HARDCODED && WEBAPP_URL_HARDCODED.indexOf("/exec") !== -1) return WEBAPP_URL_HARDCODED;
  return "";
}

function saveWebAppUrl() {
  PropertiesService.getScriptProperties().setProperty("WEBAPP_URL", WEBAPP_URL_HARDCODED);
  Logger.log("WEBAPP_URL saved: " + WEBAPP_URL_HARDCODED);
}

// ============================================================
//  ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ (Sheets, Utils, Bots)
// ============================================================
function getTeamsSheet_() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName("Команды");
  if (!sh) {
    sh = ss.insertSheet("Команды");
    sh.appendRow(["teamName", "shortName", "crestUrl", "leagueCode"]);
  }
  return sh;
}

function normalizeTeamName_(s) {
  return String(s || "").toLowerCase().replace(/\u00a0/g, " ").replace(/[\.\,\']/g, "").replace(/\s+/g, " ").trim();
}

function splitMatchTeams_(matchName) {
  var parts = String(matchName || "").split(/\s*[-–—]\s*/);
  return { home: (parts[0] || "").trim(), away: (parts[1] || "").trim() };
}

function getTeamsMap_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get("teamsMap_v2");
  if (cached) { try { return JSON.parse(cached); } catch (e) {} }
  var sh = getTeamsSheet_();
  var rows = sh.getDataRange().getValues();
  var map = {};

  for (var i = 1; i < rows.length; i++) {
    var row = rows[i] || [];
    var nameA = String(row[0] || "").trim();
    var nameB = String(row[1] || "").trim();
    var crest = String(row[2] || "").trim();
    if (!nameA && !nameB) continue;

    var rec = { name: nameA || nameB, shortName: nameA || nameB, crestUrl: crest };
    if (nameA) map[normalizeTeamName_(nameA)] = rec;
    if (nameB) map[normalizeTeamName_(nameB)] = rec;
  }

  try { cache.put("teamsMap_v2", JSON.stringify(map), 300); } catch (e) {}
  return map;
}

function resolveTeams_(matchName, teamsMap) {
  var t = splitMatchTeams_(matchName);
  var home = teamsMap[normalizeTeamName_(t.home)] || null;
  var away = teamsMap[normalizeTeamName_(t.away)] || null;
  return {
    home: { name: t.home, shortName: home ? home.name : t.home, crestUrl: home ? home.crestUrl : "" },
    away: { name: t.away, shortName: away ? away.name : t.away, crestUrl: away ? away.crestUrl : "" }
  };
}

function escapeMd(text) {
  if (!text) return "";
  return String(text).replace(/\\/g,"\\\\").replace(/_/g,"\\_").replace(/\*/g,"\\*").replace(/`/g,"\\`").replace(/\[/g,"\\[");
}

function normalizeMatchName_(s) {
  return String(s || "").toLowerCase().replace(/\u00a0/g, " ").replace(/ё/g, "е").replace(/\s*[-–—]\s*/g, "-").replace(/\s+/g, " ").trim();
}

function calcPointsForPrediction_(outcome, predScore, realScore) {
  const res = { points: 0, correctOutcome: false, correctDiff: false, exactScore: false };
  const pm = String(predScore || "").match(/^(\d+)\s*-\s*(\d+)$/);
  const rm = String(realScore || "").match(/^(\d+)\s*-\s*(\d+)$/);
  if (!rm) return res;

  const rh = Number(rm[1]), ra = Number(rm[2]);
  const realOutcome = rh > ra ? "П1" : (rh < ra ? "П2" : "Ничья");

  if (pm) {
    const ph = Number(pm[1]), pa = Number(pm[2]);
    const predOutcome = ph > pa ? "П1" : (ph < pa ? "П2" : "Ничья");
    if (ph === rh && pa === ra) { res.exactScore = true; res.correctDiff = true; res.correctOutcome = true; res.points = 5; return res; }
    if ((ph - pa) === (rh - ra)) { res.correctDiff = true; res.correctOutcome = true; res.points = 3; return res; }
    if (predOutcome === realOutcome) { res.correctOutcome = true; res.points = 1; return res; }
    return res;
  }
  if (outcome === realOutcome) { res.correctOutcome = true; res.points = 1; }
  return res;
}

function getUserAchievements(userName) {
  try {
    var clean = String(userName || "").trim();
    var rows = supabaseRequest_('achievements?user_name=eq.' + encodeURIComponent(clean), { method: 'get' }) || [];
    return rows.map(function(r){ return { code: r.code, name: r.name }; });
  } catch (e) { return []; }
}

function recalcUserPoints_(userName) {
  var clean = String(userName || "").trim();
  if (!clean) return null;
  try {
    var preds = supabaseRequest_(
      'predictions?user_name=eq.' + encodeURIComponent(clean) +
      '&select=league_code,match_norm,outcome,score,is_joker', // 🔥 добавили is_joker
      { method: 'get', noCache: true }
    ) || [];
    if (!preds.length) {
      try {
        supabaseRequest_('user_points?on_conflict=user_name', {
          method: 'post',
          body: [{ user_name: clean, total_points: 0, per_league: {}, updated_at: new Date().toISOString() }],
          prefer: 'return=minimal,resolution=merge-duplicates'
        });
      } catch (e) {}
      return { user_name: clean, total_points: 0, per_league: {} };
    }
    var leagueSet = {};
    preds.forEach(function(p){ leagueSet[p.league_code] = true; });
    var leagueCodes = Object.keys(leagueSet);
    var matches = supabaseRequest_(
      'matches?real_score=not.is.null&league_code=in.(' +
      leagueCodes.map(encodeURIComponent).join(',') +
      ')&select=league_code,match_norm,real_score',
      { method: 'get', noCache: true }
    ) || [];
    var realMap = {};
    matches.forEach(function(m) {
      realMap[m.league_code + '||' + m.match_norm] = m.real_score;
    });
    var total = 0, perLeague = {};
    preds.forEach(function(p) {
      var real = realMap[p.league_code + '||' + p.match_norm];
      if (!real) return;
      var pts = calcPointsForPrediction_(p.outcome, p.score, real).points;
      if (p.is_joker === true) pts *= 2; // 🔥 JOKER x2
      total += pts;
      perLeague[p.league_code] = (perLeague[p.league_code] || 0) + pts;
    });
    supabaseRequest_('user_points?on_conflict=user_name', {
      method: 'post',
      body: [{ user_name: clean, total_points: total, per_league: perLeague, updated_at: new Date().toISOString() }],
      prefer: 'return=minimal,resolution=merge-duplicates'
    });
    return { user_name: clean, total_points: total, per_league: perLeague };
  } catch (e) { return null; }
}

function buildRatingFromSupabase_() {
  var cache = CacheService.getScriptCache();
  var cacheKey = 'rating_' + getCacheVersion_('user_points');
  var cached = cache.get(cacheKey);
  if (cached) { try { return JSON.parse(cached); } catch (e) {} }
  try {
    var rows = supabaseRequest_('user_points?select=user_name,total_points,per_league&order=total_points.desc&limit=500', { method: 'get' });
    if (!rows || !rows.length) return [];
    var list = rows.map(function(r) { return { name: r.user_name, points: Number(r.total_points) || 0, leagues: r.per_league || {} }; });
    try { var s = JSON.stringify(list); if (s.length < 95000) cache.put(cacheKey, s, 60); } catch (e) {}
    return list;
  } catch (e) { return []; }
}

function showProfile(chatId, userName, user) {
  try {
    const cleanUser = String(userName).trim();
    const predsCount = supabaseRequest_('predictions?user_name=eq.' + encodeURIComponent(cleanUser) + '&select=id', { method: 'get' });
    const totalPredictions = (predsCount || []).length;
    const ratingData = buildRatingFromSupabase_();
    let place = "-", points = 0, totalPlayers = ratingData.length;
    for (let i = 0; i < ratingData.length; i++) {
      if (ratingData[i].name === cleanUser) { place = i + 1; points = ratingData[i].points; break; }
    }
    const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ") || userName;
    let msg = "Профиль\n" + escapeMd(fullName) + "\n\nПрогнозов: " + totalPredictions + "\nМесто: " + place + " из " + totalPlayers + "\nОчков: " + points + "\n";
    sendText(chatId, msg, { inline_keyboard: [[{ text: "Обновить", callback_data: "profile_refresh" }], [{ text: "Рейтинг",  callback_data: "refresh_rating"  }]] });
  } catch (e) { sendText(chatId, "Ошибка профиля."); }
}

function showRating(chatId) {
  try {
    const ratingData = buildRatingFromSupabase_();
    if (!ratingData.length) { sendText(chatId, "Рейтинг пуст."); return; }
    let resp = "Текущий рейтинг:\n\n";
    for (let i = 0; i < Math.min(ratingData.length, 20); i++) {
      resp += (i + 1) + ". " + escapeMd(ratingData[i].name) + " - " + ratingData[i].points + "\n";
    }
    sendText(chatId, resp, { inline_keyboard: [[{ text: "Обновить", callback_data: "refresh_rating" }]] });
  } catch (e) { sendText(chatId, "Ошибка рейтинга."); }
}

function showRules(chatId) {
  sendText(chatId, "Правила игры\n\nУгадан исход: +1\nУгадана разница: +3\nТочный счет: +5\n\nПрогноз - до начала матча.");
}

function checkRateLimit_(key, maxPerMinute) {
  try {
    var cache = CacheService.getScriptCache();
    var now = Math.floor(Date.now() / 60000);
    var k = 'rl_' + key + '_' + now;
    var cnt = parseInt(cache.get(k) || '0', 10);
    if (cnt >= maxPerMinute) return false;
    cache.put(k, String(cnt + 1), 65);
    return true;
  } catch (e) { return true; }
}

function miniApp_getBootstrap(chatId, userName) {
  try {
    const cleanUser = String(userName).trim();
    const rating = buildRatingFromSupabase_();
    const userPreds = supabaseRequest_('predictions?user_name=eq.' + encodeURIComponent(cleanUser) + '&select=id,league_code', { method: 'get' });
    const totalPredictions = (userPreds || []).length;
    const leagueStats = {};
    for (const code in LEAGUES) { leagueStats[code] = { name: LEAGUES[code].name, emoji: LEAGUES[code].emoji, flagClass: LEAGUES[code].flagClass || "", count: 0, points: 0 }; }
    (userPreds || []).forEach(function(p) { if (leagueStats[p.league_code]) leagueStats[p.league_code].count++; });
    let place = "-", points = 0, totalPlayers = rating.length;
    for (let i = 0; i < rating.length; i++) {
      if (rating[i].name === cleanUser) {
        place = i + 1; points = rating[i].points;
        for (const code in rating[i].leagues) { if (leagueStats[code]) leagueStats[code].points = rating[i].leagues[code]; }
        break;
      }
    }
    const ratingFormatted = rating.map(function(r) { return { name: r.name, points: r.points, leagues: r.leagues, move: null }; });
    const achs = getUserAchievements(cleanUser);
    const uiLeagues = {};
    for (const code in LEAGUES) { uiLeagues[code] = { code: LEAGUES[code].code, name: LEAGUES[code].name, emoji: LEAGUES[code].emoji, flagClass: LEAGUES[code].flagClass || "", sheetName: LEAGUES[code].sheetName, competition: LEAGUES[code].competition }; }
    return { ok: true, leagues: uiLeagues, rating: ratingFormatted, profile: { place: place, points: points, totalPredictions: totalPredictions, totalAchievements: Object.keys(XP_ACHIEVEMENTS).length, achievements: achs, leagueStats: leagueStats } };
  } catch (e) { return { ok: false, error: e.message }; }
}

function miniApp_getLeagueMatches(leagueCode, chatId, userName) {
  try {
    const cleanUser = String(userName).trim();
    const allMatches = supabaseRequest_('matches?league_code=eq.' + encodeURIComponent(leagueCode) + '&order=tour_num.asc,utc_date.asc', { method: 'get' }) || [];
    if (!allMatches.length) return { ok: true, matches: [] };
    const toursMap = {};
    allMatches.forEach(function(m) { var t = Number(m.tour_num); if (!t) return; if (!toursMap[t]) toursMap[t] = []; toursMap[t].push(m); });
    var tourNumbers = Object.keys(toursMap).map(Number).sort(function(a, b){ return a - b; });
    if (!tourNumbers.length) return { ok: true, matches: [] };
    var currentTour = null; var now = new Date().getTime();
    for (var i = tourNumbers.length - 1; i >= 0; i--) {
      var tNum = tourNumbers[i]; var tourMatches = toursMap[tNum];
      var isTourActive = tourMatches.some(function(m) { if (!m.real_score || !/^\d+\s*[-:]\s*\d+$/.test(String(m.real_score))) return true; if (m.utc_date) { var matchTime = new Date(m.utc_date).getTime(); if (matchTime + 4 * 60 * 60 * 1000 > now) return true; } return false; });
      if (isTourActive) { currentTour = tNum; break; }
    }
    if (currentTour === null) currentTour = tourNumbers[tourNumbers.length - 1];
    var matches = toursMap[currentTour] || [];
    const userPreds = supabaseRequest_('predictions?user_name=eq.' + encodeURIComponent(cleanUser) + '&league_code=eq.' + encodeURIComponent(leagueCode), { method: 'get' });
    const predMap = {}; (userPreds || []).forEach(function(p) { predMap[p.match_norm] = p; });
    const teamsMap = getTeamsMap_();
    const result = matches.map(function(m) {
      const up = predMap[m.match_norm] || null;
      const teams = resolveTeams_(m.match_name, teamsMap);
      let timeStr = '';
      if (m.utc_date) { try { timeStr = Utilities.formatDate(new Date(m.utc_date), 'Europe/Moscow', 'dd.MM HH:mm'); } catch (e) {} }
      return { matchName: m.match_name, time: timeStr, leagueCode: leagueCode, tourNum: currentTour, matchDateStr: m.utc_date || null, realScore: m.real_score || null, homeTeam: teams.home, awayTeam: teams.away, userPrediction: up ? { outcome: up.outcome, score: up.score } : null };
    });
    result.sort(function(a, b) { return (a.matchDateStr || '').localeCompare(b.matchDateStr || ''); });
    return { ok: true, matches: result, currentTour: currentTour };
  } catch (e) { return { ok: false, error: e.message, matches: [] }; }
}

function miniApp_savePrediction(payload) {
  try {
    const userName = String(payload.userName || "").trim();
    const matchName = String(payload.matchName || "").trim();
    const leagueCode = String(payload.leagueCode || "").trim();
    const outcome = String(payload.outcome || "").trim();
    const score = String(payload.score || "").trim();
    const useJoker = payload.useJoker === true; // 🔥 NEW

    if (!userName || !matchName || !leagueCode || !outcome || !score) {
      return { ok: false, error: "Не все поля заполнены" };
    }
    if (!/^\d+\s*-\s*\d+$/.test(score)) {
      return { ok: false, error: "Неверный формат счета" };
    }
    if (!checkRateLimit_('pred_' + userName, RATE_LIMIT_PRED_PER_MIN)) {
      return { ok: false, error: "Слишком много запросов." };
    }

    const matchNorm = normalizeMatchName_(matchName);
    const matchRows = supabaseRequest_(
      'matches?league_code=eq.' + encodeURIComponent(leagueCode) +
      '&match_norm=eq.' + encodeURIComponent(matchNorm) + '&select=utc_date',
      { method: 'get' }
    );
    if (matchRows && matchRows.length && matchRows[0].utc_date) {
      const matchTime = new Date(matchRows[0].utc_date).getTime();
      if (new Date().getTime() >= (matchTime - PREDICTION_LOCK_BEFORE_MS)) {
        return { ok: false, error: "Приём прогнозов закрыт (матч начнётся менее чем через 5 минут)." };
      }
    }

    // 🔥 ДЖОКЕР: активируем ПЕРЕД сохранением, чтобы валидация прошла
    var jokerResult = null;
    if (useJoker) {
      jokerResult = activateJoker_(userName);
      if (!jokerResult.ok) return jokerResult;
    }

    try {
      supabaseRequest_(
        'predictions?on_conflict=user_name,league_code,match_norm',
        {
          method: 'post',
          body: [{
            chat_id: Number(payload.chatId) || 0,
            user_name: userName,
            league_code: leagueCode,
            match_name: matchName,
            match_norm: matchNorm,
            outcome: outcome,
            score: score.replace(/\s/g, '').replace(/:/g, '-'),
            is_joker: !!useJoker // 🔥 NEW
          }],
          prefer: 'return=minimal,resolution=ignore-duplicates'
        }
      );
    } catch (e) {
      // Откатываем джокер, если прогноз дубль
      if (useJoker && jokerResult) {
        try {
          supabaseRequest_('xp_profiles?on_conflict=user_name', {
            method: 'post',
            body: [{
              user_name: userName,
              jokers_count: (jokerResult.remainingJokers || 0) + 1,
              last_joker_week: null
            }],
            prefer: 'return=minimal,resolution=merge-duplicates'
          });
        } catch (err2) {}
      }
      if (String(e).indexOf('409') !== -1 || String(e).indexOf('duplicate') !== -1) {
        return { ok: false, error: "Вы уже сделали прогноз на этот матч", alreadyExists: true };
      }
      throw e;
    }

    // Проверяем, что прогноз реально новый
    const checkExists = supabaseRequest_(
      'predictions?user_name=eq.' + encodeURIComponent(userName) +
      '&league_code=eq.' + encodeURIComponent(leagueCode) +
      '&match_norm=eq.' + encodeURIComponent(matchNorm) +
      '&select=id,saved_at',
      { method: 'get', noCache: true }
    );
    var isNew = false;
    if (checkExists && checkExists.length) {
      const savedAt = checkExists[0].saved_at ? new Date(checkExists[0].saved_at).getTime() : 0;
      if (Date.now() - savedAt < 15000) isNew = true;
    }
    if (!isNew && checkExists && checkExists.length) {
      return { ok: false, error: "Вы уже сделали прогноз на этот матч", alreadyExists: true };
    }

    var xpResult = addXP_(userName, XP_REWARDS.prediction, "prediction");
    bumpTasks_(userName, "prediction");
    bumpTaskLeagues_(userName, leagueCode);
    checkStreakAchievements_(userName);

    return {
      ok: true,
      saved: {
        matchName: matchName,
        outcome: outcome,
        score: score.replace(/\s/g, "").replace(/:/g, "-"),
        isJoker: !!useJoker // 🔥 NEW
      },
      xp: xpResult,
      joker: jokerResult // 🔥 NEW
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function miniApp_getUserPredictions(chatId, userName) {
  try {
    const cleanUser = String(userName || "").trim();
    const preds = supabaseRequest_('predictions?user_name=eq.' + encodeURIComponent(cleanUser) + '&select=id,user_name,league_code,match_name,match_norm,outcome,score,saved_at&order=id.desc&limit=25', { method: 'get' });
    if (!preds || !preds.length) return { ok: true, predictions: [] };
    const leagueSet = {}; const normsSet = {};
    preds.forEach(function(p){ leagueSet[p.league_code] = true; if (p.match_norm) normsSet[p.match_norm] = true; });
    const leagueCodes = Object.keys(leagueSet); const norms = Object.keys(normsSet);
    const matchMap = {};
    if (leagueCodes.length && norms.length) {
      const CHUNK_SIZE = 10;
      for (let i = 0; i < norms.length; i += CHUNK_SIZE) {
        const chunkNorms = norms.slice(i, i + CHUNK_SIZE);
        try {
          const allMatches = supabaseRequest_('matches?league_code=in.(' + leagueCodes.map(encodeURIComponent).join(',') + ')&match_norm=in.(' + chunkNorms.map(encodeURIComponent).join(',') + ')&select=league_code,match_norm,match_name,real_score,utc_date', { method: 'get', noCache: true }) || [];
          allMatches.forEach(function(m) { matchMap[m.league_code + '||' + m.match_norm] = m; });
        } catch (e) {}
      }
    }
    const teamsMap = getTeamsMap_();
    const fmt = function(iso) { try { if (!iso) return ""; const d = new Date(iso); if (isNaN(d.getTime())) return ""; return Utilities.formatDate(d, "Europe/Moscow", "dd.MM.yyyy HH:mm"); } catch (e) { return ""; } };
    const list = preds.map(function(p) {
      const m = matchMap[p.league_code + '||' + p.match_norm];
      const teams = resolveTeams_(p.match_name, teamsMap);
      const realScore = m ? m.real_score : null;
      let points = null; if (realScore) { points = calcPointsForPrediction_(p.outcome, p.score, realScore).points; }
      return { id: p.id, matchName: p.match_name, leagueCode: p.league_code, leagueName: LEAGUES[p.league_code] ? LEAGUES[p.league_code].name : p.league_code, leagueEmoji: LEAGUES[p.league_code] ? LEAGUES[p.league_code].emoji : "", leagueFlagClass: LEAGUES[p.league_code] ? (LEAGUES[p.league_code].flagClass || "") : "", homeTeam: teams.home, awayTeam: teams.away, dateStr: m && m.utc_date ? fmt(m.utc_date) : fmt(p.saved_at), matchTs: m && m.utc_date ? new Date(m.utc_date).getTime() : 0, savedTs: p.saved_at ? new Date(p.saved_at).getTime() / 1000 : 0, outcome: p.outcome, score: p.score, realScore: realScore, points: points };
    });
    return { ok: true, predictions: list };
  } catch (e) { return { ok: false, error: e.message, predictions: [] }; }
}

function miniApp_getUserStats(targetUserName) {
  try {
    const cleanTarget = String(targetUserName || "").trim();
    if (!cleanTarget) return { ok: false, error: "Не указано имя пользователя" };
    const ratingData = buildRatingFromSupabase_();
    let place = "-", totalPoints = 0, totalPlayers = ratingData.length;
    const leaguePoints = {}; for (const c in LEAGUES) leaguePoints[c] = 0;
    for (let i = 0; i < ratingData.length; i++) {
      if (ratingData[i].name === cleanTarget) { place = i + 1; totalPoints = ratingData[i].points; for (const code in ratingData[i].leagues) { leaguePoints[code] = ratingData[i].leagues[code]; } break; }
    }
    const preds = supabaseRequest_('predictions?user_name=eq.' + encodeURIComponent(cleanTarget) + '&select=league_code,match_norm,match_name,outcome,score,saved_at', { method: 'get' });
    const totalPredictions = (preds || []).length; let lastPredictionDate = null;
    const userByLeague = {}; const leagueSet = {};
    (preds || []).forEach(function(p) { const lc = p.league_code; if (p.saved_at) { const d = new Date(p.saved_at); if (!lastPredictionDate || d > lastPredictionDate) lastPredictionDate = d; } if (!userByLeague[lc]) userByLeague[lc] = {}; leagueSet[lc] = true; userByLeague[lc][p.match_norm] = { outcome: p.outcome, score: p.score }; });
    let allMatches = []; const userLeagues = Object.keys(leagueSet);
    if (userLeagues.length) { allMatches = supabaseRequest_('matches?real_score=not.is.null&league_code=in.(' + userLeagues.map(encodeURIComponent).join(',') + ')&select=league_code,match_norm,real_score', { method: 'get' }) || []; }
    const realByLeague = {};
    allMatches.forEach(function(m) { if (!realByLeague[m.league_code]) realByLeague[m.league_code] = {}; realByLeague[m.league_code][m.match_norm] = m.real_score; });
    const leagues = []; let totPreds = 0, totResolved = 0, totOutcomeHit = 0, totDiffHit = 0, totScoreHit = 0, totPointsCalc = 0;
    for (const code in LEAGUES) {
      const userMatches = userByLeague[code] || {}; const realMatches = realByLeague[code] || {};
      let predictions = 0, resolved = 0, outcomeHit = 0, diffHit = 0, scoreHit = 0, points = 0;
      for (const mn in userMatches) {
        predictions++; const p = userMatches[mn]; const real = realMatches[mn];
        if (!real) continue; resolved++;
        const res = calcPointsForPrediction_(p.outcome, p.score, real);
        if (res.exactScore) scoreHit++; if (res.correctDiff) diffHit++; if (res.correctOutcome) outcomeHit++;
        points += res.points;
      }
      const pctOf = function(hit) { return resolved ? Math.round((hit * 100) / resolved) : 0; };
      totPreds += predictions; totResolved += resolved; totOutcomeHit += outcomeHit; totDiffHit += diffHit; totScoreHit += scoreHit; totPointsCalc += points;
      leagues.push({ code: code, name: LEAGUES[code].name, emoji: LEAGUES[code].emoji, flagClass: LEAGUES[code].flagClass || "", predictions: predictions, resolved: resolved, pending: predictions - resolved, points: points, pointsFromRating: leaguePoints[code] || 0, outcomeHit: outcomeHit, diffHit: diffHit, scoreHit: scoreHit, pctOutcome: pctOf(outcomeHit), pctDiff: pctOf(diffHit), pctScore: pctOf(scoreHit) });
    }
    const leaguesFiltered = leagues.filter(function(x){ return x.predictions > 0; });
    const total = { predictions: totPreds, resolved: totResolved, pending: totPreds - totResolved, points: totPointsCalc, outcomeHit: totOutcomeHit, diffHit: totDiffHit, scoreHit: totScoreHit, pctOutcome: totResolved ? Math.round((totOutcomeHit * 100) / totResolved) : 0, pctDiff: totResolved ? Math.round((totDiffHit * 100) / totResolved) : 0, pctScore: totResolved ? Math.round((totScoreHit * 100) / totResolved) : 0 };
    const achievements = getUserAchievements(cleanTarget);
    let lastDateStr = ""; if (lastPredictionDate) { try { lastDateStr = Utilities.formatDate(lastPredictionDate, "Europe/Moscow", "dd.MM.yyyy"); } catch (e) { lastDateStr = ""; } }
    return { ok: true, userName: cleanTarget, place: place, totalPlayers: totalPlayers, totalPoints: totalPoints, totalPredictions: totalPredictions, lastPredictionDate: lastDateStr, total: total, leagues: leaguesFiltered, achievements: achievements, totalAchievements: Object.keys(XP_ACHIEVEMENTS).length };
  } catch (e) { return { ok: false, error: e.message }; }
}

function miniApp_getMatchPredictions(leagueCode, matchName, chatId, userName) {
  try {
    const cleanMatch = String(matchName || "").trim(); const cleanLeague = String(leagueCode || "").trim(); const me = String(userName || "").trim();
    const teamsMap = getTeamsMap_(); const teams = resolveTeams_(cleanMatch, teamsMap); const targetNorm = normalizeMatchName_(cleanMatch);
    const preds = supabaseRequest_('predictions?league_code=eq.' + encodeURIComponent(cleanLeague) + '&match_norm=eq.' + encodeURIComponent(targetNorm) + '&order=saved_at.desc', { method: 'get' });
    const byUser = {};
    (preds || []).forEach(function(p) { const rowUser = p.user_name; if (!rowUser) return; const ts = p.saved_at ? new Date(p.saved_at).getTime() : 0; if (!byUser[rowUser] || ts >= byUser[rowUser].savedTs) { byUser[rowUser] = { userName: rowUser, outcome: p.outcome, score: p.score, savedTs: ts }; } });
    const list = Object.keys(byUser).map(function(k) { return byUser[k]; });
    let countP1 = 0, countDraw = 0, countP2 = 0, countOther = 0;
    for (let i = 0; i < list.length; i++) { const o = list[i].outcome; if (o === "П1") countP1++; else if (o === "П2") countP2++; else if (o === "Ничья" || o.toLowerCase() === "ничья") countDraw++; else countOther++; }
    const total = list.length; const pct = function(n) { return total ? Math.round((n * 100) / total) : 0; };
    list.sort(function(a, b) { if (a.userName === me && b.userName !== me) return -1; if (b.userName === me && a.userName !== me) return 1; return a.userName.localeCompare(b.userName, "ru"); });
    const league = LEAGUES[cleanLeague] || null;
    return { ok: true, matchName: cleanMatch, leagueName: league ? league.name : cleanLeague, leagueEmoji: league ? league.emoji : "", leagueFlagClass: league ? (league.flagClass || "") : "", homeTeam: teams.home, awayTeam: teams.away, isMe: me, stats: { total: total, P1: countP1, Draw: countDraw, P2: countP2, Other: countOther, pctP1: pct(countP1), pctDraw: pct(countDraw), pctP2: pct(countP2) }, predictions: list, total: total };
  } catch (e) { return { ok: false, error: e.message, predictions: [] }; }
}

function miniApp_getProfileDashboard(chatId, userName) {
  try {
    const cleanUser = String(userName || "").trim();
    const ratingData = buildRatingFromSupabase_();
    let place = null, points = 0, totalPlayers = ratingData.length;
    for (let i = 0; i < ratingData.length; i++) { if (ratingData[i].name === cleanUser) { place = i + 1; points = ratingData[i].points; break; } }
    const preds = supabaseRequest_('predictions?user_name=eq.' + encodeURIComponent(cleanUser) + '&select=league_code,match_norm,outcome,score,saved_at', { method: 'get' });
    const totalPredictions = (preds || []).length;
    const userByLeague = {}; const leagueSet = {};
    (preds || []).forEach(function(p) { const lc = p.league_code; const mn = p.match_norm; if (!mn) return; leagueSet[lc] = true; if (!userByLeague[lc]) userByLeague[lc] = {}; const ts = p.saved_at ? new Date(p.saved_at).getTime() : 0; const prev = userByLeague[lc][mn]; if (!prev || ts >= prev.savedTs) { userByLeague[lc][mn] = { outcome: p.outcome, score: p.score, savedTs: ts }; } });
    let allMatches = []; const userLeagues = Object.keys(leagueSet);
    if (userLeagues.length) { allMatches = supabaseRequest_('matches?real_score=not.is.null&league_code=in.(' + userLeagues.map(encodeURIComponent).join(',') + ')&select=league_code,match_norm,real_score', { method: 'get' }) || []; }
    const realByLeague = {};
    allMatches.forEach(function(m) { if (!realByLeague[m.league_code]) realByLeague[m.league_code] = {}; realByLeague[m.league_code][m.match_norm] = m.real_score; });
    const leagues = []; let totPreds = 0, totResolved = 0, totOutcomeHit = 0, totDiffHit = 0, totScoreHit = 0, totPoints = 0;
    for (const code in LEAGUES) {
      const userMatches = userByLeague[code] || {}; const realMatches = realByLeague[code] || {};
      let predictions = 0, resolvedL = 0, outcomeHitL = 0, diffHitL = 0, scoreHitL = 0, ptsL = 0;
      for (const mn in userMatches) { predictions++; const p = userMatches[mn]; const real = realMatches[mn]; if (!real) continue; resolvedL++; const res = calcPointsForPrediction_(p.outcome, p.score, real); if (res.exactScore) scoreHitL++; if (res.correctDiff) diffHitL++; if (res.correctOutcome) outcomeHitL++; ptsL += res.points; }
      const pctOf = function(hit) { return resolvedL ? Math.round((hit * 100) / resolvedL) : 0; };
      leagues.push({ code: code, name: LEAGUES[code].name, emoji: LEAGUES[code].emoji, flagClass: LEAGUES[code].flagClass || "", predictions: predictions, resolved: resolvedL, pending: predictions - resolvedL, points: ptsL, outcomeHit: outcomeHitL, diffHit: diffHitL, scoreHit: scoreHitL, pctOutcome: pctOf(outcomeHitL), pctDiff: pctOf(diffHitL), pctScore: pctOf(scoreHitL) });
      totPreds += predictions; totResolved += resolvedL; totOutcomeHit += outcomeHitL; totDiffHit += diffHitL; totScoreHit += scoreHitL; totPoints += ptsL;
    }
    const leaguesFiltered = leagues.filter(function(x){ return x.predictions > 0; });
    const total = { predictions: totPreds, resolved: totResolved, pending: totPreds - totResolved, points: totPoints, outcomeHit: totOutcomeHit, diffHit: totDiffHit, scoreHit: totScoreHit, pctOutcome: totResolved ? Math.round((totOutcomeHit * 100) / totResolved) : 0, pctDiff: totResolved ? Math.round((totDiffHit * 100) / totResolved) : 0, pctScore: totResolved ? Math.round((totScoreHit * 100) / totResolved) : 0 };
    const achievements = getUserAchievements(cleanUser);
    return { ok: true, userName: cleanUser, place: place, totalPlayers: totalPlayers, points: points, totalPredictions: totalPredictions, total: total, leagues: leaguesFiltered, achievements: achievements, totalAchievements: Object.keys(XP_ACHIEVEMENTS).length, xp: getXPProfile_(cleanUser) };
  } catch (e) { return { ok: false, error: e.message }; }
}

var XP_REWARDS = { prediction: 5, streakBonus: 10, outcomeHit: 10, diffHit: 20, exactScore: 40, taskClaim: 0 };
function calcLevel_(xp) { return Math.floor(Math.sqrt(Math.max(0, xp) / 50)); }
function xpForLevel_(level) { return 50 * Math.pow(level, 2); }
var LEVEL_TITLES = [{ min: 0, title: "Новичок", icon: "🐣" }, { min: 3, title: "Любитель", icon: "⚽" }, { min: 5, title: "Знаток", icon: "🎓" }, { min: 8, title: "Эксперт", icon: "🧠" }, { min: 12, title: "Пророк", icon: "🔮" }, { min: 17, title: "Оракул", icon: "🌟" }, { min: 25, title: "Легенда", icon: "👑" }];
function getLevelTitle_(level) { var t = LEVEL_TITLES[0]; for (var i = 0; i < LEVEL_TITLES.length; i++) { if (level >= LEVEL_TITLES[i].min) t = LEVEL_TITLES[i]; } return t; }

function miniApp_getNotifySettings(chatId, userName) {
  try {
    const clean = String(userName || "").trim();
    const rows = supabaseRequest_('subscriptions?user_name=eq.' + encodeURIComponent(clean), { method: 'get' });
    let leagues = null; if (rows && rows.length) leagues = rows[0].leagues || [];
    const all = {};
    for (const code in LEAGUES) { all[code] = { code: code, name: LEAGUES[code].name, emoji: LEAGUES[code].emoji, flagClass: LEAGUES[code].flagClass || "", enabled: leagues === null ? true : leagues.indexOf(code) !== -1 }; }
    return { ok: true, leagues: all, saved: leagues !== null };
  } catch (e) { return { ok: false, error: e.message }; }
}

function miniApp_saveNotifySettings(chatId, userName, leagueCodes) {
  try {
    const clean = String(userName || "").trim();
    const codes = Array.isArray(leagueCodes) ? leagueCodes.slice() : [];
    const valid = codes.filter(function(c){ return !!LEAGUES[c]; });
    supabaseRequest_('subscriptions?on_conflict=user_name', { method: 'post', body: [{ user_name: clean, chat_id: Number(chatId) || 0, leagues: valid }], prefer: 'return=minimal,resolution=merge-duplicates' });
    return { ok: true, saved: valid };
  } catch (e) { return { ok: false, error: e.message }; }
}

function getUserChats_() {
  var map = {};
  try {
    var offset = 0; var limit = 500;
    while (true) { var rows = supabaseRequest_('subscriptions?select=user_name,chat_id&limit=' + limit + '&offset=' + offset, { method: 'get', noCache: true }) || []; if (!rows.length) break; rows.forEach(function(r) { if (r.user_name && r.chat_id) map[r.user_name] = String(r.chat_id); }); if (rows.length < limit) break; offset += limit; }
    offset = 0;
    while (true) { var userRows = supabaseRequest_('users?select=user_name,chat_id&limit=' + limit + '&offset=' + offset, { method: 'get', noCache: true }) || []; if (!userRows.length) break; userRows.forEach(function(r) { if (r.user_name && r.chat_id && !map[r.user_name]) { map[r.user_name] = String(r.chat_id); } }); if (userRows.length < limit) break; offset += limit; }
  } catch (e) {}
  return map;
}

function getNotifyLogFromDB_() {
  try {
    var cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    var rows = supabaseRequest_('notify_log?select=user_name,match_key,type_key&sent_at=gte.' + encodeURIComponent(cutoff), { method: 'get', noCache: true }) || [];
    var map = {}; rows.forEach(function(r) { map[r.user_name + '||' + r.match_key + '||' + r.type_key] = true; });
    return map;
  } catch (e) { return {}; }
}

function saveNotifyLogDB_(userName, matchKey, typeKey) {
  try { supabaseRequest_('notify_log?on_conflict=user_name,match_key,type_key', { method: 'post', body: [{ user_name: userName, match_key: matchKey, type_key: typeKey, sent_at: new Date().toISOString() }], prefer: 'return=minimal,resolution=ignore-duplicates' }); } catch (e) {}
}

function cleanupNotifyLog_() {
  try { var cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(); supabaseRequest_('notify_log?sent_at=lt.' + encodeURIComponent(cutoff), { method: 'delete', prefer: 'return=minimal' }); } catch (e) {}
}

function notifyUpcomingMatches() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    var now = new Date();
    var w3Start = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString(); var w3End = new Date(now.getTime() + 3 * 60 * 60 * 1000 + 30 * 60 * 1000).toISOString();
    var w1Start = new Date(now.getTime() + 30 * 60 * 1000).toISOString(); var w1End = new Date(now.getTime() + 60 * 60 * 1000 + 30 * 60 * 1000).toISOString();
    var matches3h = supabaseRequest_('matches?real_score=is.null&utc_date=gte.' + w3Start + '&utc_date=lte.' + w3End + '&order=utc_date.asc', { method: 'get', noCache: true }) || [];
    var matches1h = supabaseRequest_('matches?real_score=is.null&utc_date=gte.' + w1Start + '&utc_date=lte.' + w1End + '&order=utc_date.asc', { method: 'get', noCache: true }) || [];
    if (!matches3h.length && !matches1h.length) return;
    var allPreds = supabaseRequest_('predictions?select=user_name,league_code,match_norm', { method: 'get', noCache: true }) || [];
    var madeByUser = {};
    allPreds.forEach(function(p) { if (!p.user_name || !p.match_norm) return; if (!madeByUser[p.user_name]) madeByUser[p.user_name] = {}; madeByUser[p.user_name][p.league_code + "||" + p.match_norm] = true; });
    var subsRows = supabaseRequest_('subscriptions?select=user_name,leagues', { method: 'get', noCache: true }) || [];
    var subMap = {}; subsRows.forEach(function(r) { subMap[r.user_name] = r.leagues || []; });
    var sentLog = getNotifyLogFromDB_(); var userChats = getUserChats_();
    if (!Object.keys(userChats).length) return;
    function sendBatch(matches, typeKey, headerText) {
      if (!matches.length) return 0; var sent = 0;
      for (var userName in userChats) {
        var chatId = userChats[userName]; if (!chatId) continue;
        var userSubs = subMap[userName]; var need = [];
        for (var k = 0; k < matches.length; k++) {
          var m = matches[k];
          if (userSubs !== undefined && userSubs !== null) { if (Array.isArray(userSubs) && userSubs.indexOf(m.league_code) === -1) continue; }
          var predKey = m.league_code + "||" + m.match_norm; if (madeByUser[userName] && madeByUser[userName][predKey]) continue;
          var logKey = userName + "||" + m.league_code + "||" + m.match_norm + "||" + typeKey; if (sentLog[logKey]) continue;
          need.push(m);
        }
        if (!need.length) continue;
        var text = headerText + "\n\n";
        need.slice(0, 8).forEach(function (m) { var d = Utilities.formatDate(new Date(m.utc_date), "Europe/Moscow", "HH:mm"); var lg = LEAGUES[m.league_code]; var lgPrefix = lg ? (lg.emoji + " ") : ""; text += lgPrefix + m.match_name + " — *" + d + "*\n"; });
        if (need.length > 8) text += "…и ещё " + (need.length - 8) + " матч(ей)\n";
        text += "\n👉 Откройте приложение, чтобы сделать прогноз.";
        var result = sendText(chatId, text, { inline_keyboard: [[{ text: "Открыть прогнозы", web_app: { url: getWebAppUrl() } }]] });
        if (result && result.ok) { for (var k2 = 0; k2 < need.length; k2++) { var m2 = need[k2]; saveNotifyLogDB_(userName, m2.league_code + "||" + m2.match_norm, typeKey); sentLog[userName + "||" + m2.league_code + "||" + m2.match_norm + "||" + typeKey] = true; } sent++; }
      }
      return sent;
    }
    sendBatch(matches3h, "3h", "⏰ *Скоро начало матчей*\n\nНе забудьте сделать прогноз:");
    sendBatch(matches1h, "1h", "🔥 *Матч начнётся меньше чем через час!*\n\nПоследний шанс сделать прогноз:");
  } catch (e) {} finally { try { lock.releaseLock(); } catch (e) {} }
}

function miniApp_getAvailableTours(leagueCode) {
  try {
    var rows = supabaseRequest_('matches?league_code=eq.' + encodeURIComponent(leagueCode) + '&select=tour_num,real_score', { method: 'get' }) || [];
    var map = {};
    rows.forEach(function(r) { var tourNum = Number(r.tour_num); if (isNaN(tourNum) || !tourNum) return; var isPlayed = !!(r.real_score && /^\d+\s*[-:]\s*\d+$/.test(String(r.real_score))); if (!map[tourNum]) map[tourNum] = { total: 0, played: 0 }; map[tourNum].total++; if (isPlayed) map[tourNum].played++; });
    var tours = Object.keys(map).map(Number).sort(function(a, b){ return a - b; }).map(function(num) { return { number: num, label: "Тур " + num, played: map[num].played, total: map[num].total, finished: map[num].played === map[num].total && map[num].total > 0 }; });
    return { ok: true, tours: tours };
  } catch (e) { return { ok: false, error: e.message, tours: [] }; }
}

function miniApp_getTourRating(leagueCode, tourNumber) {
  try {
    var league = LEAGUES[leagueCode]; if (!league) return { ok: false, error: "Лига не найдена", rating: [] };
    tourNumber = parseInt(tourNumber, 10); if (isNaN(tourNumber)) return { ok: false, error: "Неверный тур", rating: [] };
    var matchesRows = supabaseRequest_('matches?league_code=eq.' + encodeURIComponent(leagueCode) + '&tour_num=eq.' + tourNumber + '&select=match_norm,match_name,real_score', { method: 'get' }) || [];
    var tourMatches = {}; var totalMatches = 0; var playedMatches = 0;
    matchesRows.forEach(function(m) { var norm = m.match_norm; if (!norm) return; var isPlayed = !!(m.real_score && /^\d+\s*[-:]\s*\d+$/.test(String(m.real_score))); tourMatches[norm] = { realScore: isPlayed ? String(m.real_score).replace(/:/g, '-').replace(/\s/g, '') : null, isPlayed: isPlayed }; totalMatches++; if (isPlayed) playedMatches++; });
    if (totalMatches === 0) { return { ok: true, leagueCode: leagueCode, leagueName: league.name, leagueEmoji: league.emoji, leagueFlagClass: league.flagClass || "", tourNumber: tourNumber, totalMatches: 0, playedMatches: 0, rating: [] }; }
    var predRows = supabaseRequest_('predictions?league_code=eq.' + encodeURIComponent(leagueCode) + '&select=user_name,match_norm,outcome,score,saved_at', { method: 'get' }) || [];
    var userPreds = {};
    predRows.forEach(function(p) { var user = p.user_name; if (!user) return; var normMatch = p.match_norm; if (!tourMatches[normMatch]) return; var ts = p.saved_at ? new Date(p.saved_at).getTime() : 0; if (!userPreds[user]) userPreds[user] = {}; var prev = userPreds[user][normMatch]; if (!prev || ts > prev.date) { userPreds[user][normMatch] = { outcome: p.outcome, score: p.score, date: ts }; } });
    var entries = [];
    for (var user in userPreds) { var predsMap = userPreds[user]; var points = 0, count = 0, resolved = 0; var exactCount = 0, diffCount = 0, outcomeCount = 0;
      for (var normMatch in predsMap) { var p = predsMap[normMatch]; var m = tourMatches[normMatch]; count++; if (!m.isPlayed) continue; resolved++; var res = calcPointsForPrediction_(p.outcome, p.score, m.realScore); points += res.points; if (res.exactScore) exactCount++; else if (res.correctDiff) diffCount++; else if (res.correctOutcome) outcomeCount++; }
      entries.push({ userName: user, points: points, count: count, resolved: resolved, exactCount: exactCount, diffCount: diffCount, outcomeCount: outcomeCount });
    }
    entries.sort(function (a, b) { if (b.points !== a.points) return b.points - a.points; if (b.exactCount !== a.exactCount) return b.exactCount - a.exactCount; return a.userName.localeCompare(b.userName, "ru"); });
    var lastPoints = null; var lastPlace = 0;
    entries.forEach(function (e, i) { if (e.points === lastPoints) { e.place = lastPlace; } else { e.place = i + 1; lastPoints = e.points; lastPlace = e.place; } });
    return { ok: true, leagueCode: leagueCode, leagueName: league.name, leagueEmoji: league.emoji, leagueFlagClass: league.flagClass || "", tournament: tourNumber, totalMatches: totalMatches, playedMatches: playedMatches, rating: entries };
  } catch (e) { return { ok: false, error: e.message, rating: [] }; }
}

// ============================================================
//  ПРИВАТНЫЕ ЛИГИ
// ============================================================
var PRIVATE_LEAGUE_LIMIT_PER_USER = 10;
var PRIVATE_LEAGUE_MAX_MEMBERS    = 50;

/**
 * Генерирует invite-код из 6 символов.
 * Символы 0/O/1/I/L исключены — чтобы код было легко диктовать голосом.
 */
function generateInviteCode_() {
  var chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  var code = '';
  for (var i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * Создать приватную лигу.
 */
function miniApp_createPrivateLeague(chatId, userName, name, emoji, description) {
  try {
    var cleanUser = String(userName || '').trim();
    var cleanName = String(name || '').trim().substring(0, 40);
    var cleanDesc = String(description || '').trim().substring(0, 200);
    var cleanEmoji = String(emoji || '🏆').trim().substring(0, 4);

    if (!cleanUser) return { ok: false, error: 'Не указан пользователь' };
    if (!cleanName) return { ok: false, error: 'Укажите название лиги' };

    // Лимит созданных лиг на пользователя
    var myLeagues = supabaseRequest_(
      'private_leagues?creator_user_name=eq.' + encodeURIComponent(cleanUser) + '&select=id',
      { method: 'get', noCache: true }
    ) || [];
    if (myLeagues.length >= PRIVATE_LEAGUE_LIMIT_PER_USER) {
      return { ok: false, error: 'Максимум ' + PRIVATE_LEAGUE_LIMIT_PER_USER + ' созданных лиг' };
    }

    // Уникальный код
    var code = null;
    for (var attempt = 0; attempt < 12; attempt++) {
      var candidate = generateInviteCode_();
      var exists = supabaseRequest_(
        'private_leagues?invite_code=eq.' + encodeURIComponent(candidate) + '&select=id',
        { method: 'get', noCache: true }
      );
      if (!exists || !exists.length) { code = candidate; break; }
    }
    if (!code) return { ok: false, error: 'Не удалось создать код, попробуйте ещё раз' };

    // Создаём лигу
    var result = supabaseRequest_('private_leagues', {
      method: 'post',
      body: [{
        name: cleanName,
        invite_code: code,
        creator_user_name: cleanUser,
        creator_chat_id: Number(chatId) || 0,
        emoji: cleanEmoji,
        description: cleanDesc,
        scoring_mode: 'since_creation',
        is_active: true
      }],
      prefer: 'return=representation'
    });

    var league = result && result[0];
    if (!league) return { ok: false, error: 'Ошибка создания лиги' };

    // Создателя — сразу в участники
    supabaseRequest_('private_league_members', {
      method: 'post',
      body: [{
        league_id: league.id,
        user_name: cleanUser,
        chat_id: Number(chatId) || 0
      }],
      prefer: 'return=minimal,resolution=ignore-duplicates'
    });

    return {
      ok: true,
      league: {
        id: league.id,
        name: league.name,
        inviteCode: league.invite_code,
        emoji: league.emoji
      }
    };
  } catch (e) {
    Logger.log('createPrivateLeague error: ' + e);
    return { ok: false, error: e.message };
  }
}

/**
 * Войти по коду.
 */
function miniApp_joinPrivateLeague(chatId, userName, inviteCode) {
  try {
    var cleanUser = String(userName || '').trim();
    var cleanCode = String(inviteCode || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!cleanUser) return { ok: false, error: 'Не указан пользователь' };
    if (cleanCode.length !== 6) return { ok: false, error: 'Код должен быть из 6 символов' };

    var leagues = supabaseRequest_(
      'private_leagues?invite_code=eq.' + encodeURIComponent(cleanCode) + '&is_active=eq.true',
      { method: 'get', noCache: true }
    );
    if (!leagues || !leagues.length) {
      return { ok: false, error: 'Лига с таким кодом не найдена' };
    }
    var league = leagues[0];

    // Уже в лиге?
    var existing = supabaseRequest_(
      'private_league_members?league_id=eq.' + encodeURIComponent(league.id) +
      '&user_name=eq.' + encodeURIComponent(cleanUser) + '&select=id',
      { method: 'get', noCache: true }
    );
    if (existing && existing.length) {
      return {
        ok: true,
        league: { id: league.id, name: league.name, emoji: league.emoji, inviteCode: league.invite_code },
        alreadyMember: true
      };
    }

    // Лимит участников
    var members = supabaseRequest_(
      'private_league_members?league_id=eq.' + encodeURIComponent(league.id) + '&select=id',
      { method: 'get', noCache: true }
    ) || [];
    if (members.length >= (league.max_members || PRIVATE_LEAGUE_MAX_MEMBERS)) {
      return { ok: false, error: 'Лига заполнена (максимум ' + (league.max_members || PRIVATE_LEAGUE_MAX_MEMBERS) + ' участников)' };
    }

    supabaseRequest_('private_league_members', {
      method: 'post',
      body: [{
        league_id: league.id,
        user_name: cleanUser,
        chat_id: Number(chatId) || 0
      }],
      prefer: 'return=minimal,resolution=ignore-duplicates'
    });

    return {
      ok: true,
      league: { id: league.id, name: league.name, emoji: league.emoji, inviteCode: league.invite_code }
    };
  } catch (e) {
    Logger.log('joinPrivateLeague error: ' + e);
    return { ok: false, error: e.message };
  }
}

/**
 * Список моих лиг.
 */
function miniApp_getMyPrivateLeagues(chatId, userName) {
  try {
    var cleanUser = String(userName || '').trim();
    if (!cleanUser) return { ok: false, error: 'Не указан пользователь' };

    var memberships = supabaseRequest_(
      'private_league_members?user_name=eq.' + encodeURIComponent(cleanUser) + '&select=league_id,joined_at',
      { method: 'get' }
    ) || [];
    if (!memberships.length) return { ok: true, leagues: [] };

    var ids = memberships.map(function(m) { return m.league_id; });
    var leagues = supabaseRequest_(
      'private_leagues?id=in.(' + ids.map(encodeURIComponent).join(',') + ')&is_active=eq.true&order=created_at.desc',
      { method: 'get' }
    ) || [];

    // Считаем участников одним запросом
    var allMembers = supabaseRequest_(
      'private_league_members?league_id=in.(' + ids.map(encodeURIComponent).join(',') + ')&select=league_id',
      { method: 'get' }
    ) || [];
    var counts = {};
    allMembers.forEach(function(m) { counts[m.league_id] = (counts[m.league_id] || 0) + 1; });

    var list = leagues.map(function(l) {
      return {
        id: l.id,
        name: l.name,
        emoji: l.emoji,
        inviteCode: l.invite_code,
        membersCount: counts[l.id] || 0,
        createdAt: l.created_at,
        isCreator: l.creator_user_name === cleanUser
      };
    });

    return { ok: true, leagues: list };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * 1. Получить список доступных матчей для добавления в лигу
 * (берем только те, на которые еще можно сделать прогноз)
 */
function miniApp_getAvailableMatchesForLeague(leagueId, chatId, userName) {
  try {
    var cleanUser = String(userName || '').trim();
    var leagueRows = supabaseRequest_('private_leagues?id=eq.' + encodeURIComponent(leagueId), { method: 'get' });
    if (!leagueRows || !leagueRows.length) return { ok: false, error: 'Лига не найдена' };
    if (leagueRows[0].creator_user_name !== cleanUser) return { ok: false, error: 'Только создатель может добавлять матчи' };

    // 👇 ФИЛЬТР: Берем только матчи, которые еще не начались и дата которых >= сегодня
    var todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    var todayIso = todayStart.toISOString();

    var matches = supabaseRequest_(
      'matches?real_score=is.null&utc_date=gte.' + encodeURIComponent(todayIso) + '&order=utc_date.asc&limit=100',
      { method: 'get', noCache: true }
    ) || [];
    
    var existing = supabaseRequest_('private_league_matches?league_id=eq.' + encodeURIComponent(leagueId) + '&select=match_id', { method: 'get', noCache: true }) || [];
    var existingIds = {};
    existing.forEach(function(e) { existingIds[e.match_id] = true; });

    var list = matches.map(function(m) {
      var timeStr = '';
      if (m.utc_date) { try { timeStr = Utilities.formatDate(new Date(m.utc_date), 'Europe/Moscow', 'dd.MM HH:mm'); } catch (e) {} }
      return {
        id: m.id,
        leagueCode: m.league_code,
        matchName: m.match_name,
        timeStr: timeStr,
        isAdded: !!existingIds[m.id]
      };
    });

    return { ok: true, matches: list };
  } catch (e) { return { ok: false, error: e.message }; }
}

/**
 * 2. Добавить выбранные матчи в лигу
 */
function miniApp_addMatchesToLeague(leagueId, matchIds, chatId, userName) {
  try {
    var cleanUser = String(userName || '').trim();
    var leagueRows = supabaseRequest_('private_leagues?id=eq.' + encodeURIComponent(leagueId), { method: 'get' });
    if (!leagueRows || !leagueRows.length) return { ok: false, error: 'Лига не найдена' };
    if (leagueRows[0].creator_user_name !== cleanUser) return { ok: false, error: 'Только создатель может добавлять матчи' };
    if (!matchIds || !matchIds.length) return { ok: false, error: 'Выберите хотя бы один матч' };

    var body = matchIds.map(function(id) {
      return { league_id: leagueId, match_id: parseInt(id, 10) };
    });

    supabaseRequest_('private_league_matches', {
      method: 'post',
      body: body,
      prefer: 'return=minimal,resolution=ignore-duplicates'
    });

    return { ok: true, added: body.length };
  } catch (e) { return { ok: false, error: e.message }; }
}

/**
 * 3. Получить матчи конкретной лиги (для отображения внутри)
 */
function miniApp_getLeagueMatchesList(leagueId, chatId, userName) {
  try {
    var sql = 'private_league_matches?league_id=eq.' + encodeURIComponent(leagueId) + '&select=match_id,matches(id,league_code,match_name,match_norm,real_score,utc_date)';
    var rows = supabaseRequest_(sql, { method: 'get', noCache: true }) || [];
    
    // 👇 Запрашиваем прогнозы пользователя, чтобы знать, ставить ли галочку "уже спрогнозировано"
    var userPreds = supabaseRequest_(
      'predictions?user_name=eq.' + encodeURIComponent(userName) + '&select=league_code,match_norm,outcome,score',
      { method: 'get', noCache: true }
    ) || [];
    
    var predMap = {};
    userPreds.forEach(function(p) {
      predMap[p.league_code + '||' + p.match_norm] = { outcome: p.outcome, score: p.score };
    });

    var list = rows.map(function(r) {
      var m = r.matches;
      if (!m) return null;
      
      var timeStr = '';
      if (m.utc_date) { try { timeStr = Utilities.formatDate(new Date(m.utc_date), 'Europe/Moscow', 'dd.MM HH:mm'); } catch (e) {} }
      
      var pred = predMap[m.league_code + '||' + m.match_norm] || null;

      return {
        id: m.id,
        matchName: m.match_name,
        matchNorm: m.match_norm,
        realScore: m.real_score,
        timeStr: timeStr,
        leagueCode: m.league_code,
        matchDateStr: m.utc_date,
        userPrediction: pred
      };
    }).filter(Boolean);

    list.sort(function(a, b) { return (a.matchDateStr || '').localeCompare(b.matchDateStr || ''); });
    return { ok: true, matches: list };
  } catch (e) { return { ok: false, error: e.message }; }
}

/**
 * Рейтинг внутри лиги.
 */
function miniApp_getPrivateLeagueRating(leagueId, chatId, userName) {
  try {
    var cleanUser = String(userName || '').trim();
    var cleanId = String(leagueId || '').trim();
    if (!cleanId) return { ok: false, error: 'Не указана лига' };

    var cache = CacheService.getScriptCache();
    var cacheKey = 'plr_' + cleanId + '_' + getCacheVersion_('private_leagues');
    var cached = cache.get(cacheKey);
    if (cached) { try { return JSON.parse(cached); } catch (e) {} }

    var leagueRows = supabaseRequest_('private_leagues?id=eq.' + encodeURIComponent(cleanId), { method: 'get' });
    if (!leagueRows || !leagueRows.length) return { ok: false, error: 'Лига не найдена' };
    var league = leagueRows[0];

    var members = supabaseRequest_('private_league_members?league_id=eq.' + encodeURIComponent(cleanId) + '&select=user_name,joined_at&order=joined_at.asc', { method: 'get' }) || [];

    var leaguePayload = {
      id: league.id, name: league.name, emoji: league.emoji,
      inviteCode: league.invite_code, creator: league.creator_user_name,
      createdAt: league.created_at, membersCount: members.length,
      scoringMode: league.scoring_mode
    };

    if (!members.length) {
      return { ok: true, league: leaguePayload, rating: [], isCreator: league.creator_user_name === cleanUser };
    }

    var memberNames = members.map(function(m) { return m.user_name; });

    // Получаем матчи, которые добавлены в эту лигу
    var leagueMatches = supabaseRequest_('private_league_matches?league_id=eq.' + encodeURIComponent(cleanId) + '&select=match_id,matches(match_name,real_score,league_code,match_norm)', { method: 'get', noCache: true }) || [];
    
    var realMap = {}; // "league||norm" -> real_score
    var matchIds = [];
    
    leagueMatches.forEach(function(lm) {
      var m = lm.matches;
      if (!m) return;
      matchIds.push(lm.match_id);
      if (m.real_score) {
        realMap[m.league_code + '||' + m.match_norm] = m.real_score;
      }
    });

    if (!matchIds.length) {
      var zeroRating = memberNames.map(function(u) {
        return { userName: u, points: 0, predictions: 0, resolved: 0, place: 1 };
      });
      return { ok: true, league: leaguePayload, rating: zeroRating, isCreator: league.creator_user_name === cleanUser, noPlayedYet: true };
    }

    // Прогнозы всех участников
    var allPreds = [];
    for (var i = 0; i < memberNames.length; i += 10) {
      var chunk = memberNames.slice(i, i + 10);
      var preds = supabaseRequest_('predictions?user_name=in.(' + chunk.map(encodeURIComponent).join(',') + ')&select=user_name,league_code,match_norm,outcome,score', { method: 'get', noCache: true }) || [];
      allPreds = allPreds.concat(preds);
    }

    var stats = {};
    memberNames.forEach(function(u) { stats[u] = { points: 0, predictions: 0, resolved: 0 }; });

    allPreds.forEach(function(p) {
      if (!stats[p.user_name]) return;
      var key = p.league_code + '||' + p.match_norm;
      var realScore = realMap[key];
      
      // Считаем прогнозы ТОЛЬКО по матчам из лиги
      stats[p.user_name].predictions += 1; 
      if (!realScore) return;
      
      var res = calcPointsForPrediction_(p.outcome, p.score, realScore);
      stats[p.user_name].points += res.points;
      stats[p.user_name].resolved += 1;
    });

    var rating = memberNames.map(function(u) {
      return { userName: u, points: stats[u].points, predictions: stats[u].predictions, resolved: stats[u].resolved };
    });
    rating.sort(function(a, b) { return b.points - a.points || a.userName.localeCompare(b.userName, 'ru'); });
    
    var lastPts = null, lastPlace = 0;
    rating.forEach(function(r, i) {
      if (r.points === lastPts) r.place = lastPlace;
      else { r.place = i + 1; lastPts = r.points; lastPlace = r.place; }
    });

    var result = { ok: true, league: leaguePayload, rating: rating, isCreator: league.creator_user_name === cleanUser };
    try { cache.put(cacheKey, JSON.stringify(result), 60); } catch (e) {}
    return result;
  } catch (e) { return { ok: false, error: e.message }; }
}

/**
 * Покинуть лигу (не создатель).
 */
function miniApp_leavePrivateLeague(chatId, userName, leagueId) {
  try {
    var cleanUser = String(userName || '').trim();
    var cleanId = String(leagueId || '').trim();

    var leagueRows = supabaseRequest_(
      'private_leagues?id=eq.' + encodeURIComponent(cleanId),
      { method: 'get', noCache: true }
    );
    if (!leagueRows || !leagueRows.length) return { ok: false, error: 'Лига не найдена' };
    if (leagueRows[0].creator_user_name === cleanUser) {
      return { ok: false, error: 'Создатель не может покинуть лигу. Удалите её.' };
    }

    supabaseRequest_(
      'private_league_members?league_id=eq.' + encodeURIComponent(cleanId) +
      '&user_name=eq.' + encodeURIComponent(cleanUser),
      { method: 'delete', prefer: 'return=minimal' }
    );

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Удалить лигу (только создатель).
 */
function miniApp_deletePrivateLeague(chatId, userName, leagueId) {
  try {
    var cleanUser = String(userName || '').trim();
    var cleanId = String(leagueId || '').trim();

    var leagueRows = supabaseRequest_(
      'private_leagues?id=eq.' + encodeURIComponent(cleanId),
      { method: 'get', noCache: true }
    );
    if (!leagueRows || !leagueRows.length) return { ok: false, error: 'Лига не найдена' };
    if (leagueRows[0].creator_user_name !== cleanUser) {
      return { ok: false, error: 'Только создатель может удалить лигу' };
    }

    supabaseRequest_(
      'private_leagues?id=eq.' + encodeURIComponent(cleanId),
      { method: 'delete', prefer: 'return=minimal' }
    );

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// 👇 НИЖЕ — существующая функция, которую НЕ трогаем

function getPeriodKey_(type) {
  var now = new Date(); var tz = "Europe/Moscow";
  if (type === "daily") return Utilities.formatDate(now, tz, "yyyy-MM-dd");
  if (type === "monthly") return Utilities.formatDate(now, tz, "yyyy-MM");
  var d = new Date(now); var day = d.getDay() || 7; d.setDate(d.getDate() + 4 - day);
  var yearStart = new Date(d.getFullYear(), 0, 1);
  var weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return d.getFullYear() + "-W" + (weekNo < 10 ? "0" : "") + weekNo;
}

function getXPProfile_(userName) {
  var clean = String(userName || "").trim();
  var todayKey = getPeriodKey_("daily"); var weekKey = getPeriodKey_("weekly");
  var rows = supabaseRequest_('xp_profiles?user_name=eq.' + encodeURIComponent(clean), { method: 'get' });
  var profile = (rows && rows.length) ? rows[0] : null;
  if (!profile) { profile = { total_xp: 0, level: 0, xp_today: 0, xp_week: 0, streak: 0, exact_scores: 0, total_predictions: 0 }; }
  var xpToday = (profile.last_reset_date === todayKey) ? (Number(profile.xp_today) || 0) : 0;
  var xpWeek  = (profile.last_reset_week === weekKey)  ? (Number(profile.xp_week)  || 0) : 0;
  var totalXP = Math.max(0, Number(profile.total_xp) || 0); var level = Math.max(0, Number(profile.level) || 0);
  var curLevelMinXP = xpForLevel_(level); var nextLevelMinXP = xpForLevel_(level + 1);
  var xpInLevel = totalXP - curLevelMinXP; var xpLevelSpan = nextLevelMinXP - curLevelMinXP;
  var xpToNext = nextLevelMinXP - totalXP; var pct = xpLevelSpan > 0 ? Math.min(100, Math.round((xpInLevel / xpLevelSpan) * 100)) : 100;
  var titleData = getLevelTitle_(level);
  return { totalXP: totalXP, level: level, levelTitle: titleData.title, levelIcon: titleData.icon, xpToday: xpToday, xpWeek: xpWeek, streak: Number(profile.streak) || 0, exactScores: Number(profile.exact_scores) || 0, totalPredictions: Number(profile.total_predictions) || 0, curLevelMinXP: curLevelMinXP, nextLevelMinXP: nextLevelMinXP, xpInLevel: xpInLevel, xpLevelSpan: xpLevelSpan, xpToNext: xpToNext, pct: pct };
}

function addXP_(userName, amount, reason) {
  if (!userName || !amount) return null;
  var clean = String(userName).trim();
  var todayKey = getPeriodKey_("daily"); var weekKey = getPeriodKey_("weekly");
  var rows = supabaseRequest_('xp_profiles?user_name=eq.' + encodeURIComponent(clean), { method: 'get', noCache: true });
  var profile = (rows && rows.length) ? rows[0] : null;
  var totalXP = profile ? Number(profile.total_xp) || 0 : 0; var oldLevel = profile ? Number(profile.level) || 0 : 0;
  var xpBalance = profile && profile.xp_balance != null ? Number(profile.xp_balance) : totalXP; // 🔥 NEW
  var xpToday = (profile && profile.last_reset_date === todayKey) ? (Number(profile.xp_today) || 0) : 0;
  var xpWeek  = (profile && profile.last_reset_week === weekKey)  ? (Number(profile.xp_week)  || 0) : 0;
  var streak = profile ? Number(profile.streak) || 0 : 0; var lastPred = profile ? String(profile.last_prediction_day || "") : "";
  var predsCount = profile ? Number(profile.total_predictions) || 0 : 0; var exactCount = profile ? Number(profile.exact_scores) || 0 : 0;
  var actualAmount = amount; var extraXP = 0;
  if (reason === "prediction") {
    if (lastPred !== todayKey) { var yest = new Date(); yest.setDate(yest.getDate() - 1); var yKey = Utilities.formatDate(yest, "Europe/Moscow", "yyyy-MM-dd"); if (lastPred === yKey) streak += 1; else streak = 1; lastPred = todayKey; actualAmount = 10; } else { actualAmount = 5; }
    predsCount += 1;
  }
  if (reason === "exactScore") exactCount += 1;
  var totalAdd = actualAmount + extraXP;
  totalXP += totalAdd;
  xpToday += totalAdd;
  xpWeek  += totalAdd;
  xpBalance += totalAdd; // 🔥 NEW — пополняем «кошелёк»
  var newLevel = calcLevel_(totalXP); var leveledUp = newLevel > oldLevel;
  var payload = {
    user_name: clean, total_xp: totalXP, level: newLevel,
    xp_balance: xpBalance, // 🔥 NEW
    xp_today: xpToday, xp_week: xpWeek,
    last_reset_date: todayKey, last_reset_week: weekKey,
    streak: streak, last_prediction_day: lastPred,
    total_predictions: predsCount, exact_scores: exactCount,
    updated_at: new Date().toISOString()
  };
  supabaseRequest_('xp_profiles?on_conflict=user_name', { method: 'post', body: [payload], prefer: 'return=minimal,resolution=merge-duplicates' });
  return { totalXP: totalXP, level: newLevel, leveledUp: leveledUp, xpGained: totalAdd, streakBonus: extraXP, streak: streak, balance: xpBalance };
}

function wasXPAwarded_(userName, matchKey, reason) {
  try { var clean = String(userName).trim(); var rows = supabaseRequest_('xp_logs?user_name=eq.' + encodeURIComponent(clean) + '&match_key=eq.' + encodeURIComponent(matchKey) + '&reason=eq.' + encodeURIComponent(reason), { method: 'get' }); return (rows && rows.length > 0); } catch(e) { return false; }
}

function logXPAward_(userName, matchKey, reason, xp) {
  try { supabaseRequest_('xp_logs?on_conflict=user_name,match_key,reason', { method: 'post', body: [{ user_name: userName, match_key: matchKey, reason: reason, xp: xp }], prefer: 'return=minimal,resolution=ignore-duplicates' }); } catch(e) {}
}

function getTaskTemplates_() {
  var cache = CacheService.getScriptCache(); var cacheKey = 'tpl_' + getCacheVersion_('task_templates');
  var cached = cache.get(cacheKey); if (cached) { try { return JSON.parse(cached); } catch (e) {} }
  var rows = supabaseRequest_('task_templates?is_active=eq.true', { method: 'get' }) || [];
  var result = rows.map(function(r) { return { id: String(r.id).trim(), title: String(r.title || ""), description: String(r.description || ""), periodType: String(r.period_type || "daily"), target: Number(r.target) || 1, xpReward: Number(r.xp_reward) || 0, icon: String(r.icon || "🎯") }; });
  try { var s = JSON.stringify(result); if (s.length < 95000) cache.put(cacheKey, s, 300); } catch (e) {}
  return result;
}

function bumpTasks_(userName, event) {
  var templates = getTaskTemplates_();
  var mapping = { prediction: ["daily_1_prediction", "daily_3_predictions", "weekly_10_predictions", "monthly_50_predictions"], outcomeHit: ["daily_1_outcome", "weekly_5_outcomes"], diffHit: [], exactScore: ["daily_1_exact", "weekly_3_exact", "monthly_10_exact"], bothScoredTrigger: ["weekly_both_scored"] };
  var affected = mapping[event] || []; var cleanUser = String(userName).trim();
  affected.forEach(function(taskId) {
    var tpl = templates.filter(function(t){ return t.id === taskId; })[0]; if (!tpl) return;
    var periodKey = getPeriodKey_(tpl.periodType);
    var rows = supabaseRequest_('tasks_progress?user_name=eq.' + encodeURIComponent(cleanUser) + '&task_id=eq.' + encodeURIComponent(taskId) + '&period_key=eq.' + encodeURIComponent(periodKey), { method: 'get' });
    var currentProgress = 0, currentClaimed = false; if (rows && rows.length) { currentProgress = Number(rows[0].progress) || 0; currentClaimed = !!rows[0].claimed; }
    if (currentProgress >= tpl.target) return;
    var newProgress = currentProgress + 1; var completed = newProgress >= tpl.target;
    supabaseRequest_('tasks_progress?on_conflict=user_name,task_id,period_key', { method: 'post', body: [{ user_name: cleanUser, task_id: taskId, period_type: tpl.periodType, period_key: periodKey, progress: newProgress, target: tpl.target, completed: completed, claimed: currentClaimed, xp_reward: tpl.xpReward, updated_at: new Date().toISOString() }], prefer: 'return=minimal,resolution=merge-duplicates' });
  });
}

function bumpTaskLeagues_(userName, leagueCode) {
  var taskId = "daily_3_leagues"; var tpl = getTaskTemplates_().filter(function(t){ return t.id === taskId; })[0]; if (!tpl) return;
  var periodKey = getPeriodKey_("daily");
  var rows = supabaseRequest_('tasks_progress?user_name=eq.' + encodeURIComponent(userName) + '&task_id=eq.' + taskId + '&period_key=eq.' + periodKey, { method:'get' });
  var row = (rows && rows[0]) || { progress: 0, leagues: [] }; var leagues = Array.isArray(row.leagues) ? row.leagues.slice() : [];
  if (leagues.indexOf(leagueCode) === -1) leagues.push(leagueCode);
  var progress = leagues.length; var completed = progress >= tpl.target;
  supabaseRequest_('tasks_progress?on_conflict=user_name,task_id,period_key', { method: 'post', body: [{ user_name: userName, task_id: taskId, period_type: tpl.periodType, period_key: periodKey, progress: progress, target: tpl.target, completed: completed, claimed: !!row.claimed, xp_reward: tpl.xpReward, updated_at: new Date().toISOString(), leagues: leagues }], prefer: 'return=minimal,resolution=merge-duplicates' });
}

function checkBothScoredTask_(userName, realScore) {
  var m = String(realScore || "").match(/^(\d+)-(\d+)$/); if (!m) return;
  var home = Number(m[1]), away = Number(m[2]); if (home === 0 || away === 0) return;
  bumpTasks_(userName, "bothScoredTrigger");
}

var XP_ACHIEVEMENTS = { level_5: { code: "level_5", name: "🎓 Знаток (5 ур.)" }, level_10: { code: "level_10", name: "🧠 Эксперт (10 ур.)" }, streak_3: { code: "streak_3", name: "🔥 3 дня подряд" }, streak_7: { code: "streak_7", name: "🔥 Неделя без пропусков" }, streak_30: { code: "streak_30", name: "💎 Месяц подряд" }, exact_10: { code: "exact_10", name: "🎪 10 точных счётов" }, exact_50: { code: "exact_50", name: "🏹 Снайпер (50 точных)" }, predictions_100: { code: "predictions_100", name: "💯 100 прогнозов" } };

function checkStreakAchievements_(userName) {
  var profile = getXPProfile_(userName); var toAdd = [];
  if (profile.streak >= 3) toAdd.push(XP_ACHIEVEMENTS.streak_3);
  if (profile.streak >= 7) toAdd.push(XP_ACHIEVEMENTS.streak_7);
  if (profile.streak >= 30) toAdd.push(XP_ACHIEVEMENTS.streak_30);
  if (profile.exactScores >= 10) toAdd.push(XP_ACHIEVEMENTS.exact_10);
  if (profile.exactScores >= 50) toAdd.push(XP_ACHIEVEMENTS.exact_50);
  if (profile.totalPredictions >= 100) toAdd.push(XP_ACHIEVEMENTS.predictions_100);
  if (profile.level >= 5) toAdd.push(XP_ACHIEVEMENTS.level_5);
  if (profile.level >= 10) toAdd.push(XP_ACHIEVEMENTS.level_10);
  if (!toAdd.length) return;
  var existing = getUserAchievements(userName).map(function(a){ return a.code; });
  toAdd.forEach(function(a) { if (existing.indexOf(a.code) === -1) { try { supabaseRequest_('achievements?on_conflict=user_name,code', { method: 'post', body: [{ user_name: userName, code: a.code, name: a.name }], prefer: 'return=minimal,resolution=merge-duplicates' }); } catch(e) {} } });
}

function getTasksWithProgress_(userName) {
  var templates = getTaskTemplates_();
  var dailyKey = getPeriodKey_("daily"); var weeklyKey = getPeriodKey_("weekly"); var monthlyKey = getPeriodKey_("monthly");
  var progressRows = supabaseRequest_('tasks_progress?user_name=eq.' + encodeURIComponent(userName), { method: 'get' }) || [];
  var progressMap = {}; progressRows.forEach(function(r) { progressMap[r.task_id + '||' + r.period_key] = r; });
  var result = { daily: [], weekly: [], monthly: [] };
  templates.forEach(function(tpl) {
    var key = tpl.periodType === "daily" ? dailyKey : tpl.periodType === "weekly" ? weeklyKey : monthlyKey;
    var p = progressMap[tpl.id + '||' + key];
    var progress = p ? Number(p.progress) || 0 : 0; var completed = p ? !!p.completed : false; var claimed = p ? !!p.claimed : false;
    var item = { id: tpl.id, title: tpl.title, description: tpl.description, icon: tpl.icon, target: tpl.target, progress: progress, completed: completed, claimed: claimed, xpReward: tpl.xpReward, pct: Math.min(100, Math.round((progress / tpl.target) * 100)) };
    if (result[tpl.periodType]) result[tpl.periodType].push(item);
  });
  return result;
}

function miniApp_getGamification(chatId, userName) {
  try { var clean = String(userName || "").trim(); var profile = getXPProfile_(clean); var tasks = getTasksWithProgress_(clean); return { ok: true, profile: profile, tasks: tasks }; } catch (e) { return { ok: false, error: e.message }; }
}

function miniApp_claimTask(chatId, userName, taskId) {
  try {
    var clean = String(userName || "").trim(); var templates = getTaskTemplates_(); var tpl = templates.filter(function(t){ return t.id === taskId; })[0];
    if (!tpl) return { ok: false, error: "Задание не найдено" };
    var key = getPeriodKey_(tpl.periodType);
    var rows = supabaseRequest_('tasks_progress?user_name=eq.' + encodeURIComponent(clean) + '&task_id=eq.' + encodeURIComponent(taskId) + '&period_key=eq.' + encodeURIComponent(key), { method: 'get', noCache: true });
    if (!rows || !rows.length) return { ok: false, error: "Нет прогресса" };
    var row = rows[0];
    if (!row.completed) return { ok: false, error: "Задание не выполнено" };
    if (row.claimed) return { ok: false, error: "Награда уже получена" };
    supabaseRequest_('tasks_progress?id=eq.' + row.id, { method: 'patch', body: { claimed: true, updated_at: new Date().toISOString() }, prefer: 'return=minimal' });
    var xpResult = addXP_(clean, tpl.xpReward, "taskClaim");
    return { ok: true, xp: xpResult, xpReward: tpl.xpReward };
  } catch (e) { return { ok: false, error: e.message }; }
}

function setWebhook() {
  const url = "https://api.telegram.org/bot" + TOKEN + "/setWebhook";
  const response = UrlFetchApp.fetch(url, { method: "post", contentType: "application/json", payload: JSON.stringify({ url: getWebAppUrl() || WEBAPP_URL_HARDCODED, drop_pending_updates: true, allowed_updates: ["message", "callback_query"] }), muteHttpExceptions: true });
  Logger.log("Webhook set: " + response.getContentText());
}

function deleteWebhook() {
  const url = "https://api.telegram.org/bot" + TOKEN + "/deleteWebhook";
  const response = UrlFetchApp.fetch(url, { method: "post", muteHttpExceptions: true });
  Logger.log("Webhook deleted: " + response.getContentText());
}

function setup() {
  saveWebAppUrl();
  setWebhook();
  Logger.log("Setup complete");
}

// ============================================================
//  ADMIN_* ФУНКЦИИ
// ============================================================
function logAdminEvent_(type, message) {
  try {
    var props = PropertiesService.getScriptProperties(); var raw = props.getProperty('ADMIN_EVENTS_V1');
    var arr = raw ? JSON.parse(raw) : [];
    arr.unshift({ ts: new Date().toISOString(), type: type, message: String(message).substring(0, 200) });
    arr = arr.slice(0, 30); var s = JSON.stringify(arr); if (s.length < 9000) props.setProperty('ADMIN_EVENTS_V1', s);
  } catch (e) {}
}

function getAdminEvents_() {
  try { var raw = PropertiesService.getScriptProperties().getProperty('ADMIN_EVENTS_V1'); return raw ? JSON.parse(raw) : []; } catch (e) { return []; }
}

function admin_getBootstrap(key, chatId, initData) {
  requireAdmin_(key, chatId, initData);
  try {
    var sbOk = 'ok'; var usersCount = 0, predsCount = 0, matchesCount = 0, scoredCount = 0, preds24h = 0, active7d = 0;
    try {
      var u = supabaseRequest_('users?select=user_name', { method: 'get', noCache: true }); usersCount = (u || []).length;
      var p = supabaseRequest_('predictions?select=id', { method: 'get', noCache: true }); predsCount = (p || []).length;
      var m = supabaseRequest_('matches?select=id', { method: 'get', noCache: true }); matchesCount = (m || []).length;
      var ms = supabaseRequest_('matches?real_score=not.is.null&select=id', { method: 'get', noCache: true }); scoredCount = (ms || []).length;
      var cutoff24h = new Date(Date.now() - 24*60*60*1000).toISOString(); var cutoff7d  = new Date(Date.now() - 7*24*60*60*1000).toISOString();
      var p24 = supabaseRequest_('predictions?select=id&saved_at=gte.' + encodeURIComponent(cutoff24h), { method: 'get', noCache: true }); preds24h = (p24 || []).length;
      var p7 = supabaseRequest_('predictions?select=user_name&saved_at=gte.' + encodeURIComponent(cutoff7d), { method: 'get', noCache: true });
      var uniq = {}; (p7 || []).forEach(function(r) { if (r.user_name) uniq[r.user_name] = true; }); active7d = Object.keys(uniq).length;
    } catch (e) { sbOk = e.message || String(e); }
    var triggers = [];
    try { ScriptApp.getProjectTriggers().forEach(function(t) { triggers.push({ fn: t.getHandlerFunction(), type: String(t.getEventType()), id: t.getUniqueId() }); }); } catch (e) {}
    var chain = null;
    try { var raw = PropertiesService.getScriptProperties().getProperty('UPDATE_ALL_STATE_V1'); if (raw) chain = JSON.parse(raw); } catch (e) {}
    var webhookStatus = 'unknown', webhookError = '';
    try {
      var whRes = UrlFetchApp.fetch('https://api.telegram.org/bot' + TOKEN + '/getWebhookInfo', { muteHttpExceptions: true });
      var whData = JSON.parse(whRes.getContentText());
      if (whData.ok && whData.result) { if (whData.result.url) webhookStatus = 'ok'; else webhookStatus = 'no url'; webhookError = whData.result.last_error_message || ''; }
    } catch (e) { webhookStatus = 'err'; }
    return { ok: true, status: { supabase: sbOk, triggers: triggers.length, triggersList: triggers, chain: chain, webhook: webhookStatus, webhookError: webhookError }, metrics: { users: usersCount, predictions: predsCount, matches: matchesCount, scoredMatches: scoredCount, preds24h: preds24h, active7d: active7d }, events: getAdminEvents_() };
  } catch (e) { return { ok: false, error: e.message }; }
}

function admin_getUsers(key, chatId, initData, page, search) {
  requireAdmin_(key, chatId, initData);
  try {
    page = Math.max(1, parseInt(page, 10) || 1); var limit = 30; var offset = (page - 1) * limit;
    var searchPart = '';
    if (search && String(search).trim()) { searchPart = '&or=(user_name.ilike.*' + encodeURIComponent(search) + '*,first_name.ilike.*' + encodeURIComponent(search) + '*,username.ilike.*' + encodeURIComponent(search) + '*)'; }
    var users = supabaseRequest_('users?select=user_name,chat_id,first_name,last_name,username' + searchPart + '&order=user_name.asc&limit=' + limit + '&offset=' + offset, { method: 'get', noCache: true }) || [];
    var names = users.map(function(u) { return u.user_name; }); var stats = {}, xps = {};
    if (names.length) {
      try { var predsRows = supabaseRequest_('predictions?user_name=in.(' + names.map(encodeURIComponent).join(',') + ')&select=user_name', { method: 'get', noCache: true }) || []; predsRows.forEach(function(p) { stats[p.user_name] = (stats[p.user_name] || 0) + 1; }); } catch (e) {}
      try { var upRows = supabaseRequest_('user_points?user_name=in.(' + names.map(encodeURIComponent).join(',') + ')&select=user_name,total_points', { method: 'get', noCache: true }) || []; upRows.forEach(function(r) { stats[r.user_name + '_pts'] = Number(r.total_points) || 0; }); } catch (e) {}
      try { var xpRows = supabaseRequest_('xp_profiles?user_name=in.(' + names.map(encodeURIComponent).join(',') + ')&select=user_name,total_xp,level,streak', { method: 'get', noCache: true }) || []; xpRows.forEach(function(r) { xps[r.user_name] = r; }); } catch (e) {}
    }
    var list = users.map(function(u) { return { userName: u.user_name, chatId: u.chat_id, firstName: u.first_name || '', lastName: u.last_name || '', username: u.username || '', preds: stats[u.user_name] || 0, points: stats[u.user_name + '_pts'] || 0, xp: xps[u.user_name] ? Number(xps[u.user_name].total_xp) || 0 : 0, level: xps[u.user_name] ? Number(xps[u.user_name].level) || 0 : 0, streak: xps[u.user_name] ? Number(xps[u.user_name].streak) || 0 : 0 }; });
    return { ok: true, users: list, page: page, hasMore: users.length === limit };
  } catch (e) { return { ok: false, error: e.message }; }
}

function admin_getUserDetail(key, chatId, initData, userName) {
  requireAdmin_(key, chatId, initData);
  try {
    var clean = String(userName || '').trim(); if (!clean) return { ok: false, error: 'Не указано имя' };
    var users = supabaseRequest_('users?user_name=eq.' + encodeURIComponent(clean), { method: 'get', noCache: true }) || []; var u = users[0] || {};
    var preds = supabaseRequest_('predictions?user_name=eq.' + encodeURIComponent(clean) + '&select=id', { method: 'get', noCache: true }) || [];
    var ratingRows = supabaseRequest_('user_points?user_name=eq.' + encodeURIComponent(clean), { method: 'get', noCache: true }) || []; var points = ratingRows[0] ? Number(ratingRows[0].total_points) || 0 : 0;
    var xp = getXPProfile_(clean); var achs = getUserAchievements(clean); var place = '-';
    try { var all = buildRatingFromSupabase_(); for (var i = 0; i < all.length; i++) { if (all[i].name === clean) { place = i + 1; break; } } } catch (e) {}
    return { ok: true, user: { userName: clean, chatId: u.chat_id || null, firstName: u.first_name || '', lastName: u.last_name || '', username: u.username || '', preds: preds.length, points: points, place: place, xp: xp, achievements: achs } };
  } catch (e) { return { ok: false, error: e.message }; }
}

function admin_recalcUser(key, chatId, initData, userName) {
  requireAdmin_(key, chatId, initData);
  try { recalcUserPoints_(userName); checkStreakAchievements_(userName); logAdminEvent_('ok', 'Пересчёт для ' + userName); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
}

function admin_getMatches(key, chatId, initData, league, tour) {
  requireAdmin_(key, chatId, initData);
  try {
    var filter = '';
    if (league && league !== 'all') { filter += '&league_code=eq.' + encodeURIComponent(league); }
    if (tour && String(tour).trim()) { filter += '&tour_num=eq.' + parseInt(tour, 10); }
    var rows = supabaseRequest_('matches?select=id,league_code,tour_num,match_name,match_norm,real_score,utc_date,winner' + filter + '&order=utc_date.desc&limit=100', { method: 'get', noCache: true }) || [];
    var matchNorms = rows.map(function(r) { return r.match_norm; }); var predCounts = {};
    if (matchNorms.length) {
      try { for (var i = 0; i < matchNorms.length; i += 20) { var ch = matchNorms.slice(i, i + 20); var ps = supabaseRequest_('predictions?match_norm=in.(' + ch.map(encodeURIComponent).join(',') + ')&select=id,match_norm', { method: 'get', noCache: true }) || []; ps.forEach(function(p) { predCounts[p.match_norm] = (predCounts[p.match_norm] || 0) + 1; }); } } catch (e) {}
    }
    var list = rows.map(function(r) {
      var timeStr = ''; if (r.utc_date) { try { timeStr = Utilities.formatDate(new Date(r.utc_date), 'Europe/Moscow', 'dd.MM HH:mm'); } catch (e) {} }
      return { id: r.id, leagueCode: r.league_code, leagueName: LEAGUES[r.league_code] ? LEAGUES[r.league_code].name : r.league_code, tourNum: r.tour_num, matchName: r.match_name, matchNorm: r.match_norm, realScore: r.real_score || null, winner: r.winner || null, timeStr: timeStr, utcDate: r.utc_date, predCount: predCounts[r.match_norm] || 0 };
    });
    return { ok: true, matches: list };
  } catch (e) { return { ok: false, error: e.message }; }
}

function admin_saveMatchScore(key, chatId, initData, matchId, newScore) {
  requireAdmin_(key, chatId, initData);
  try {
    var score = String(newScore || '').trim().replace(/\s/g, '').replace(/:/g, '-'); if (!/^\d+-\d+$/.test(score)) return { ok: false, error: 'Неверный формат счёта. Ожидается X-Y' };
    var m = score.match(/^(\d+)-(\d+)$/); var h = Number(m[1]), a = Number(m[2]); var winner = h > a ? 'П1' : (h < a ? 'П2' : 'Ничья');
    supabaseRequest_('matches?id=eq.' + parseInt(matchId, 10), { method: 'patch', body: { real_score: score, winner: winner }, prefer: 'return=minimal' });
    var matchRow = supabaseRequest_('matches?id=eq.' + parseInt(matchId, 10) + '&select=league_code,match_norm', { method: 'get', noCache: true }) || [];
    if (matchRow.length) {
      var lc = matchRow[0].league_code; var mn = matchRow[0].match_norm;
      var preds = supabaseRequest_('predictions?league_code=eq.' + encodeURIComponent(lc) + '&match_norm=eq.' + encodeURIComponent(mn) + '&select=user_name', { method: 'get', noCache: true }) || [];
      var affected = {}; preds.forEach(function(p) { if (p.user_name) affected[p.user_name] = true; }); recalcUserPointsBatch_(Object.keys(affected));
    }
    logAdminEvent_('ok', 'Счёт матча #' + matchId + ' → ' + score);
    return { ok: true };
  } catch (e) { logAdminEvent_('err', 'Ошибка сохранения счёта: ' + e.message); return { ok: false, error: e.message }; }
}

function admin_getMatchPredictions(key, chatId, initData, leagueCode, matchNorm) {
  requireAdmin_(key, chatId, initData);
  try {
    var preds = supabaseRequest_('predictions?league_code=eq.' + encodeURIComponent(leagueCode) + '&match_norm=eq.' + encodeURIComponent(matchNorm) + '&order=user_name.asc', { method: 'get', noCache: true }) || [];
    var matchRow = supabaseRequest_('matches?league_code=eq.' + encodeURIComponent(leagueCode) + '&match_norm=eq.' + encodeURIComponent(matchNorm) + '&limit=1', { method: 'get', noCache: true }) || [];
    var realScore = matchRow[0] ? matchRow[0].real_score : null;
    var list = preds.map(function(p) { var pts = null; if (realScore) { pts = calcPointsForPrediction_(p.outcome, p.score, realScore).points; } return { id: p.id, userName: p.user_name, outcome: p.outcome, score: p.score, points: pts }; });
    return { ok: true, predictions: list, realScore: realScore };
  } catch (e) { return { ok: false, error: e.message }; }
}

function admin_getPredictions(key, chatId, initData, page, search) {
  requireAdmin_(key, chatId, initData);
  try {
    page = Math.max(1, parseInt(page, 10) || 1); var limit = 30; var offset = (page - 1) * limit;
    var filter = '';
    if (search && String(search).trim()) { filter = '&or=(user_name.ilike.*' + encodeURIComponent(search) + '*,match_name.ilike.*' + encodeURIComponent(search) + '*)'; }
    var rows = supabaseRequest_('predictions?select=id,user_name,league_code,match_name,match_norm,outcome,score,saved_at' + filter + '&order=saved_at.desc&limit=' + limit + '&offset=' + offset, { method: 'get', noCache: true }) || [];
    var list = rows.map(function(p) { return { id: p.id, userName: p.user_name, leagueCode: p.league_code, leagueName: LEAGUES[p.league_code] ? LEAGUES[p.league_code].name : p.league_code, matchName: p.match_name, outcome: p.outcome, score: p.score, savedAt: p.saved_at }; });
    return { ok: true, predictions: list, page: page, hasMore: rows.length === limit };
  } catch (e) { return { ok: false, error: e.message }; }
}

function admin_deletePrediction(key, chatId, initData, predId) {
  requireAdmin_(key, chatId, initData);
  try {
    var row = supabaseRequest_('predictions?id=eq.' + parseInt(predId, 10) + '&select=user_name', { method: 'get', noCache: true }); var user = row && row[0] ? row[0].user_name : null;
    supabaseRequest_('predictions?id=eq.' + parseInt(predId, 10), { method: 'delete', prefer: 'return=minimal' });
    if (user) recalcUserPoints_(user);
    logAdminEvent_('ok', 'Удалён прогноз #' + predId);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

function admin_editPrediction(key, chatId, initData, predId, outcome, score) {
  requireAdmin_(key, chatId, initData);
  try {
    var cleanScore = String(score || '').replace(/\s/g, '').replace(/:/g, '-'); if (!/^\d+-\d+$/.test(cleanScore)) return { ok: false, error: 'Неверный формат счёта' };
    var row = supabaseRequest_('predictions?id=eq.' + parseInt(predId, 10) + '&select=user_name', { method: 'get', noCache: true }); var user = row && row[0] ? row[0].user_name : null;
    supabaseRequest_('predictions?id=eq.' + parseInt(predId, 10), { method: 'patch', body: { outcome: outcome, score: cleanScore }, prefer: 'return=minimal' });
    if (user) recalcUserPoints_(user);
    logAdminEvent_('ok', 'Изменён прогноз #' + predId);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

function admin_startUpdate(key, chatId, initData) {
  requireAdmin_(key, chatId, initData);
  try { updateAllLeagues(); logAdminEvent_('ok', 'Запущено обновление лиг'); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
}

function admin_runSync(key, chatId, initData) {
  requireAdmin_(key, chatId, initData);
  try {
    var r = syncMatchesToSupabase();
    logAdminEvent_('ok', 'Sync: matches=' + r.matches + ' preds=' + r.preds);
    return { ok: true, matches: r.matches, preds: r.preds };
  } catch (e) {
    logAdminEvent_('err', 'Sync: ' + e.message);
    return { ok: false, error: e.message };
  }
}

function admin_rebuildUserPoints(key, chatId, initData) {
  requireAdmin_(key, chatId, initData);
  try { rebuildAllUserPoints_(); logAdminEvent_('ok', 'Пересчёт всех user_points'); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
}

function admin_checkConnection(key, chatId, initData) {
  requireAdmin_(key, chatId, initData);
  try { supabaseRequest_('users?limit=1', { method: 'get', noCache: true }); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
}

function admin_getChainStatus(key, chatId, initData) {
  requireAdmin_(key, chatId, initData);
  try { var raw = PropertiesService.getScriptProperties().getProperty('UPDATE_ALL_STATE_V1'); var chain = raw ? JSON.parse(raw) : null; return { ok: true, chain: chain }; } catch (e) { return { ok: false, error: e.message }; }
}

function admin_resetChain(key, chatId, initData) {
  requireAdmin_(key, chatId, initData);
  try { PropertiesService.getScriptProperties().deleteProperty('UPDATE_ALL_STATE_V1'); logAdminEvent_('warn', 'Цепочка обновления сброшена'); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
}

function admin_continueChain(key, chatId, initData) {
  requireAdmin_(key, chatId, initData);
  try { processNextUpdateStep(); logAdminEvent_('ok', 'Продолжение цепочки обновления'); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
}

function admin_getTriggers(key, chatId, initData) {
  requireAdmin_(key, chatId, initData);
  try { var list = ScriptApp.getProjectTriggers().map(function(t) { return { id: t.getUniqueId(), fn: t.getHandlerFunction(), type: String(t.getEventType()) }; }); return { ok: true, triggers: list }; } catch (e) { return { ok: false, error: e.message }; }
}

function admin_deleteAllTriggers(key, chatId, initData) {
  requireAdmin_(key, chatId, initData);
  try { ScriptApp.getProjectTriggers().forEach(function(t) { try { ScriptApp.deleteTrigger(t); } catch (e) {} }); logAdminEvent_('warn', 'Все триггеры удалены'); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
}

function admin_recreateTriggers(key, chatId, initData) {
  requireAdmin_(key, chatId, initData);
  try { try { setupNotifyTriggers(); } catch (e) {} try { createAllTriggers(); } catch (e) {} logAdminEvent_('ok', 'Триггеры пересозданы'); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
}

function admin_clearCache(key, chatId, initData) {
  requireAdmin_(key, chatId, initData);
  try { ['predictions','matches','users','achievements','subscriptions','xp_profiles','tasks_progress','xp_logs','user_points','task_templates','global'].forEach(function(t) { bumpCacheVersion_(t); }); try { CacheService.getScriptCache().remove('teamsMap_v2'); } catch (e) {} logAdminEvent_('ok', 'Кэш очищен'); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
}

function admin_broadcast(key, chatId, initData, target, text) {
  requireAdmin_(key, chatId, initData);
  try {
    var msg = String(text || '').trim(); if (!msg || msg.length > 4000) return { ok: false, error: 'Текст пустой или слишком длинный' };
    var userChats = getUserChats_(); var allNames = Object.keys(userChats); var recipients = [];
    if (target === 'all') { recipients = allNames; } else if (target === 'with_preds') {
      var preds = supabaseRequest_('predictions?select=user_name', { method: 'get', noCache: true }) || [];
      var withPreds = {}; preds.forEach(function(p) { if (p.user_name) withPreds[p.user_name] = true; });
      recipients = allNames.filter(function(n) { return withPreds[n]; });
    }
    var sent = 0, failed = 0;
    for (var i = 0; i < recipients.length; i++) {
      var u = recipients[i]; var result = sendText(userChats[u], msg, null);
      if (result && result.ok) sent++; else failed++;
      if (i % 20 === 19) Utilities.sleep(1000);
    }
    logAdminEvent_('ok', 'Рассылка: ' + sent + '/' + recipients.length);
    return { ok: true, sent: sent, failed: failed, total: recipients.length };
  } catch (e) { return { ok: false, error: e.message }; }
}

function admin_getBroadcastStats(key, chatId, initData) {
  requireAdmin_(key, chatId, initData);
  try {
    var userChats = getUserChats_(); var total = Object.keys(userChats).length;
    var preds = supabaseRequest_('predictions?select=user_name', { method: 'get', noCache: true }) || [];
    var withPreds = {}; preds.forEach(function(p) { if (p.user_name) withPreds[p.user_name] = true; });
    return { ok: true, total: total, withPreds: Object.keys(withPreds).length };
  } catch (e) { return { ok: false, error: e.message }; }
}

function admin_getAnalytics(key, chatId, initData, days) {
  requireAdmin_(key, chatId, initData);
  try {
    days = parseInt(days, 10) || 7; var cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    var preds = supabaseRequest_('predictions?select=user_name,league_code,saved_at&saved_at=gte.' + encodeURIComponent(cutoff), { method: 'get', noCache: true }) || [];
    var byDay = {}, byUser = {}, byLeague = {};
    preds.forEach(function(p) {
      if (p.saved_at) { var d = new Date(p.saved_at); var dayKey = Utilities.formatDate(d, 'Europe/Moscow', 'yyyy-MM-dd'); byDay[dayKey] = (byDay[dayKey] || 0) + 1; }
      if (p.user_name) byUser[p.user_name] = (byUser[p.user_name] || 0) + 1;
      if (p.league_code) byLeague[p.league_code] = (byLeague[p.league_code] || 0) + 1;
    });
    var top = [];
    try { var userPoints = supabaseRequest_('user_points?select=user_name,total_points&order=total_points.desc&limit=5', { method: 'get', noCache: true }) || []; top = userPoints.map(function(r) { return { name: r.user_name, points: Number(r.total_points) || 0 }; }); } catch (e) {}
    return { ok: true, days: days, totalPredictions: preds.length, byDay: byDay, byUser: byUser, byLeague: byLeague, top: top };
  } catch (e) { return { ok: false, error: e.message }; }
}

function DIAGNOSE_ADMIN() {
  Logger.log('═══════════════ ДИАГНОСТИКА ═══════════════');
  Logger.log('1. getService().getUrl(): ' + ScriptApp.getService().getUrl());
  Logger.log('2. WEBAPP_URL: ' + PropertiesService.getScriptProperties().getProperty('WEBAPP_URL'));
  Logger.log('3. getWebAppUrl(): ' + getWebAppUrl());
  try { var wh = UrlFetchApp.fetch('https://api.telegram.org/bot' + TOKEN + '/getWebhookInfo', { muteHttpExceptions: true }); var whData = JSON.parse(wh.getContentText()).result || {}; Logger.log('4. WEBHOOK URL: ' + (whData.url || '—')); Logger.log('   Pending: ' + (whData.pending_update_count || 0)); Logger.log('   Last error: ' + (whData.last_error_message || '—')); } catch (e) { Logger.log('Webhook error: ' + e); }
  Logger.log('5. ADMIN_CHAT_ID: ' + ADMIN_CHAT_ID);
  Logger.log('6. ADMIN_SECRET: ' + (ADMIN_SECRET ? '*** (задан, длина ' + ADMIN_SECRET.length + ')' : 'НЕ ЗАДАН'));
  try { HtmlService.createTemplateFromFile('Admin'); Logger.log('7. ✅ Admin.html найден'); } catch (e) { Logger.log('7. ❌ Admin.html: ' + e.message); }
  Logger.log('═══════════════ КОНЕЦ ═══════════════');
}

// ============================================================
//  МАГАЗИН + БОКСЫ
// ============================================================

function spendXP_(userName, amount, reason) {
  var clean = String(userName || '').trim();
  if (!clean || !amount || amount <= 0) return { ok: false, error: 'Некорректная сумма' };
  var rows = supabaseRequest_('xp_profiles?user_name=eq.' + encodeURIComponent(clean), { method: 'get', noCache: true });
  var profile = (rows && rows.length) ? rows[0] : null;
  if (!profile) return { ok: false, error: 'Профиль не найден' };
  var balance = profile.xp_balance != null ? Number(profile.xp_balance) : (Number(profile.total_xp) || 0);
  if (balance < amount) return { ok: false, error: 'Недостаточно XP. Нужно ' + amount + ', у вас ' + balance };
  var newBalance = balance - amount;
  supabaseRequest_('xp_profiles?on_conflict=user_name', {
    method: 'post',
    body: [{ user_name: clean, xp_balance: newBalance, updated_at: new Date().toISOString() }],
    prefer: 'return=minimal,resolution=merge-duplicates'
  });
  try {
    supabaseRequest_('xp_logs?on_conflict=user_name,match_key,reason', {
      method: 'post',
      body: [{ user_name: clean, match_key: 'spend_' + Date.now(), reason: 'spend_' + (reason || 'shop'), xp: -amount }],
      prefer: 'return=minimal,resolution=ignore-duplicates'
    });
  } catch (e) {}
  return { ok: true, newBalance: newBalance, spent: amount };
}

function rollRarity_(weights) {
  var keys = Object.keys(weights); var total = 0;
  keys.forEach(function (k) { total += Number(weights[k]) || 0; });
  if (total <= 0) return keys[0];
  var r = Math.random() * total; var acc = 0;
  for (var i = 0; i < keys.length; i++) { acc += Number(weights[keys[i]]) || 0; if (r < acc) return keys[i]; }
  return keys[keys.length - 1];
}

function miniApp_getShop(chatId, userName) {
  try {
    var clean = String(userName || '').trim();
    var xp = getXPProfile_(clean);
    var balance = (xp && xp.totalXP) || 0;
    try {
      var rows = supabaseRequest_('xp_profiles?user_name=eq.' + encodeURIComponent(clean) + '&select=xp_balance', { method: 'get', noCache: true });
      if (rows && rows.length && rows[0].xp_balance != null) balance = Number(rows[0].xp_balance);
    } catch (e) {}
    var boxes = supabaseRequest_('box_types?is_active=eq.true&order=price_xp.asc', { method: 'get' }) || [];
    var cards = supabaseRequest_('user_cards?user_name=eq.' + encodeURIComponent(clean) + '&select=card_id,quantity', { method: 'get' }) || [];
    var totalCards = cards.reduce(function(s, c){ return s + (Number(c.quantity) || 0); }, 0);
    var uniqueCards = cards.length;
    var catalogCount = supabaseRequest_('cards_catalog?select=id&is_active=eq.true', { method: 'get' }) || [];
    return {
      ok: true, balance: balance,
      boxes: boxes.map(function (b) {
        return { code: b.code, name: b.name, emoji: b.emoji, price: b.price_xp, cardsPerBox: b.cards_per_box, weights: b.rarity_weights, canAfford: balance >= b.price_xp };
      }),
      stats: { balance: balance, totalCards: totalCards, uniqueCards: uniqueCards, catalogTotal: catalogCount.length, completionPct: catalogCount.length ? Math.round(uniqueCards / catalogCount.length * 100) : 0 }
    };
  } catch (e) { return { ok: false, error: e.message }; }
}

function miniApp_openBox(chatId, userName, boxCode) {
  try {
    var clean = String(userName || '').trim();
    var code  = String(boxCode || '').trim().toLowerCase();
    if (!clean || !code) return { ok: false, error: 'Неверные параметры' };
    if (!checkRateLimit_('box_' + clean, 20)) return { ok: false, error: 'Слишком часто. Подождите.' };

    var boxRows = supabaseRequest_('box_types?code=eq.' + encodeURIComponent(code) + '&is_active=eq.true', { method: 'get' });
    if (!boxRows || !boxRows.length) return { ok: false, error: 'Бокс не найден' };
    var box = boxRows[0];
    var price = Number(box.price_xp);

    var spend = spendXP_(clean, price, 'box_' + code);
    if (!spend.ok) return spend;

    var catalog = supabaseRequest_('cards_catalog?is_active=eq.true&select=id,name,position,club,country,country_code,ovr,rarity,image_url', { method: 'get' }) || [];
    var byRarity = {};
    catalog.forEach(function (c) { (byRarity[c.rarity] = byRarity[c.rarity] || []).push(c); });

    var weights = box.rarity_weights || { common: 55, rare: 30, epic: 12, legendary: 3 };
    var cardsPerBox = Number(box.cards_per_box) || 3;
    var received = [];
    for (var i = 0; i < cardsPerBox; i++) {
      var rarity = rollRarity_(weights);
      var pool = byRarity[rarity] || [];
      var attempts = 0;
      while (!pool.length && attempts < 5) { rarity = rollRarity_(weights); pool = byRarity[rarity] || []; attempts++; }
      if (!pool.length) pool = catalog;
      var pick = pool[Math.floor(Math.random() * pool.length)];
      received.push(pick);
    }

    for (var k = 0; k < received.length; k++) {
      var card = received[k];
      try {
        var existing = supabaseRequest_('user_cards?user_name=eq.' + encodeURIComponent(clean) + '&card_id=eq.' + card.id + '&select=id,quantity', { method: 'get', noCache: true });
        if (existing && existing.length) {
          supabaseRequest_('user_cards?id=eq.' + existing[0].id, { method: 'patch', body: { quantity: (Number(existing[0].quantity) || 0) + 1 }, prefer: 'return=minimal' });
        } else {
          supabaseRequest_('user_cards', { method: 'post', body: [{ user_name: clean, card_id: card.id, quantity: 1 }], prefer: 'return=minimal,resolution=ignore-duplicates' });
        }
      } catch (e) { Logger.log('save card err: ' + e); }
    }

    try {
      supabaseRequest_('box_openings', { method: 'post', body: [{ user_name: clean, box_code: code, card_ids: received.map(function(c){ return c.id; }), xp_spent: price }], prefer: 'return=minimal' });
    } catch (e) {}

    return {
      ok: true, newBalance: spend.newBalance, spent: price,
      cards: received.map(function (c) {
        return { id: c.id, name: c.name, position: c.position, club: c.club, country: c.country, countryCode: c.country_code, ovr: c.ovr, rarity: c.rarity, imageUrl: c.image_url };
      })
    };
  } catch (e) { Logger.log('openBox error: ' + e); return { ok: false, error: e.message }; }
}

/**
 * Ежедневный бесплатный бокс — 1 раз в 24 часа.
 * Не тратит XP, но даёт 1 случайную карточку.
 */
function miniApp_claimDailyBox(chatId, userName) {
  try {
    var clean = String(userName || '').trim();
    if (!clean) return { ok: false, error: 'Не указан пользователь' };

    var todayKey = getPeriodKey_('daily');
    
    // Проверяем, забирал ли уже
    var rows = supabaseRequest_(
      'xp_profiles?user_name=eq.' + encodeURIComponent(clean) + '&select=last_daily_box',
      { method: 'get', noCache: true }
    );
    var last = (rows && rows[0] && rows[0].last_daily_box) || null;
    
    if (last === todayKey) {
      return { ok: false, error: 'Сегодня уже забирали. Приходите завтра!', alreadyClaimed: true };
    }

    // Выбираем случайную карточку (по весам)
    var weights = { common: 60, rare: 25, epic: 10, legendary: 4, mythic: 1 };
    var catalog = supabaseRequest_(
      'cards_catalog?is_active=eq.true&select=id,name,position,club,country,country_code,ovr,rarity,image_url',
      { method: 'get' }
    ) || [];
    
    if (!catalog.length) return { ok: false, error: 'Каталог карточек пуст' };

    var byRarity = {};
    catalog.forEach(function(c) { (byRarity[c.rarity] = byRarity[c.rarity] || []).push(c); });

    var rarity = rollRarity_(weights);
    var pool = byRarity[rarity] || catalog;
    var card = pool[Math.floor(Math.random() * pool.length)];

    // Сохраняем карточку
    try {
      var existing = supabaseRequest_(
        'user_cards?user_name=eq.' + encodeURIComponent(clean) + '&card_id=eq.' + card.id + '&select=id,quantity',
        { method: 'get', noCache: true }
      );
      if (existing && existing.length) {
        supabaseRequest_('user_cards?id=eq.' + existing[0].id, {
          method: 'patch',
          body: { quantity: (Number(existing[0].quantity) || 0) + 1 },
          prefer: 'return=minimal'
        });
      } else {
        supabaseRequest_('user_cards', {
          method: 'post',
          body: [{ user_name: clean, card_id: card.id, quantity: 1 }],
          prefer: 'return=minimal,resolution=ignore-duplicates'
        });
      }
    } catch (e) { Logger.log('save daily card: ' + e); }

    // Отмечаем, что забрали
    supabaseRequest_('xp_profiles?on_conflict=user_name', {
      method: 'post',
      body: [{ user_name: clean, last_daily_box: todayKey, updated_at: new Date().toISOString() }],
      prefer: 'return=minimal,resolution=merge-duplicates'
    });

    // Лог
    try {
      supabaseRequest_('box_openings', {
        method: 'post',
        body: [{ user_name: clean, box_code: 'daily_free', card_ids: [card.id], xp_spent: 0 }],
        prefer: 'return=minimal'
      });
    } catch (e) {}

    return {
      ok: true,
      card: {
        id: card.id, name: card.name, position: card.position,
        club: card.club, country: card.country, countryCode: card.country_code,
        ovr: card.ovr, rarity: card.rarity, imageUrl: card.image_url
      }
    };
  } catch (e) {
    Logger.log('claimDailyBox error: ' + e);
    return { ok: false, error: e.message };
  }
}

function miniApp_getCollection(chatId, userName) {
  try {
    var clean = String(userName || '').trim();
    var rows = supabaseRequest_('user_cards?user_name=eq.' + encodeURIComponent(clean) + '&select=card_id,quantity,first_obtained_at,cards_catalog(id,name,position,club,country,country_code,ovr,rarity,image_url)&order=first_obtained_at.desc', { method: 'get' }) || [];
    var byRarity = { common: 0, rare: 0, epic: 0, legendary: 0, mythic: 0 };
    var list = rows.map(function (r) {
      var c = r.cards_catalog || {};
      if (byRarity[c.rarity] != null) byRarity[c.rarity] += Number(r.quantity) || 0;
      return { cardId: r.card_id, name: c.name, position: c.position, club: c.club, country: c.country, countryCode: c.country_code, ovr: c.ovr, rarity: c.rarity, imageUrl: c.image_url, quantity: Number(r.quantity) || 1, obtainedAt: r.first_obtained_at };
    });
    var order = { mythic: 0, legendary: 1, epic: 2, rare: 3, common: 4 };
    list.sort(function (a, b) {
      var d = (order[a.rarity] || 9) - (order[b.rarity] || 9);
      if (d !== 0) return d;
      return (Number(b.ovr) || 0) - (Number(a.ovr) || 0);
    });
    var totalCatalog = supabaseRequest_('cards_catalog?select=id&is_active=eq.true', { method: 'get' }) || [];
    return {
      ok: true, cards: list,
      stats: { totalCards: list.reduce(function(s,c){ return s + c.quantity; }, 0), uniqueCards: list.length, catalogTotal: totalCatalog.length, completionPct: totalCatalog.length ? Math.round(list.length / totalCatalog.length * 100) : 0, byRarity: byRarity }
    };
  } catch (e) { return { ok: false, error: e.message }; }
}

// ============================================================
//  GIPHY HIGHLIGHTS
// ============================================================
var GIPHY_CACHE_TTL = 60 * 60 * 24; // 24 часа

/**
 * Возвращает 3 GIF-хайлайта для сыгранного матча.
 * Кэшируется в ScriptProperties на 24 часа, чтобы не жечь квоту GIPHY.
 */
function miniApp_getMatchHighlights(leagueCode, matchName, realScore) {
  try {
    var cleanMatch = String(matchName || '').trim();
    var cleanScore = String(realScore || '').trim();
    if (!cleanMatch || !cleanScore) {
      return { ok: false, error: 'Матч не сыгран' };
    }

    // Собираем запрос
    var parts = cleanMatch.split(/\s*[-–—]\s*/);
    var home = (parts[0] || '').trim();
    var away = (parts[1] || '').trim();
    var scoreParts = cleanScore.split('-');
    var hScore = parseInt(scoreParts[0], 10) || 0;
    var aScore = parseInt(scoreParts[1], 10) || 0;

    // Кто победил — того и ищем
    var winner = hScore > aScore ? home : (aScore > hScore ? away : home);
    var query = encodeURIComponent(winner + ' goal football');

    // Кэш по нормализованному ключу
    var cacheKey = 'giphy_' + hashString_(cleanMatch + '||' + cleanScore);
    var cache = CacheService.getScriptCache();
    var cached = cache.get(cacheKey);
    if (cached) {
      try { return JSON.parse(cached); } catch (e) {}
    }

    // Проверяем, что GIPHY API key есть
    var apiKey = PropertiesService.getScriptProperties().getProperty('GIPHY_API_KEY');
    if (!apiKey) {
      return { ok: false, error: 'GIPHY_API_KEY не настроен' };
    }

    var url = 'https://api.giphy.com/v1/gifs/search?api_key=' + apiKey +
              '&q=' + query + '&limit=3&rating=g&lang=en';

    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) {
      Logger.log('GIPHY error: ' + resp.getContentText().substring(0, 200));
      return { ok: false, error: 'GIPHY недоступен' };
    }

    var data = JSON.parse(resp.getContentText());
    var gifs = (data.data || []).map(function (g) {
      // Используем MP4 — работает быстрее и меньше весит в Mini App
      var mp4 = g.images && g.images.fixed_height && g.images.fixed_height.mp4;
      var preview = g.images && g.images.fixed_height_small && g.images.fixed_height_small.url;
      return {
        id: g.id,
        title: g.title || '',
        mp4: mp4 || null,
        preview: preview || null,
        url: g.url || ''
      };
    }).filter(function (g) { return g.mp4 || g.preview; });

    var result = { ok: true, gifs: gifs, query: winner };

    try {
      cache.put(cacheKey, JSON.stringify(result), GIPHY_CACHE_TTL);
    } catch (e) {}

    return result;
  } catch (e) {
    Logger.log('getMatchHighlights error: ' + e);
    return { ok: false, error: e.message };
  }
}

// ============================================================
//  JOKER (x2 к очкам за матч)
// ============================================================
var JOKER_PRICE_XP = 500;
var JOKER_MAX_PER_WEEK = 1;

function miniApp_buyJoker(chatId, userName) {
  try {
    var clean = String(userName || '').trim();
    if (!clean) return { ok: false, error: 'Не указан пользователь' };

    // Списываем XP
    var spend = spendXP_(clean, JOKER_PRICE_XP, 'joker_purchase');
    if (!spend.ok) return spend;

    // Инкрементим счётчик джокеров
    var rows = supabaseRequest_(
      'xp_profiles?user_name=eq.' + encodeURIComponent(clean) + '&select=jokers_count',
      { method: 'get', noCache: true }
    );
    var current = (rows && rows[0] && rows[0].jokers_count) || 0;
    var newCount = Number(current) + 1;

    supabaseRequest_('xp_profiles?on_conflict=user_name', {
      method: 'post',
      body: [{ user_name: clean, jokers_count: newCount, updated_at: new Date().toISOString() }],
      prefer: 'return=minimal,resolution=merge-duplicates'
    });

    return { ok: true, newBalance: spend.newBalance, jokersCount: newCount };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function miniApp_getJokerStatus(chatId, userName) {
  try {
    var clean = String(userName || '').trim();
    var rows = supabaseRequest_(
      'xp_profiles?user_name=eq.' + encodeURIComponent(clean) +
      '&select=jokers_count,last_joker_week,xp_balance',
      { method: 'get', noCache: true }
    );
    var p = (rows && rows[0]) || {};
    var currentWeek = getPeriodKey_('weekly');
    var usedThisWeek = String(p.last_joker_week || '') === currentWeek;

    return {
      ok: true,
      jokersCount: Number(p.jokers_count) || 0,
      usedThisWeek: usedThisWeek,
      canUseNow: (Number(p.jokers_count) || 0) > 0 && !usedThisWeek,
      price: JOKER_PRICE_XP,
      currentWeek: currentWeek
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Активировать джокер на конкретный матч (до сохранения прогноза).
 * Возвращает обновлённый xp_profiles с флагом "использовано на этой неделе".
 * Вызывается ИЗ miniApp_savePrediction через payload.useJoker = true.
 */
function activateJoker_(userName) {
  var clean = String(userName || '').trim();
  var currentWeek = getPeriodKey_('weekly');

  var rows = supabaseRequest_(
    'xp_profiles?user_name=eq.' + encodeURIComponent(clean) + '&select=jokers_count,last_joker_week',
    { method: 'get', noCache: true }
  );
  var p = (rows && rows[0]) || {};
  var count = Number(p.jokers_count) || 0;
  if (count < 1) return { ok: false, error: 'Нет джокеров. Купите в магазине.' };
  if (String(p.last_joker_week || '') === currentWeek) {
    return { ok: false, error: 'Джокер уже использован на этой неделе' };
  }

  supabaseRequest_('xp_profiles?on_conflict=user_name', {
    method: 'post',
    body: [{
      user_name: clean,
      jokers_count: count - 1,
      last_joker_week: currentWeek,
      updated_at: new Date().toISOString()
    }],
    prefer: 'return=minimal,resolution=merge-duplicates'
  });

  return { ok: true, remainingJokers: count - 1, week: currentWeek };
}

// ============================================================
//  TEAM BUILDER (11 игроков + тренер)
// ============================================================
var TEAM_FORMATION_433 = {
  slots: [
    { index: 0,  group: 'GK',  label: 'ВРТ' },
    { index: 1,  group: 'DEF', label: 'ЛЗ' },
    { index: 2,  group: 'DEF', label: 'ЦЗ' },
    { index: 3,  group: 'DEF', label: 'ЦЗ' },
    { index: 4,  group: 'DEF', label: 'ПЗ' },
    { index: 5,  group: 'MID', label: 'ЦП' },
    { index: 6,  group: 'MID', label: 'ЦП' },
    { index: 7,  group: 'MID', label: 'ЦП' },
    { index: 8,  group: 'FWD', label: 'ЛФ' },
    { index: 9,  group: 'FWD', label: 'ЦФ' },
    { index: 10, group: 'FWD', label: 'ПФ' }
  ]
};

var POSITION_GROUPS = {
  'GK':  ['GK'],
  'DEF': ['CB', 'LB', 'RB', 'LWB', 'RWB', 'DEF', 'SW'],
  'MID': ['CM', 'CDM', 'CAM', 'LM', 'RM', 'MF', 'MID'],
  'FWD': ['ST', 'CF', 'LW', 'RW', 'SS', 'FWD'],
  'COACH': ['COACH']
};

function classifyPosition_(pos) {
  var p = String(pos || '').toUpperCase().trim();
  for (var group in POSITION_GROUPS) {
    if (POSITION_GROUPS[group].indexOf(p) !== -1) return group;
  }
  return 'MID'; // дефолт
}

/**
 * Загружает данные для конструктора команды.
 * Возвращает слоты, текущий состав, доступные карточки по позициям.
 */
function miniApp_getTeamBuilder(chatId, userName) {
  try {
    var clean = String(userName || '').trim();
    if (!clean) return { ok: false, error: 'Не указан пользователь' };

    // Карточки пользователя
    var userCards = supabaseRequest_(
      'user_cards?user_name=eq.' + encodeURIComponent(clean) +
      '&select=card_id,quantity,cards_catalog(id,name,position,club,country,country_code,ovr,rarity,image_url)',
      { method: 'get' }
    ) || [];

    // Классифицируем по группам
    var cardsByGroup = { GK: [], DEF: [], MID: [], FWD: [], COACH: [] };
    userCards.forEach(function (r) {
      var c = r.cards_catalog;
      if (!c) return;
      var group = classifyPosition_(c.position);
      cardsByGroup[group].push({
        cardId: r.card_id,
        name: c.name,
        position: c.position,
        club: c.club,
        country: c.country,
        countryCode: c.country_code,
        ovr: Number(c.ovr) || 0,
        rarity: c.rarity,
        group: group,
        quantity: Number(r.quantity) || 1
      });
    });

    // Сортируем по OVR desc
    for (var g in cardsByGroup) {
      cardsByGroup[g].sort(function (a, b) { return b.ovr - a.ovr; });
    }

    // Текущий состав
    var teamRows = supabaseRequest_(
      'user_teams?user_name=eq.' + encodeURIComponent(clean),
      { method: 'get' }
    ) || [];
    var team = teamRows[0] || null;

    var slotsRows = supabaseRequest_(
      'user_team_slots?user_name=eq.' + encodeURIComponent(clean) +
      '&select=slot_index,card_id,cards_catalog(id,name,position,club,country_code,ovr,rarity)',
      { method: 'get' }
    ) || [];

    var slotsMap = {};
    slotsRows.forEach(function (s) { slotsMap[s.slot_index] = s; });

    var slots = TEAM_FORMATION_433.slots.map(function (def) {
      var cur = slotsMap[def.index];
      return {
        index: def.index,
        group: def.group,
        label: def.label,
        card: cur && cur.cards_catalog ? {
          cardId: cur.card_id,
          name: cur.cards_catalog.name,
          position: cur.cards_catalog.position,
          club: cur.cards_catalog.club,
          countryCode: cur.cards_catalog.country_code,
          ovr: Number(cur.cards_catalog.ovr) || 0,
          rarity: cur.cards_catalog.rarity
        } : null
      };
    });

    var coachCard = null;
    if (team && team.coach_card_id) {
      var coachRows = supabaseRequest_(
        'cards_catalog?id=eq.' + team.coach_card_id +
        '&select=id,name,position,club,country_code,ovr,rarity',
        { method: 'get' }
      ) || [];
      if (coachRows[0]) {
        coachCard = {
          cardId: coachRows[0].id,
          name: coachRows[0].name,
          position: coachRows[0].position,
          club: coachRows[0].club,
          countryCode: coachRows[0].country_code,
          ovr: Number(coachRows[0].ovr) || 0,
          rarity: coachRows[0].rarity
        };
      }
    }

    // Считаем текущий рейтинг команды
    var currentPower = null;
    var filledSlots = slots.filter(function (s) { return s.card; }).length;
    if (filledSlots === 11 && coachCard) {
      currentPower = calcTeamPower_(slots, coachCard);
    }

    return {
      ok: true,
      slots: slots,
      coachCard: coachCard,
      cardsByGroup: cardsByGroup,
      teamName: team ? team.team_name : null,
      teamExists: !!team,
      filledSlots: filledSlots,
      currentPower: currentPower,
      isComplete: filledSlots === 11 && !!coachCard
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function calcTeamPower_(slots, coachCard) {
  var sum = 0, count = 0;
  slots.forEach(function (s) {
    if (s.card) { sum += Number(s.card.ovr) || 0; count++; }
  });
  if (!count) return 0;
  var avg = sum / count;
  var coachBonus = coachCard ? (Number(coachCard.ovr) || 0) * 0.1 : 0;
  return Math.round((avg + coachBonus) * 100) / 100;
}

/**
 * Сохранить состав команды.
 * slots — массив вида [{index: 0, cardId: 123}, {index: 1, cardId: 456}, ...]
 * coachCardId — ID карточки тренера
 */
function miniApp_saveTeam(chatId, userName, slots, coachCardId, teamName) {
  try {
    var clean = String(userName || '').trim();
    if (!clean) return { ok: false, error: 'Не указан пользователь' };

    if (!Array.isArray(slots)) return { ok: false, error: 'Неверный формат слотов' };
    if (slots.length !== 11) return { ok: false, error: 'Нужно заполнить все 11 позиций' };
    if (!coachCardId) return { ok: false, error: 'Выберите тренера' };

    // Валидация: у пользователя действительно есть эти карточки
    var cardIds = slots.map(function (s) { return s.cardId; });
    cardIds.push(coachCardId);

    var owned = supabaseRequest_(
      'user_cards?user_name=eq.' + encodeURIComponent(clean) +
      '&card_id=in.(' + cardIds.map(encodeURIComponent).join(',') + ')&select=card_id',
      { method: 'get', noCache: true }
    ) || [];
    var ownedSet = {};
    owned.forEach(function (o) { ownedSet[o.card_id] = true; });

    for (var i = 0; i < cardIds.length; i++) {
      if (!ownedSet[cardIds[i]]) {
        return { ok: false, error: 'Карточка #' + cardIds[i] + ' не найдена в коллекции' };
      }
    }

    // Сохраняем команду
    supabaseRequest_('user_teams?on_conflict=user_name', {
      method: 'post',
      body: [{
        user_name: clean,
        team_name: String(teamName || 'Моя команда').substring(0, 40),
        formation: '4-3-3',
        coach_card_id: coachCardId,
        updated_at: new Date().toISOString()
      }],
      prefer: 'return=minimal,resolution=merge-duplicates'
    });

    // Удаляем старые слоты
    supabaseRequest_(
      'user_team_slots?user_name=eq.' + encodeURIComponent(clean),
      { method: 'delete', prefer: 'return=minimal' }
    );

    // Вставляем новые
    var rows = slots.map(function (s) {
      return { user_name: clean, slot_index: s.index, card_id: s.cardId };
    });
    supabaseRequest_('user_team_slots', {
      method: 'post',
      body: rows,
      prefer: 'return=minimal'
    });

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Получить сохранённую команду для отображения / битвы.
 */
function miniApp_getMyTeam(chatId, userName) {
  try {
    var clean = String(userName || '').trim();
    var teams = supabaseRequest_(
      'user_teams?user_name=eq.' + encodeURIComponent(clean),
      { method: 'get' }
    ) || [];
    if (!teams.length) return { ok: false, error: 'Команда не создана' };
    var team = teams[0];

    var slots = supabaseRequest_(
      'user_team_slots?user_name=eq.' + encodeURIComponent(clean) +
      '&select=slot_index,card_id,cards_catalog(id,name,position,club,country_code,ovr,rarity)',
      { method: 'get' }
    ) || [];

    var coach = null;
    if (team.coach_card_id) {
      var cr = supabaseRequest_(
        'cards_catalog?id=eq.' + team.coach_card_id +
        '&select=id,name,position,club,country_code,ovr,rarity',
        { method: 'get' }
      ) || [];
      if (cr[0]) coach = cr[0];
    }

    var mappedSlots = TEAM_FORMATION_433.slots.map(function (def) {
      var found = slots.filter(function (s) { return s.slot_index === def.index; })[0];
      return {
        index: def.index,
        group: def.group,
        label: def.label,
        card: found && found.cards_catalog ? found.cards_catalog : null
      };
    });

    var power = (mappedSlots.every(function (s) { return s.card; }) && coach)
      ? calcTeamPower_(mappedSlots, coach) : null;

    return {
      ok: true,
      teamName: team.team_name,
      formation: team.formation,
      slots: mappedSlots,
      coach: coach,
      power: power
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ============================================================
//  TEAM BATTLE
// ============================================================
var BATTLE_MAX_PER_DAY = 3;
var BATTLE_WIN_XP = 150;
var BATTLE_LOSE_XP = 30;
var BATTLE_DRAW_XP = 80;

// ============================================================
//  BATTLE SCRIPT — генерация сценария матча
// ============================================================
/**
 * Генерирует 6 атак (3 на каждую сторону) и счёт по голам.
 * Сильная команда чаще забивает, но есть джиттер для зрелищности.
 */
function generateBattleScript_(power1, power2) {
  var attacksPerSide = 3;
  var events = [];
  var score1 = 0, score2 = 0;

  for (var i = 0; i < attacksPerSide * 2; i++) {
    var attacker = (i % 2 === 0) ? 'me' : 'opp';
    var attackerPower = attacker === 'me' ? power1 : power2;
    var defenderPower = attacker === 'me' ? power2 : power1;

    // Базовый шанс гола от силы (0.3–0.75)
    var goalChance = 0.35 + (attackerPower - defenderPower) * 0.015;
    // Джиттер ±15%
    goalChance += (Math.random() - 0.5) * 0.3;
    goalChance = Math.max(0.15, Math.min(0.85, goalChance));

    var isGoal = Math.random() < goalChance;
    var hitPost = !isGoal && Math.random() < 0.3; // 30% промахов — в штангу

    if (isGoal) {
      if (attacker === 'me') score1++;
      else score2++;
    }

    events.push({
      attacker: attacker,
      isGoal: isGoal,
      hitPost: hitPost,
      minute: 8 + i * 13,
      scoreAfter: { me: score1, opp: score2 }
    });
  }

  return {
    events: events,
    score1: score1,
    score2: score2
  };
}

/**
 * Найти случайного соперника и провести битву.
 */
function miniApp_startTeamBattle(chatId, userName) {
  try {
    var clean = String(userName || '').trim();
    if (!clean) return { ok: false, error: 'Не указан пользователь' };

    // Rate limit
    if (!checkRateLimit_('battle_' + clean, 10)) {
      return { ok: false, error: 'Слишком часто. Подождите.' };
    }

    // Проверяем дневной лимит
    var todayKey = getPeriodKey_('daily');
    var battlesToday = supabaseRequest_(
      'team_battles?or=(user1.eq.' + encodeURIComponent(clean) +
      ',user2.eq.' + encodeURIComponent(clean) + ')&created_at=gte.' +
      encodeURIComponent(todayKey + 'T00:00:00.000Z') + '&select=id',
      { method: 'get', noCache: true }
    ) || [];
    if (battlesToday.length >= BATTLE_MAX_PER_DAY) {
      return { ok: false, error: 'Дневной лимит битв: ' + BATTLE_MAX_PER_DAY };
    }

    // Загружаем мою команду
    var myTeam = miniApp_getMyTeam(chatId, clean);
    if (!myTeam || !myTeam.ok) {
      return { ok: false, error: 'Сначала соберите команду' };
    }
    if (!myTeam.power) {
      return { ok: false, error: 'Команда неполная' };
    }

    // ============ ВЫБОР СОПЕРНИКА ============
    // Сначала ищем РЕАЛЬНЫХ игроков
    var realTeams = supabaseRequest_(
      'user_teams?user_name=neq.' + encodeURIComponent(clean) +
      '&is_bot=eq.false&select=user_name',
      { method: 'get', noCache: true }
    ) || [];

    var opponentCandidates = [];

    // Реальные игроки с полной командой
    for (var i = 0; i < realTeams.length; i++) {
      var t = miniApp_getMyTeam(null, realTeams[i].user_name);
      if (t && t.ok && t.power) {
        opponentCandidates.push({ user: realTeams[i].user_name, isBot: false, team: t });
      }
    }

    // Если реальных мало (< 3) — подмешиваем ботов
    if (opponentCandidates.length < 3) {
      var botTeams = supabaseRequest_(
        'user_teams?user_name=neq.' + encodeURIComponent(clean) +
        '&is_bot=eq.true&select=user_name',
        { method: 'get', noCache: true }
      ) || [];

      for (var j = 0; j < botTeams.length; j++) {
        var bt = miniApp_getMyTeam(null, botTeams[j].user_name);
        if (bt && bt.ok && bt.power) {
          opponentCandidates.push({ user: botTeams[j].user_name, isBot: true, team: bt });
        }
      }
    }

    if (!opponentCandidates.length) {
      return { ok: false, error: 'Нет доступных соперников. Попросите друзей собрать команду или создайте ботов.' };
    }

    // Случайный выбор
    var opponentData = opponentCandidates[Math.floor(Math.random() * opponentCandidates.length)];
    var opponent = opponentData.user;
    var oppTeam = opponentData.team;
    var opponentIsBot = opponentData.isBot;

    // ============ СИМУЛЯЦИЯ МАТЧА ============
var jitter1 = (Math.random() - 0.5) * 2;
var jitter2 = (Math.random() - 0.5) * 2;
var power1 = Math.round((myTeam.power + jitter1) * 100) / 100;
var power2 = Math.round((oppTeam.power + jitter2) * 100) / 100;

// Генерируем сценарий по голам
var script = generateBattleScript_(power1, power2);

// Победитель — по голам, при равенстве по силе команд
var winner = null;
var xpReward = 0;
if (script.score1 > script.score2) {
  winner = clean;
  xpReward = BATTLE_WIN_XP;
} else if (script.score2 > script.score1) {
  winner = opponent;
  xpReward = BATTLE_LOSE_XP;
} else {
  // Равенство голов — решает общая сила
  if (power1 > power2) {
    winner = clean;
    xpReward = BATTLE_WIN_XP;
  } else if (power2 > power1) {
    winner = opponent;
    xpReward = BATTLE_LOSE_XP;
  } else {
    winner = null;
    xpReward = BATTLE_DRAW_XP;
  }
}

// Сохраняем битву
supabaseRequest_('team_battles', {
  method: 'post',
  body: [{
    user1: clean, user2: opponent,
    user1_power: power1, user2_power: power2,
    winner: winner, xp_reward: xpReward,
    score1: script.score1, score2: script.score2
  }],
  prefer: 'return=minimal'
});

// ============ НАЧИСЛЕНИЕ XP ============
var xpResult = null;
try {
  if (xpReward > 0) {
    xpResult = addXP_(clean, xpReward, 'battle');
  }
} catch (e) {}

if (!opponentIsBot) {
  try {
    if (winner === opponent) {
      addXP_(opponent, BATTLE_WIN_XP, 'battle');
    } else if (winner === null) {
      addXP_(opponent, BATTLE_DRAW_XP, 'battle');
    }
  } catch (e) {}
}

return {
      ok: true,
      result: {
        me: { user: clean, power: power1, team: myTeam },
        opponent: {
          user: opponent,
          power: power2,
          team: oppTeam,
          isBot: opponentIsBot
        },
        winner: winner,
        outcome: winner === clean ? 'win' : (winner === null ? 'draw' : 'lose'),
        xpReward: xpReward,
        score: { me: script.score1, opp: script.score2 },
        events: script.events   // 🔥 сценарий матча для анимации
      },
      xp: xpResult
    };

  } catch (e) {
    Logger.log('startTeamBattle error: ' + e);
    return { ok: false, error: e.message };
  }
}

/**
 * История битв пользователя (последние 10).
 */
function miniApp_getBattleHistory(chatId, userName) {
  try {
    var clean = String(userName || '').trim();
    var rows = supabaseRequest_(
      'team_battles?or=(user1.eq.' + encodeURIComponent(clean) +
      ',user2.eq.' + encodeURIComponent(clean) + ')&order=created_at.desc&limit=10',
      { method: 'get' }
    ) || [];

    var battles = rows.map(function (b) {
      var isMe1 = b.user1 === clean;
      var myPower = isMe1 ? b.user1_power : b.user2_power;
      var oppPower = isMe1 ? b.user2_power : b.user1_power;
      var oppUser = isMe1 ? b.user2 : b.user1;
      var outcome = 'draw';
      if (b.winner === clean) outcome = 'win';
      else if (b.winner === oppUser) outcome = 'lose';
      return {
        id: b.id, opponent: oppUser,
        myPower: myPower, oppPower: oppPower,
        outcome: outcome, xpReward: b.xp_reward,
        date: b.created_at
      };
    });
    return { ok: true, battles: battles };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ============================================================
//  BOT TEAMS — автоматическое создание ботов
// ============================================================

/**
 * Создать N ботов с готовыми командами.
 * Запускается вручную из Apps Script (Run → admin_createBotTeams).
 */
function admin_createBotTeams(count) {
  count = parseInt(count, 10) || 5;

  // Загружаем каталог
  var catalog = supabaseRequest_(
    'cards_catalog?is_active=eq.true&select=id,name,position,ovr,rarity',
    { method: 'get', noCache: true }
  ) || [];

  if (!catalog.length) {
    Logger.log('❌ Каталог карточек пуст. Добавьте карточки!');
    return { ok: false, error: 'Нет карточек' };
  }

  // Группируем по позициям
  var byGroup = { GK: [], DEF: [], MID: [], FWD: [], COACH: [] };
  catalog.forEach(function (c) {
    var g = classifyPosition_(c.position);
    if (byGroup[g]) byGroup[g].push(c);
  });

  // Проверяем, что для каждой группы есть карточки
  for (var g in byGroup) {
    if (!byGroup[g].length) {
      Logger.log('❌ Нет карточек для группы ' + g);
      return { ok: false, error: 'Нет карточек для ' + g };
    }
  }

  var created = 0;
  var botNames = [];

  for (var i = 0; i < count; i++) {
    var botName = 'Bot_' + (i + 1) + '_' + Math.random().toString(36).substring(2, 6);

    // Выбираем по 1 карточке для каждой позиции
    var slots = [];
    var slotDefs = TEAM_FORMATION_433.slots;

    // Счётчики использования карточек, чтобы не было дублей внутри одной команды
    var used = {};

    for (var s = 0; s < slotDefs.length; s++) {
      var def = slotDefs[s];
      var pool = byGroup[def.group] || [];
      var candidates = pool.filter(function (c) { return !used[c.id]; });
      if (!candidates.length) candidates = pool; // fallback
      var pick = candidates[Math.floor(Math.random() * candidates.length)];
      used[pick.id] = true;
      slots.push({ index: def.index, cardId: pick.id });
    }

    // Тренер
    var coachPool = byGroup.COACH;
    var coach = coachPool[Math.floor(Math.random() * coachPool.length)];

    // Сохраняем команду
    try {
      supabaseRequest_('user_teams?on_conflict=user_name', {
        method: 'post',
        body: [{
          user_name: botName,
          team_name: 'Bot Squad ' + (i + 1),
          formation: '4-3-3',
          coach_card_id: coach.id,
          is_bot: true,
          updated_at: new Date().toISOString()
        }],
        prefer: 'return=minimal,resolution=merge-duplicates'
      });

      supabaseRequest_('user_team_slots?user_name=eq.' + encodeURIComponent(botName), {
        method: 'delete', prefer: 'return=minimal'
      });

      var rows = slots.map(function (s) {
        return { user_name: botName, slot_index: s.index, card_id: s.cardId };
      });
      supabaseRequest_('user_team_slots', {
        method: 'post',
        body: rows,
        prefer: 'return=minimal'
      });

      created++;
      botNames.push(botName);
      Logger.log('✅ Создан ' + botName);
    } catch (e) {
      Logger.log('❌ Ошибка создания ' + botName + ': ' + e);
    }
  }

  Logger.log('🎉 Создано ботов: ' + created);
  return { ok: true, created: created, botNames: botNames };
}

/**
 * Удалить всех ботов (для чистки).
 */
function admin_deleteBotTeams() {
  try {
    var bots = supabaseRequest_(
      'user_teams?is_bot=eq.true&select=user_name',
      { method: 'get', noCache: true }
    ) || [];
    var names = bots.map(function (b) { return b.user_name; });
    Logger.log('Удаляем ботов: ' + names.join(', '));

    names.forEach(function (n) {
      supabaseRequest_('user_team_slots?user_name=eq.' + encodeURIComponent(n), {
        method: 'delete', prefer: 'return=minimal'
      });
      supabaseRequest_('user_teams?user_name=eq.' + encodeURIComponent(n), {
        method: 'delete', prefer: 'return=minimal'
      });
    });

    return { ok: true, deleted: names.length };
  } catch (e) {
    Logger.log('deleteBotTeams error: ' + e);
    return { ok: false, error: e.message };
  }
}

/**
 * Синхронизирует Google Sheets → Supabase:
 *  - листы "Матчи_*"  → таблица matches
 *  - "Ответы на форму (3)" → predictions
 *  - после синка пересчитывает user_points для затронутых игроков
 *
 * Вызывается:
 *  - из цепочки updateAllLeagues (шаг sync)
 *  - из onEditNotifyMatches (при ручном изменении счёта)
 *  - из админки "Sync в БД"
 */
function syncMatchesToSupabase() {
  Logger.log('=== syncMatchesToSupabase: СТАРТ ===');
  var ss = SpreadsheetApp.openById(SHEET_ID);

  // ─────────────────────────────────────────────
  // 1. МАТЧИ
  // ─────────────────────────────────────────────
  var totalMatches = 0;

  for (var code in LEAGUES) {
    var cfg = LEAGUES[code];
    var sh = ss.getSheetByName(cfg.sheetName);
    if (!sh) { Logger.log('Нет листа ' + cfg.sheetName); continue; }

    var lastRow = sh.getLastRow();
    if (lastRow < 2) { Logger.log('Пустой лист ' + cfg.sheetName); continue; }

    var rows = sh.getRange(2, 1, lastRow - 1, 5).getValues();
    var batch = [];

    for (var i = 0; i < rows.length; i++) {
      var tourStr   = String(rows[i][0] || '').trim();
      var dateRaw   = rows[i][1];
      var matchName = String(rows[i][2] || '').trim();
      if (!matchName) continue;

      var realScoreRaw = String(rows[i][3] || '').trim();
      var winner       = String(rows[i][4] || '').trim();

      var tourNum   = parseInt(tourStr.replace(/[^\d]/g, ''), 10);
      if (isNaN(tourNum)) tourNum = null;

      var matchNorm = normalizeMatchName_(matchName);

      // utc_date
      var utcDate = null;
      if (dateRaw instanceof Date) {
        utcDate = dateRaw.toISOString();
      } else if (dateRaw) {
        var d = new Date(dateRaw);
        if (!isNaN(d.getTime())) utcDate = d.toISOString();
      }

      // real_score: только валидный X-Y
      var realScore = null;
      if (realScoreRaw && realScoreRaw !== '-' && realScoreRaw !== '—') {
        if (/^\d+\s*[-:]\s*\d+$/.test(realScoreRaw)) {
          realScore = realScoreRaw.replace(/:/g, '-').replace(/\s/g, '');
        }
      }

      batch.push({
        league_code: code,
        tour_num:    tourNum,
        match_name:  matchName,
        match_norm:  matchNorm,
        real_score:  realScore,
        winner:      winner || null,
        utc_date:    utcDate
      });
    }

    if (!batch.length) continue;

    // Upsert пачками по 200 (лимит PostgREST ~1000 строк, но 200 надёжнее)
    for (var b = 0; b < batch.length; b += 200) {
      var chunk = batch.slice(b, b + 200);
      try {
        supabaseRequest_('matches?on_conflict=league_code,match_norm', {
          method: 'post',
          body: chunk,
          prefer: 'return=minimal,resolution=merge-duplicates'
        });
      } catch (e) {
        Logger.log('❌ upsert matches [' + code + '] chunk ' + b + ': ' + e);
        throw e; // прерываем — иначе данные будут частичными
      }
    }

    totalMatches += batch.length;
    Logger.log('✅ Матчи ' + code + ': ' + batch.length);
    Utilities.sleep(150); // мягко к rate-limit Supabase
  }

  Logger.log('✅ Всего матчей отправлено: ' + totalMatches);

  // ─────────────────────────────────────────────
  // 2. ПРОГНОЗЫ (только новые, чтобы не переписывать is_joker)
  // ─────────────────────────────────────────────
  var totalPreds = 0;
  var affectedUsers = {};

  var predSheet = ss.getSheetByName('Ответы на форму (3)');
  if (predSheet) {
    var pLast = predSheet.getLastRow();
    if (pLast >= 2) {
      var preds = predSheet.getRange(2, 1, pLast - 1, 6).getValues();
      var predBatch = [];

      for (var j = 0; j < preds.length; j++) {
        var userName = String(preds[j][1] || '').trim();
        if (!userName) continue;

        var pMatch  = String(preds[j][2] || '').trim();
        if (!pMatch) continue;

        var pOut    = String(preds[j][3] || '').trim();
        var pScore  = String(preds[j][4] || '').trim();
        var pLeague = String(preds[j][5] || 'PL').trim() || 'PL';

        var savedAt = null;
        if (preds[j][0] instanceof Date) savedAt = preds[j][0].toISOString();

        predBatch.push({
          user_name:   userName,
          league_code: pLeague,
          match_name:  pMatch,
          match_norm:  normalizeMatchName_(pMatch),
          outcome:     pOut,
          score:       pScore.replace(/:/g, '-').replace(/\s/g, ''),
          saved_at:    savedAt
        });

        affectedUsers[userName] = true;
      }

      // ⚠️ Важно: prefer=ignore-duplicates, чтобы НЕ перетереть is_joker у существующих
      for (var k = 0; k < predBatch.length; k += 200) {
        var pChunk = predBatch.slice(k, k + 200);
        try {
          supabaseRequest_('predictions?on_conflict=user_name,league_code,match_norm', {
            method: 'post',
            body: pChunk,
            prefer: 'return=minimal,resolution=ignore-duplicates'
          });
        } catch (e) {
          Logger.log('❌ upsert predictions chunk ' + k + ': ' + e);
          // не бросаем — прогнозы не критичны для пересчёта матчей
        }
      }

      totalPreds = predBatch.length;
      Logger.log('✅ Прогнозы отправлено: ' + totalPreds);
    }
  } else {
    Logger.log('⚠️ Лист "Ответы на форму (3)" не найден — прогнозы пропущены');
  }

  // ─────────────────────────────────────────────
  // 3. ПЕРЕСЧЁТ user_points
  // ─────────────────────────────────────────────
  var names = Object.keys(affectedUsers);
  if (names.length) {
    Logger.log('🔄 Пересчёт user_points для ' + names.length + ' игроков...');
    recalcUserPointsBatch_(names);
    Logger.log('✅ Пересчёт завершён');
  }

  // ─────────────────────────────────────────────
  // 4. Сброс кэша
  // ─────────────────────────────────────────────
  bumpTablesCache_(['matches', 'predictions', 'user_points']);

  Logger.log('=== syncMatchesToSupabase: ГОТОВО (matches=' + totalMatches +
             ', preds=' + totalPreds + ', users=' + names.length + ') ===');

  return { ok: true, matches: totalMatches, preds: totalPreds, users: names.length };
}

function TEST_FULL_SYNC() {
  Logger.log('--- TEST_FULL_SYNC ---');
  var r1 = syncMatchesToSupabase();
  Logger.log('sync: ' + JSON.stringify(r1));
  updateAllRatings();
  Logger.log('ratings done');

  // Проверка, что в БД появились данные
  var m = supabaseRequest_('matches?real_score=not.is.null&select=id', { method: 'get', noCache: true }) || [];
  Logger.log('matches с real_score в БД: ' + m.length);

  var up = supabaseRequest_('user_points?select=user_name,total_points&order=total_points.desc&limit=5', { method: 'get', noCache: true }) || [];
  Logger.log('Топ user_points: ' + JSON.stringify(up));
}

// ============================================================
// БАТЧ-ПЕРЕСЧЁТ ОЧКОВ (ИСПРАВЛЕНИЕ ОШИБКИ recalcUserPointsBatch_)
// ============================================================
function recalcUserPointsBatch_(userNames) {
  if (!userNames || !Array.isArray(userNames)) return;
  userNames.forEach(function (n) {
    try {
      recalcUserPoints_(n); // Вызываем пересчет для каждого игрока
    } catch (e) {
      Logger.log('recalcUserPointsBatch_ error for ' + n + ': ' + e);
    }
  });
}

// Функция для кнопки "Пересчёт рейтинга" в админке
function rebuildAllUserPoints_() {
  Logger.log('=== rebuildAllUserPoints_: СТАРТ ===');
  var all = supabaseRequest_('users?select=user_name', { method: 'get', noCache: true }) || [];
  var names = all.map(function (u) { return u.user_name; }).filter(Boolean);

  try {
    var predUsers = supabaseRequest_('predictions?select=user_name', { method: 'get', noCache: true }) || [];
    predUsers.forEach(function (p) {
      if (p.user_name && names.indexOf(p.user_name) === -1) names.push(p.user_name);
    });
  } catch (e) {}

  Logger.log('Пересчитываю ' + names.length + ' пользователей...');
  recalcUserPointsBatch_(names);
  Logger.log('=== rebuildAllUserPoints_: ГОТОВО ===');
}


// ============================================================
//  КОЛЕСО ФОРТУНЫ (XP-призы)
// ============================================================
var WHEEL_SEGMENTS = [25, 100, 50, 200, 75, 150, 25, 300];
var WHEEL_WEIGHTS  = [22, 12, 20, 6, 16, 8, 12, 4];
var WHEEL_PAID_PRICE = 100;

function miniApp_getWheelStatus(chatId, userName) {
  try {
    var clean = String(userName || '').trim();
    if (!clean) return { ok: false, error: 'Не указан пользователь' };
    var todayKey = getPeriodKey_('daily');
    var freeAvailable = !wasXPAwarded_(clean, 'wheel_' + todayKey, 'wheel_free_spin');
    var balance = 0;
    try {
      var rows = supabaseRequest_('xp_profiles?user_name=eq.' + encodeURIComponent(clean) + '&select=xp_balance,total_xp', { method: 'get', noCache: true });
      if (rows && rows.length) balance = rows[0].xp_balance != null ? Number(rows[0].xp_balance) : (Number(rows[0].total_xp) || 0);
    } catch (e) {}
    return {
      ok: true,
      segments: WHEEL_SEGMENTS,
      freeAvailable: freeAvailable,
      paidPrice: WHEEL_PAID_PRICE,
      canPaid: balance >= WHEEL_PAID_PRICE,
      balance: balance
    };
  } catch (e) { return { ok: false, error: e.message }; }
}

function miniApp_spinWheel(chatId, userName) {
  try {
    var clean = String(userName || '').trim();
    if (!clean) return { ok: false, error: 'Не указан пользователь' };
    if (!checkRateLimit_('wheel_' + clean, 15)) return { ok: false, error: 'Слишком часто. Подождите минуту.' };

    var todayKey = getPeriodKey_('daily');
    var freeUsed = wasXPAwarded_(clean, 'wheel_' + todayKey, 'wheel_free_spin');
    var paid = freeUsed; // бесплатный спин — первый за день, далее платный
    if (paid) {
      var spend = spendXP_(clean, WHEEL_PAID_PRICE, 'wheel_paid_spin');
      if (!spend.ok) return spend;
    }

    // Выбор сегмента по весам (сервер — единственный источник результата)
    var total = 0;
    WHEEL_WEIGHTS.forEach(function (w) { total += w; });
    var r = Math.random() * total, acc = 0, idx = 0;
    for (var i = 0; i < WHEEL_WEIGHTS.length; i++) {
      acc += WHEEL_WEIGHTS[i];
      if (r < acc) { idx = i; break; }
    }
    var prizeXP = WHEEL_SEGMENTS[idx];
    var xpRes = addXP_(clean, prizeXP, 'wheelPrize');
    if (!paid) logXPAward_(clean, 'wheel_' + todayKey, 'wheel_free_spin', 0);

    try {
      supabaseRequest_('box_openings', {
        method: 'post',
        body: [{ user_name: clean, box_code: 'wheel_spin', card_ids: [], xp_spent: paid ? WHEEL_PAID_PRICE : 0 }],
        prefer: 'return=minimal'
      });
    } catch (e) {}

    return {
      ok: true,
      prizeIndex: idx,
      prizeXP: prizeXP,
      paid: paid,
      newBalance: xpRes ? xpRes.balance : null,
      xp: xpRes
    };
  } catch (e) {
    Logger.log('spinWheel error: ' + e);
    return { ok: false, error: e.message };
  }
}

// ============================================================
//  ПРОДАЖА ДУБЛИКАТОВ КАРТОЧЕК
// ============================================================
var CARD_SELL_MULT = { common: 1, rare: 2, epic: 3, legendary: 5, mythic: 8 };

function miniApp_sellCard(chatId, userName, cardId) {
  try {
    var clean = String(userName || '').trim();
    var cid = Number(cardId) || 0;
    if (!clean || !cid) return { ok: false, error: 'Неверные параметры' };
    if (!checkRateLimit_('sell_' + clean, 20)) return { ok: false, error: 'Слишком часто. Подождите минуту.' };

    var rows = supabaseRequest_(
      'user_cards?user_name=eq.' + encodeURIComponent(clean) +
      '&card_id=eq.' + cid +
      '&select=id,quantity,cards_catalog(ovr,rarity,name)',
      { method: 'get', noCache: true }
    );
    if (!rows || !rows.length) return { ok: false, error: 'Карточка не найдена' };
    var row = rows[0];
    var qty = Number(row.quantity) || 0;
    if (qty < 1) return { ok: false, error: 'Нечего продавать' };

    var cat = row.cards_catalog || {};
    var price = (Number(cat.ovr) || 50) * (CARD_SELL_MULT[cat.rarity] || 1);
    var newQty = qty - 1;
    if (newQty > 0) {
      supabaseRequest_('user_cards?id=eq.' + row.id, { method: 'patch', body: { quantity: newQty }, prefer: 'return=minimal' });
    } else {
      supabaseRequest_('user_cards?id=eq.' + row.id, { method: 'delete', prefer: 'return=minimal' });
    }

    var xpRes = addXP_(clean, price, 'sellCard');
    return { ok: true, gained: price, quantity: newQty, cardName: cat.name || '', xp: xpRes };
  } catch (e) {
    Logger.log('sellCard error: ' + e);
    return { ok: false, error: e.message };
  }
}

// ============================================================
//  ИСТОРИЯ НАЧИСЛЕНИЙ XP
// ============================================================
function miniApp_getXPHistory(chatId, userName) {
  try {
    var clean = String(userName || '').trim();
    if (!clean) return { ok: false, error: 'Не указан пользователь' };
    var rows = supabaseRequest_('xp_logs?user_name=eq.' + encodeURIComponent(clean) + '&order=id.desc&limit=30', { method: 'get', noCache: true }) || [];
    var items = rows.map(function (r) {
      return { reason: String(r.reason || ''), xp: Number(r.xp) || 0, matchKey: String(r.match_key || '') };
    });
    return { ok: true, items: items };
  } catch (e) { return { ok: false, error: e.message }; }
}


// ============================================================
//  SHA-256 / HMAC-SHA256 НА ЧИСТОМ JS
//  Нужен потому, что Utilities.computeHmacSha256Signature в GAS
//  не принимает байтовый ключ (а для initData нужен двойной HMAC).
// ============================================================
(function () {
  var K = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
  ];

  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

  // Вход: массив байт (0-255), выход: массив из 32 байт
  function sha256Bytes_(msg) {
    var h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    var bitLen = msg.length * 8;
    var withPad = msg.slice();
    withPad.push(0x80);
    while (withPad.length % 64 !== 56) withPad.push(0);
    for (var i = 7; i >= 0; i--) withPad.push((bitLen / Math.pow(2, i * 8)) & 0xff);

    for (var off = 0; off < withPad.length; off += 64) {
      var w = new Array(64);
      for (var t = 0; t < 16; t++) {
        var j = off + t * 4;
        w[t] = (withPad[j] << 24) | (withPad[j+1] << 16) | (withPad[j+2] << 8) | withPad[j+3];
      }
      for (var t2 = 16; t2 < 64; t2++) {
        var s0 = rotr(w[t2-15],7) ^ rotr(w[t2-15],18) ^ (w[t2-15] >>> 3);
        var s1 = rotr(w[t2-2],17) ^ rotr(w[t2-2],19) ^ (w[t2-2] >>> 10);
        w[t2] = (w[t2-16] + s0 + w[t2-7] + s1) & 0xffffffff;
      }
      var a=h[0],b=h[1],c=h[2],d=h[3],e=h[4],f=h[5],g=h[6],hh=h[7];
      for (var t3 = 0; t3 < 64; t3++) {
        var S1 = rotr(e,6) ^ rotr(e,11) ^ rotr(e,25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (hh + S1 + ch + K[t3] + w[t3]) & 0xffffffff;
        var S0 = rotr(a,2) ^ rotr(a,13) ^ rotr(a,22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2v = (S0 + maj) & 0xffffffff;
        hh=g; g=f; f=e; e=(d + t1) & 0xffffffff; d=c; c=b; b=a; a=(t1 + t2v) & 0xffffffff;
      }
      h[0]=(h[0]+a)&0xffffffff; h[1]=(h[1]+b)&0xffffffff; h[2]=(h[2]+c)&0xffffffff; h[3]=(h[3]+d)&0xffffffff;
      h[4]=(h[4]+e)&0xffffffff; h[5]=(h[5]+f)&0xffffffff; h[6]=(h[6]+g)&0xffffffff; h[7]=(h[7]+hh)&0xffffffff;
    }
    var out = [];
    for (var x = 0; x < 8; x++) {
      out.push((h[x] >>> 24) & 0xff, (h[x] >>> 16) & 0xff, (h[x] >>> 8) & 0xff, h[x] & 0xff);
    }
    return out;
  }

  // HMAC-SHA256: key — массив байт, message — строка UTF-8; результат — hex-строка
  function hmacSha256Hex_(keyBytes, message) {
    var blockSize = 64;
    var key = keyBytes.slice();
    if (key.length > blockSize) key = sha256Bytes_(key);
    while (key.length < blockSize) key.push(0);
    var o = [], i = [];
    for (var n = 0; n < blockSize; n++) { o.push(key[n] ^ 0x5c); i.push(key[n] ^ 0x36); }
    var msgBytes = [];
    for (var m = 0; m < message.length; m++) {
      var code = message.charCodeAt(m);
      if (code < 0x80) msgBytes.push(code);
      else if (code < 0x800) { msgBytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f)); }
      else if (code >= 0xd800 && code <= 0xdbff) {
        var next = message.charCodeAt(++m);
        var u = 0x10000 + ((code & 0x3ff) << 10) + (next & 0x3ff);
        msgBytes.push(0xf0 | (u >> 18), 0x80 | ((u >> 12) & 0x3f), 0x80 | ((u >> 6) & 0x3f), 0x80 | (u & 0x3f));
      }
      else { msgBytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f)); }
    }
    var inner = sha256Bytes_(i.concat(msgBytes));
    var outer = sha256Bytes_(o.concat(inner));
    var hex = '';
    for (var q = 0; q < outer.length; q++) hex += (outer[q] < 16 ? '0' : '') + outer[q].toString(16);
    return hex;
  }

  // Экспорт в глобальную область GAS
  globalThis.sha256Bytes_ = sha256Bytes_;
  globalThis.hmacSha256Hex_ = hmacSha256Hex_;
})();

// ============================================================
//  MINI APP API — ДИСПЕТЧЕР (fetch с фронта на GitHub Pages)
//  Вместо google.script.run клиент шлёт POST {fn, args, initData}.
//  Идентификатор пользователя БЕРЁТСЯ из валидированного initData —
//  клиент не может выдать себя за другого.
// ============================================================

// Позиции chatId/userName в аргументах miniApp_* (0-based)
const API_IDENTITY_MAP_ = {
  miniApp_getBootstrap:                 { chatId: 0, userName: 1 },
  miniApp_getUserPredictions:           { chatId: 0, userName: 1 },
  miniApp_getProfileDashboard:          { chatId: 0, userName: 1 },
  miniApp_getNotifySettings:            { chatId: 0, userName: 1 },
  miniApp_saveNotifySettings:           { chatId: 0, userName: 1 },
  miniApp_createPrivateLeague:          { chatId: 0, userName: 1 },
  miniApp_joinPrivateLeague:            { chatId: 0, userName: 1 },
  miniApp_getMyPrivateLeagues:          { chatId: 0, userName: 1 },
  miniApp_getAvailableMatchesForLeague: { chatId: 1, userName: 2 },
  miniApp_addMatchesToLeague:           { chatId: 2, userName: 3 },
  miniApp_getLeagueMatchesList:         { chatId: 1, userName: 2 },
  miniApp_getPrivateLeagueRating:       { chatId: 1, userName: 2 },
  miniApp_leavePrivateLeague:           { chatId: 0, userName: 1 },
  miniApp_deletePrivateLeague:          { chatId: 0, userName: 1 },
  miniApp_getGamification:              { chatId: 0, userName: 1 },
  miniApp_claimTask:                    { chatId: 0, userName: 1 },
  miniApp_getShop:                      { chatId: 0, userName: 1 },
  miniApp_openBox:                      { chatId: 0, userName: 1 },
  miniApp_claimDailyBox:                { chatId: 0, userName: 1 },
  miniApp_getCollection:                { chatId: 0, userName: 1 },
  miniApp_buyJoker:                     { chatId: 0, userName: 1 },
  miniApp_getJokerStatus:               { chatId: 0, userName: 1 },
  miniApp_getTeamBuilder:               { chatId: 0, userName: 1 },
  miniApp_saveTeam:                     { chatId: 0, userName: 1 },
  miniApp_getMyTeam:                    { chatId: 0, userName: 1 },
  miniApp_startTeamBattle:              { chatId: 0, userName: 1 },
  miniApp_getBattleHistory:             { chatId: 0, userName: 1 },
  miniApp_getWheelStatus:               { chatId: 0, userName: 1 },
  miniApp_spinWheel:                    { chatId: 0, userName: 1 },
  miniApp_sellCard:                     { chatId: 0, userName: 1 },
  miniApp_getXPHistory:                 { chatId: 0, userName: 1 },
  miniApp_getLeagueMatches:             { chatId: 1, userName: 2 },
  miniApp_getMatchPredictions:          { chatId: 2, userName: 3 },
  miniApp_savePrediction:               { payload: true },
  // Без подмены идентичности (публичные данные / чужой профиль):
  miniApp_getUserStats:                 {},
  miniApp_getAvailableTours:            {},
  miniApp_getTourRating:                {},
  miniApp_getMatchHighlights:           {}
};

function handleApiRequest_(data) {
  const fn = String(data.fn || '');
  const args = data.args.slice();
  const initData = String(data.initData || '');

  // --- Админские функции: как раньше, по key + chatId (requireAdmin_ внутри) ---
  if (fn.indexOf('admin_') === 0) {
    return jsonOut_(safeCall_(fn, args));
  }

  if (fn.indexOf('miniApp_') !== 0) {
    return jsonOut_({ ok: false, error: 'Unknown function' });
  }

  // --- Валидация Telegram initData ---
  const tgUser = validateInitData_(initData);
  if (!tgUser) {
    return jsonOut_({ ok: false, error: 'auth', message: 'Ошибка авторизации Telegram. Закройте и откройте приложение заново.' });
  }

  const finalArgs = applyIdentity_(fn, args, tgUser);
  return jsonOut_(safeCall_(fn, finalArgs));
}

// Валидация Telegram initData: HMAC-SHA256 через чистый JS (hmacSha256Hex_),
// т.к. Utilities не принимает байтовый ключ для двойного HMAC.
function validateInitData_(initData) {
  if (!initData || !TOKEN) return null;
  try {
    const params = {};
    initData.split('&').forEach(function (p) {
      const i = p.indexOf('=');
      if (i > 0) params[p.substring(0, i)] = decodeURIComponent(p.substring(i + 1));
    });
    const hash = params.hash || '';
    if (!hash) return null;

    const checkString = Object.keys(params)
      .filter(function (k) { return k !== 'hash'; })
      .sort()
      .map(function (k) { return k + '=' + params[k]; })
      .join('\n');

    // secret = HMAC-SHA256(key="WebAppData", msg=TOKEN) — массив байт
    const secretBytes = Utilities.computeHmacSha256Signature(TOKEN, 'WebAppData');
    const computed = hmacSha256Hex_(secretBytes, checkString);

    if (computed !== hash) {
      Logger.log('\u2b55 initData: невалидная подпись');
      return null;
    }
    return params.user ? JSON.parse(params.user) : {};
  } catch (e) {
    Logger.log('initData validation error: ' + e);
    return null;
  }
}

// Подмена chatId/userName аргументов данными из валидированного initData
function applyIdentity_(fn, args, tgUser) {
  const map = API_IDENTITY_MAP_[fn];
  if (!map) return args;

  const chatId = tgUser.id ? String(tgUser.id) : args[map.chatId];
  const userName = ([tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') || tgUser.username || 'Участник').trim();

  if (map.payload) {
    // miniApp_savePrediction(payload) — объект в первом аргументе
    if (args[0] && typeof args[0] === 'object') {
      args[0] = Object.assign({}, args[0], { userName: userName, chatId: chatId });
    }
    return args;
  }
  if (typeof map.chatId === 'number' && args.length > map.chatId) args[map.chatId] = chatId;
  if (typeof map.userName === 'number' && args.length > map.userName) args[map.userName] = userName;
  return args;
}

function safeCall_(fn, args) {
  try {
    const f = globalThis[fn];
    if (typeof f !== 'function') return { ok: false, error: 'Function not found: ' + fn };
    return f.apply(null, args);
  } catch (err) {
    Logger.log('API error ' + fn + ': ' + err + '\n' + (err.stack || ''));
    return { ok: false, error: 'Ошибка сервера. Попробуйте позже.' };
  }
}

function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj == null ? {} : obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
//  ТРИГГЕР УВЕДОМЛЕНИЙ (был вызов без определения — функция «мёртвым кодом»)
// ============================================================
function setupNotifyTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'notifyUpcomingMatches') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('notifyUpcomingMatches').timeBased().everyMinutes(30).create();
  Logger.log('✅ Триггер notifyUpcomingMatches создан (каждые 30 мин)');
}
