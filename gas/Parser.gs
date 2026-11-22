// 2================== КОНСТАНТЫ2 (v2) ==================
// 🔧 Исправления v2:
//   - Добавлены отсутствующие THESPORTSDB_* константы
//   - Убран дубль normalizeMatchName (использует из Code.gs)
//   - Убран дубль calculatePoints → calcPointsForPrediction_
//   - getActiveSpreadsheet → openById(SHEET_ID)
//   - saveRatingSnapshot: безопасный no-op (используем user_points)
//   - editMessage: fallback на sendText
//   - createAllTriggers: только свои триггеры, один onEdit
//   - null-проверки счетов: != null (покрывает undefined)
//   - removeDuplicateRows: batch-read
//   - onEditNotifyMatches: после изменения счёта дергает syncMatchesToSupabase

const API_TOKEN = (typeof prop_ === 'function') ? prop_('FOOTBALL_API_KEY') : ''; // ключ в Script Properties
const BASE_URL = "https://api.football-data.org/v4";
const TARGET_YEAR = 2026;

// 🔧 FIX: были не определены — код UNL всегда падал с ReferenceError
// ⚠️ Проверь ID лиги на thesportsdb.com (может отличаться)
const THESPORTSDB_BASE_URL = "https://www.thesportsdb.com/api/v1/json/3";
const THESPORTSDB_UNL_LEAGUE_ID = "4481"; // UEFA Nations League

// СОЗДАЕМ АЛИАС ДЛЯ СОВМЕСТИМОСТИ
const LEAGUES_CONFIG = LEAGUES;

// ================== ПЕРЕВОД КОМАНД ==================
const TEAM_TRANSLATIONS = {
  // Английская Премьер-лига
  "Arsenal FC": "Арсенал",
  "Aston Villa FC": "Астон Вилла",
  "AFC Bournemouth": "Борнмут",
  "Brentford FC": "Брентфорд",
  "Brighton & Hove Albion FC": "Брайтон",
  "Chelsea FC": "Челси",
  "Crystal Palace FC": "Кристал Пэлас",
  "Everton FC": "Эвертон",
  "Fulham FC": "Фулхэм",
  "Hull City AFC": "Халл Сити",
  "Ipswich Town FC": "Ипсвич",
  "Leeds United FC": "Лидс",
  "Leicester City FC": "Лестер",
  "Liverpool FC": "Ливерпуль",
  "Manchester City FC": "Ман Сити",
  "Manchester United FC": "Ман Юн",
  "Newcastle United FC": "Ньюкасл",
  "Nottingham Forest FC": "Ноттингем",
  "Southampton FC": "Саутгемптон",
  "Tottenham Hotspur FC": "Тоттенхэм",
  "West Ham United FC": "Вест Хэм",
  "Wolverhampton Wanderers FC": "Вулверхэмптон",
  "Coventry City FC": "Ковентри",
  "Sunderland AFC": "Сандерленд",

  // Лига Чемпионов
  "Real Madrid CF": "Реал Мадрид",
  "ŠK Slovan Bratislava": "Слован Бр",
  "FC Barcelona": "Барселона",
  "Fenerbahçe SK": "Фенербахче",
  "AS Roma": "Рома",
  "Club Brugge KV": "Брюгге",
  "PAE AEK": "АЕК",
  "LASK Linz": "ЛАСК",
  "FC Internazionale Milano": "Интер",
  "Villarreal CF": "Вильяреал",
  "Lille OSC": "Лиль",
  "Real Betis Balompié": "Бетис",
  "Feyenoord Rotterdam": "Фейниорд",
  "VfB Stuttgart": "Штутгарт",
  "Viking FK": "Викинг",
  "Club Atlético de Madrid": "Атлетико М",
  "SSC Napoli": "Наполи",
  "Galatasaray SK": "Галатасарай",
  "PSV": "ПСВ",
  "FK Shakhtar Donetsk": "Шахтёр",
  "FK Bodø/Glimt": "БудёГлинт",
  "Sabah FK": "Сабах",
  "Como 1907": "Комо",
  "RB Leipzig": "Лейпциг",
  "SK Slavia Praha": "Славия П",
  "FC Bayern München": "Бавария",
  "Borussia Dortmund": "Боруссия Д",
  "Paris Saint-Germain FC": "ПСЖ",
  "Rangers FC": "Рейнджерс",

  // Ла Лига
  "Sevilla FC": "Севилья",
  "Real Sociedad de Fútbol": "Реал Сосьедад",
  "Athletic Club": "Атлетик Б",
  "Valencia CF": "Валенсия",
  "Levante UD": "Леванте",
  "RCD Mallorca": "Мальорка",
  "Celta de Vigo": "Сельта",
  "Getafe CF": "Хетафе",
  "CA Osasuna": "Осасуна",
  "Rayo Vallecano": "Райо Вальекано",
  "Deportivo Alavés": "Алавес",
  "UD Las Palmas": "Лас-Пальмас",
  "RCD Espanyol de Barcelona": "Эспаньол",
  "CD Leganés": "Леганес",
  "Rayo Vallecano de Madrid": "Райо Валье",
  "Elche CF": "Эльче",
  "RC Deportivo La Coruña": "Депортиво",
  "Real Racing Club de Santander": "Расинг",
  "Málaga CF": "Малага",

  // Серия А
  "AC Milan": "Милан",
  "Juventus FC": "Ювентус",
  "SS Lazio": "Лацио",
  "Atalanta BC": "Аталанта",
  "ACF Fiorentina": "Фиорентина",
  "Bologna FC 1909": "Болонья",
  "Torino FC": "Торино",
  "Udinese Calcio": "Удинезе",
  "Genoa CFC": "Дженоа",
  "US Lecce": "Лечче",
  "US Sassuolo Calcio": "Сассуоло",
  "Cagliari Calcio": "Кальяри",
  "Frosinone Calcio": "Фрозиноне",
  "Parma Calcio 1913": "Парма",
  "AC Monza": "Монца",
  "Venezia FC": "Венеция",

  // Лига наций
  "Albania": "Албания", "Andorra": "Андорра", " Armenia": "Армения",
  "Austria": "Австрия", "Azerbaijan": "Азербайджан", "Belarus": "Беларусь",
  "Belgium": "Бельгия", "Bosnia and Herzegovina": "Босния",
  "Bulgaria": "Болгария", "Croatia": "Хорватия", "Cyprus": "Кипр",
  "Czech Republic": "Чехия", "Czechia": "Чехия", "Denmark": "Дания",
  "England": "Англия", "Estonia": "Эстония", "Faroe Islands": "Фареры",
  "Finland": "Финляндия", "France": "Франция", "Georgia": "Грузия",
  "Germany": "Германия", "Gibraltar": "Гибралтар", "Greece": "Греция",
  "Hungary": "Венгрия", "Iceland": "Исландия", "Israel": "Израиль",
  "Italy": "Италия", "Kazakhstan": "Казахстан", "Kosovo": "Косово",
  "Latvia": "Латвия", "Liechtenstein": "Лихтенштейн", "Lithuania": "Литва",
  "Luxembourg": "Люксембург", "Malta": "Мальта", "Moldova": "Молдова",
  "Montenegro": "Черногория", "Netherlands": "Нидерланды",
  "North Macedonia": "С. Македония", "Norway": "Норвегия",
  "Poland": "Польша", "Portugal": "Португалия",
  "Republic of Ireland": "Ирландия", "Ireland": "Ирландия",
  "Romania": "Румыния", "Russia": "Россия", "San Marino": "Сан-Марино",
  "Scotland": "Шотландия", "Serbia": "Сербия", "Slovakia": "Словакия",
  "Slovenia": "Словения", "Spain": "Испания", "Sweden": "Швеция",
  "Switzerland": "Швейцария", "Turkey": "Турция", "Türkiye": "Турция",
  "Ukraine": "Украина", "Wales": "Уэльс",

  // Championship
  "Burnley FC": "Бёрнли", "Wolverhampton Wanderers": "Вулверхэмптон",
  "Millwall FC": "Миллуолл", "Lincoln City FC": "Линкольн",
  "Middlesbrough FC": "Мидлсбро", "Cardiff City FC": "Кардифф",
  "Watford FC": "Уотфорд", "Charlton Athletic FC": "Чарльтон",
  "Norwich City FC": "Норвич", "Portsmouth FC": "Портсмут",
  "Bolton Wanderers FC": "Болтон", "Bristol City FC": "Бристоль",
  "Sheffield United FC": "Шеффилд", "Birmingham City FC": "Бирмингем",
  "Queens Park Rangers FC": "Куинз Парк Рейнджерс",
  "Derby County FC": "Дерби Каунти", "Stoke City FC": "Сток Сити",
  "Swansea City AFC": "Суонси Сити", "West Ham United": "Вест Хэм",
  "West Bromwich Albion FC": "Вест Бромвичн", "Blackburn Rovers": "Блэкберн",
  "Wrexham AFC": "Рексхэм", "Preston North End FC": "Престон",

  // Франция
  "Le Mans FC": "Ле Ман", "Toulouse FC": "Тулуза",
  "RC Strasbourg Alsace": "Страсбур", "ES Troyes AC": "Труа",
  "Racing Club de Lens": "Ланс", "Stade Brestois 29": "Брест",
  "Angers SCO": "Анже", "Olympique de Marseille": "Марсель",
  "FC Lorient": "Лорьян", "AS Monaco FC": "Монако", "Paris FC": "Париж",
  "Stade Rennais FC 1901": "Ренн", "Le Havre AC": "Гавр",
  "AJ Auxerre": "Осер", "Olympique Lyonnais": "Лион", "OGC Nice": "Ницца",

  // Португалия
  "Vitória SC": "Витория Гим", "CS Marítimo": "Маритимо",
  "CF Estrela da Amadora": "Эштрела", "Casa Pia AC": "Каса Пиа",
  "FC Alverca": "Алверка", "FC Arouca": "Арока",
  "Gil Vicente FC": "Жил Висенто", "FC Porto": "Порто",
  "GD Estoril Praia": "Эшторил-Прая", "Moreirense FC": "Морейренси",
  "Rio Ave FC": "Рио Аве", "FC Famalicão": "Фамаликан",
  "CD Nacional": "Насьонал", "Sporting Clube de Braga": "Брага",
  "Sporting Clube de Portugal": "Спортинг",
  "Académico de Viseu FC": "Академико Визеу",
  "CD Santa Clara": "Санта Клара", "Sport Lisboa e Benfica": "Бенфика"
};

function translateTeamName(englishName) {
  return TEAM_TRANSLATIONS[englishName] || englishName;
}

// ================== ГЛАВНАЯ ФУНКЦИЯ ==================
// ============================================================
// ОБНОВЛЕНИЕ ВСЕХ ЛИГ — ЦЕПОЧКА ТРИГГЕРОВ
// Обходит лимит 6 минут: 1 лига за исполнение.
// ============================================================
const UPDATE_STATE_KEY = 'UPDATE_ALL_STATE_V1';
const UPDATE_STALE_MS  = 30 * 60 * 1000; // 30 мин — считаем state "зависшим"

/**
 * Точка входа (вызывается триггером раз в 6ч или вручную).
 * Сама работу НЕ делает — только инициализирует цепочку.
 */
function updateAllLeagues() {
  Logger.log("=== updateAllLeagues: СТАРТ ===");

  // Если уже идёт — не запускаем второй параллельно
  var existing = PropertiesService.getScriptProperties().getProperty(UPDATE_STATE_KEY);
  if (existing) {
    try {
      var parsed = JSON.parse(existing);
      var age = Date.now() - new Date(parsed.startedAt || 0).getTime();
      if (age < UPDATE_STALE_MS) {
        Logger.log("⚠️ Обновление уже идёт с " + parsed.startedAt +
                   " (шаг " + (parsed.currentIndex || 0) + "/" + (parsed.leagues || []).length + "). Пропускаем.");
        return;
      }
      Logger.log("🗑 Старое состояние (" + Math.round(age/60000) + " мин) — сбрасываем.");
    } catch (e) {
      Logger.log("Битый state — сбрасываем: " + e);
    }
  }

  var state = {
    startedAt:   new Date().toISOString(),
    leagues:     Object.keys(LEAGUES_CONFIG),
    currentIndex: 0,
    stage:       'leagues',
    finalStep:   0,
    updatedLeagues: []
  };
  PropertiesService.getScriptProperties()
    .setProperty(UPDATE_STATE_KEY, JSON.stringify(state));

  Logger.log("📋 В очереди лиг: " + state.leagues.length);
  processNextUpdateStep(); // первый шаг — сразу
}

/**
 * Универсальный шаг: либо обрабатывает 1 лигу, либо 1 финальный этап.
 * В конце планирует собственный следующий вызов через триггер.
 */
function processNextUpdateStep() {
  var raw = PropertiesService.getScriptProperties().getProperty(UPDATE_STATE_KEY);
  if (!raw) { Logger.log("Нет state — прерываемся"); return; }

  var state;
  try { state = JSON.parse(raw); }
  catch (e) { Logger.log("Битый state: " + e); return; }

  try {
    if (state.stage === 'leagues') {
      stepOneLeague_(state);
    } else if (state.stage === 'final') {
      stepFinal_(state);
    }
  } catch (e) {
    Logger.log("💥 Критическая ошибка шага: " + e);
    // Продвигаемся вперёд, чтобы не зависнуть навсегда
    if (state.stage === 'leagues') state.currentIndex++;
    else                          state.finalStep++;
    saveUpdateState_(state);
    scheduleNextUpdateStep_(15000);
  }
}

// ---------- Лиги ----------
function stepOneLeague_(state) {
  if (state.currentIndex >= state.leagues.length) {
    Logger.log("✅ Все лиги обработаны. → финальный этап");
    state.stage = 'final';
    state.finalStep = 0;
    saveUpdateState_(state);
    scheduleNextUpdateStep_(5000);
    return;
  }

  var code     = state.leagues[state.currentIndex];
  var position = (state.currentIndex + 1) + "/" + state.leagues.length;
  Logger.log("📥 Лига " + code + " (" + position + ") — старт");

  var t0 = Date.now();
  try {
    updateMatchResultsForLeague(code);
    Logger.log("✅ Лига " + code + " — готово за " +
               Math.round((Date.now() - t0) / 1000) + " сек");
    state.updatedLeagues.push(code);
  } catch (e) {
    Logger.log("❌ Ошибка лиги " + code + ": " + e);
  }

  state.currentIndex++;
  state.lastUpdatedAt = new Date().toISOString();
  saveUpdateState_(state);

  if (state.currentIndex < state.leagues.length) {
    Logger.log("⏳ Следующая лига через 15 сек (лимит API 10 req/min)");
    scheduleNextUpdateStep_(15000);
  } else {
    Logger.log("✅ Все лиги обработаны. → финальный этап");
    state.stage = 'final';
    state.finalStep = 0;
    saveUpdateState_(state);
    scheduleNextUpdateStep_(5000);
  }
}

// ---------- Финальные этапы ----------
function stepFinal_(state) {
  var steps = [
    { name: 'sync',    fn: syncMatchesToSupabase },  // ← ПЕРВЫМ: заливаем свежие счёта и прогнозы
    { name: 'ratings', fn: updateAllRatings },       // ← ПОТОМ: считаем очки (и в Sheets, и в user_points)
    { name: 'results', fn: generateResultsSheet }    // ← лист "Итоги" для отладки
  ];

  if (state.finalStep >= steps.length) {
    finishUpdateChain_();
    return;
  }

  var step = steps[state.finalStep];
  Logger.log('🔧 Этап ' + (state.finalStep + 1) + '/' + steps.length + ': ' + step.name);

  try {
    step.fn();
    Logger.log('✅ ' + step.name + ' — готово');
  } catch (e) {
    Logger.log('❌ Ошибка ' + step.name + ': ' + e);
    // Не глотаем молча — отправляем в админ-события
    try { logAdminEvent_('err', 'chain/' + step.name + ': ' + e.message); } catch (_) {}
  }

  state.finalStep++;
  saveUpdateState_(state);

  if (state.finalStep < steps.length) {
    scheduleNextUpdateStep_(5000);
  } else {
    finishUpdateChain_();
  }
}

function finishUpdateChain_() {
  Logger.log("🎉 === updateAllLeagues: ВСЁ ГОТОВО ===");
  PropertiesService.getScriptProperties().deleteProperty(UPDATE_STATE_KEY);
}

// ---------- Внутренние хелперы ----------
function saveUpdateState_(state) {
  try {
    PropertiesService.getScriptProperties()
      .setProperty(UPDATE_STATE_KEY, JSON.stringify(state));
  } catch (e) { Logger.log("saveUpdateState_: " + e); }
}

function scheduleNextUpdateStep_(delayMs) {
  var fnName = 'processNextUpdateStep';

  // Удаляем старые CLOCK-триггеры с тем же handler, чтобы не плодить
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === fnName &&
        t.getEventType() === ScriptApp.EventType.CLOCK) {
      try { ScriptApp.deleteTrigger(t); } catch (e) {}
    }
  });

  ScriptApp.newTrigger(fnName)
    .timeBased()
    .after(delayMs || 5000)
    .create();
  Logger.log("⏰ Запланирован следующий шаг через " + Math.round((delayMs||5000)/1000) + " сек");
}

// ---------- Диагностика (для ручного запуска) ----------
function resetUpdateState() {
  PropertiesService.getScriptProperties().deleteProperty(UPDATE_STATE_KEY);
  Logger.log("🗑 Состояние обновления сброшено.");
}

// ================== ЛИГА НАЦИЙ (TheSportsDB) ==================
function fetchNationsLeagueFromTheSportsDB(season) {
  try {
    const url = `${THESPORTSDB_BASE_URL}/eventsseason.php?id=${THESPORTSDB_UNL_LEAGUE_ID}&s=${season}`;
    const response = UrlFetchApp.fetch(url, { method: "get", muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) {
      Logger.log(`TheSportsDB ошибка: ${response.getContentText()}`);
      return [];
    }
    const data = JSON.parse(response.getContentText());
    const events = data.events || [];
    Logger.log(`TheSportsDB: получено ${events.length} матчей Лиги наций за ${season}`);

    return events.map(e => ({
      utcDate: (e.strTimestamp || (e.dateEvent + "T" + (e.strTime || "00:00:00"))) + "Z",
      matchday: e.intRound ? parseInt(e.intRound, 10) : null,
      status: convertTheSportsDBStatus(e.strStatus),
      homeTeam: { name: e.strHomeTeam },
      awayTeam: { name: e.strAwayTeam },
      score: {
        fullTime: {
          home: e.intHomeScore !== null && e.intHomeScore !== undefined ? Number(e.intHomeScore) : null,
          away: e.intAwayScore !== null && e.intAwayScore !== undefined ? Number(e.intAwayScore) : null
        }
      }
    }));
  } catch (e) {
    Logger.log("fetchNationsLeagueFromTheSportsDB error: " + e);
    return [];
  }
}

function convertTheSportsDBStatus(status) {
  const s = String(status || "").toUpperCase();
  if (s === "FT" || s === "AET" || s === "PEN" || s === "MATCH FINISHED") return "FINISHED";
  if (s === "NS" || s === "NOT STARTED" || s === "SCHEDULED") return "SCHEDULED";
  if (s === "1H" || s === "2H" || s === "HT" || s === "LIVE" || s === "IN_PLAY") return "IN_PLAY";
  if (s === "POSTP" || s === "CANC") return "CANCELLED";
  return s;
}

// ================== ОБНОВЛЕНИЕ КОНКРЕТНОЙ ЛИГИ ==================
function updateMatchResultsForLeague(leagueCode) {
  try {
    const config = LEAGUES_CONFIG[leagueCode];
    if (!config) { Logger.log(`Лига ${leagueCode} не найдена`); return; }

    Logger.log(`=== Обновление ${config.name} (${leagueCode}) ===`);

    let allMatches;
    if (leagueCode === "UNL") {
      const season = `${TARGET_YEAR}-${TARGET_YEAR + 1}`;
      allMatches = fetchNationsLeagueFromTheSportsDB(season);
      Logger.log(`Источник: TheSportsDB (сезон ${season})`);
    } else {
      allMatches = fetchAllMatchesForLeague(config.competition);
    }
    if (!allMatches || allMatches.length === 0) {
      Logger.log(`Не удалось получить данные о матчах для ${config.name}`);
      return;
    }
    Logger.log(`Получено ${allMatches.length} матчей всего.`);

    const matches = allMatches.filter(m => m.utcDate && new Date(m.utcDate).getFullYear() === TARGET_YEAR);
    Logger.log(`За ${TARGET_YEAR} год: ${matches.length} матчей.`);
    if (matches.length === 0) { Logger.log(`Нет матчей за ${TARGET_YEAR} год.`); return; }

    const grouped = groupMatchesByMatchday(matches);
    const matchdayNumbers = Object.keys(grouped).map(Number).sort((a, b) => a - b);
    Logger.log(`Найдено туров: ${matchdayNumbers.length}`);
    if (matchdayNumbers.length === 0) { Logger.log("Нет туров с матчами."); return; }

    // 🔧 FIX: openById вместо getActiveSpreadsheet (иначе падает по триггеру)
    let sheet;
    try {
      const spreadsheet = SpreadsheetApp.openById(SHEET_ID);
      sheet = spreadsheet.getSheetByName(config.sheetName);
      if (!sheet) sheet = spreadsheet.insertSheet(config.sheetName);
    } catch (e) {
      throw new Error(`Ошибка доступа к таблице: ${e.toString()}`);
    }

    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, 5).setValues([["Тур", "Дата", "Матч", "Счёт", "Победитель"]]);
      sheet.getRange(1, 1, 1, 5).setFontWeight("bold");
    }

    let { existing, existingTours } = buildExistingMapAndTours(sheet);
    removeDuplicateRows(sheet, existing);

    const resultAfterClean = buildExistingMapAndTours(sheet);
    existing = resultAfterClean.existing;
    existingTours = resultAfterClean.existingTours;

    const groupedTourSet = new Set(matchdayNumbers);
    const validExistingTours = new Set([...existingTours].filter(t => groupedTourSet.has(t)));

    const sortedTours = matchdayNumbers.sort((a, b) => a - b);
    let firstMissingTour = null;
    for (const tour of sortedTours) {
      if (!validExistingTours.has(tour)) { firstMissingTour = tour; break; }
    }

    if (firstMissingTour !== null) {
      const hasExistingTours = validExistingTours.size > 0;

      if (!hasExistingTours) {
        Logger.log(`📌 Таблица пуста. Добавляем первый тур ${sortedTours[0]}.`);
        addMatchesForTour(sheet, sortedTours[0], grouped[sortedTours[0]], existing);
        const updated = buildExistingMapAndTours(sheet);
        existing = updated.existing;
        validExistingTours.add(sortedTours[0]);
        firstMissingTour = sortedTours[1] || null;
      }

      if (firstMissingTour !== null) {
        let maxAddedTour = 0;
        for (const tour of validExistingTours) if (tour > maxAddedTour) maxAddedTour = tour;

        const isMaxTourFinished = isMatchdayFinished(maxAddedTour, grouped);

        if (isMaxTourFinished) {
          const nextTour = maxAddedTour + 1;
          if (grouped[nextTour] && !validExistingTours.has(nextTour)) {
            Logger.log(`✅ Тур ${maxAddedTour} завершен. Добавляем следующий тур ${nextTour}.`);
            addMatchesForTour(sheet, nextTour, grouped[nextTour], existing);
            const updated = buildExistingMapAndTours(sheet);
            existing = updated.existing;
            validExistingTours.add(nextTour);
          }
        } else {
          const allHaveScores = checkAllMatchesHaveScores(maxAddedTour, grouped, sheet);
          if (allHaveScores) {
            const nextTour = maxAddedTour + 1;
            if (grouped[nextTour] && !validExistingTours.has(nextTour)) {
              Logger.log(`✅ Тур ${maxAddedTour}: все матчи имеют счет. Добавляем следующий тур ${nextTour}.`);
              addMatchesForTour(sheet, nextTour, grouped[nextTour], existing);
              const updated = buildExistingMapAndTours(sheet);
              existing = updated.existing;
              validExistingTours.add(nextTour);
            }
          }
        }
      }
    }

    const finalMap = buildExistingMapAndTours(sheet);
    updateScores(sheet, grouped, finalMap.existing);

    const finalCleanMap = buildExistingMapAndTours(sheet);
    removeDuplicateRows(sheet, finalCleanMap.existing);

    Logger.log(`=== Обновление ${config.name} завершено ===`);
  } catch (error) {
    Logger.log(`Сбой для ${leagueCode}: ${error.toString()}`);
  }
}

// ================== ПРОВЕРКА НАЛИЧИЯ СЧЕТОВ ==================
function checkAllMatchesHaveScores(matchday, grouped, sheet) {
  const matches = grouped[matchday];
  if (!matches || matches.length === 0) return false;

  const rows = sheet.getDataRange().getValues();
  const matchScores = {};

  for (let i = 1; i < rows.length; i++) {
    const tourStr = String(rows[i][0] || "").trim();
    const matchName = String(rows[i][2] || "").trim();
    const score = String(rows[i][3] || "").trim();
    if (tourStr && matchName) {
      const tourNum = parseInt(tourStr.replace(/[^\d]/g, ''), 10);
      if (!isNaN(tourNum) && tourNum === matchday) matchScores[matchName] = score;
    }
  }

  let scoresCount = 0;
  for (const match of matches) {
    const home = match.homeTeam ? translateTeamName(match.homeTeam.name) : "Команда 1";
    const away = match.awayTeam ? translateTeamName(match.awayTeam.name) : "Команда 2";
    const matchName = `${home} - ${away}`;
    const score = matchScores[matchName] || "";
    if (score && score !== "-" && score !== "—") scoresCount++;
  }

  const allHaveScores = scoresCount === matches.length;
  Logger.log(`Тур ${matchday}: ${scoresCount}/${matches.length} имеют счета. Все: ${allHaveScores}`);
  return allHaveScores;
}

// ================== API FOOTBALL-DATA ==================
function fetchAllMatchesForLeague(competition) {
  let allMatches = [];
  let page = 1;
  const limit = 100;
  let total = Infinity;

  while ((page - 1) * limit < total) {
    const url = `${BASE_URL}/competitions/${competition}/matches?limit=${limit}&offset=${(page - 1) * limit}`;
    const options = {
      method: "get",
      headers: { "X-Auth-Token": API_TOKEN },
      muteHttpExceptions: true
    };

    try {
      const response = UrlFetchApp.fetch(url, options);
      const status = response.getResponseCode();
      if (status !== 200) {
        Logger.log(`Ошибка API (статус ${status}): ${response.getContentText()}`);
        break;
      }
      const data = JSON.parse(response.getContentText());
      if (!data.matches || data.matches.length === 0) break;

      allMatches = allMatches.concat(data.matches);
      if (data.resultSet && typeof data.resultSet.count === 'number') {
        total = data.resultSet.count;
      } else {
        if (data.matches.length < limit) total = (page - 1) * limit + data.matches.length;
      }
      page++;
      Utilities.sleep(7000);
    } catch (e) {
      Logger.log("Сбой при вызове UrlFetchApp: " + e.toString());
      break;
    }
  }
  return allMatches;
}

function groupMatchesByMatchday(matches) {
  const grouped = {};
  for (const m of matches) {
    const md = m.matchday;
    if (!md) continue;
    if (!grouped[md]) grouped[md] = [];
    grouped[md].push(m);
  }
  return grouped;
}

function formatDate(utcString) {
  if (!utcString) return "";
  try {
    const d = new Date(utcString);
    if (isNaN(d.getTime())) return "";
    return d.toISOString().replace(/\.\d{3}Z$/, "Z");
  } catch (e) {
    Logger.log("formatDate error: " + e);
    return "";
  }
}

function buildExistingMapAndTours(sheet) {
  const map = new Map();
  const tours = new Set();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { existing: map, existingTours: tours };

  const values = sheet.getRange(2, 1, lastRow - 1, 3).getValues();

  for (let i = 0; i < values.length; i++) {
    const tourStr = values[i][0];
    const match = values[i][2];
    if (tourStr && match) {
      const num = parseInt(tourStr.toString().replace(/[^\d]/g, ''), 10);
      if (!isNaN(num)) {
        tours.add(num);
        const key = `${num}_${match}`;
        if (!map.has(key)) map.set(key, i + 2);
      }
    }
  }
  return { existing: map, existingTours: tours };
}

// 🔧 FIX: было N+1 чтение (getRange в цикле). Теперь batch-read.
function removeDuplicateRows(sheet, existing) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const values = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  const rowsToDelete = [];

  for (let i = 0; i < values.length; i++) {
    const tourVal = values[i][0];
    const matchVal = values[i][2];
    if (!tourVal || !matchVal) continue;
    const num = parseInt(String(tourVal).replace(/[^\d]/g, ''), 10);
    if (isNaN(num)) continue;
    const key = `${num}_${matchVal}`;
    const rowNum = i + 2;
    if (existing.has(key) && existing.get(key) !== rowNum) rowsToDelete.push(rowNum);
  }

  if (rowsToDelete.length > 0) {
    rowsToDelete.sort((a, b) => b - a);
    for (const r of rowsToDelete) sheet.deleteRow(r);
    Logger.log(`Удалено ${rowsToDelete.length} дублирующихся строк.`);
  }
}

function isMatchdayFinished(matchday, grouped) {
  const matches = grouped[matchday];
  if (!matches || matches.length === 0) return false;

  let finishedCount = 0;
  for (const match of matches) {
    if (match.status === "FINISHED") { finishedCount++; continue; }
    // 🔧 FIX: != null покрывает и undefined
    if (match.score && match.score.fullTime
        && match.score.fullTime.home != null && match.score.fullTime.away != null) {
      finishedCount++; continue;
    }
    if (match.score && match.score.extraTime
        && match.score.extraTime.home != null && match.score.extraTime.away != null) {
      finishedCount++; continue;
    }
  }

  const allFinished = finishedCount === matches.length;
  if (allFinished) {
    Logger.log(`✅ Тур ${matchday} завершен.`);
  } else {
    Logger.log(`⏳ Тур ${matchday}: ${finishedCount}/${matches.length}.`);
  }
  return allFinished;
}

function addMatchesForTour(sheet, tourNum, matches, existingMap) {
  matches.sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));

  const rowsToAppend = [];
  for (const match of matches) {
    const home = match.homeTeam ? translateTeamName(match.homeTeam.name) : "Команда 1";
    const away = match.awayTeam ? translateTeamName(match.awayTeam.name) : "Команда 2";
    const matchName = `${home} - ${away}`;
    const key = `${tourNum}_${matchName}`;

    if (!existingMap.has(key)) {
      const dateStr = formatDate(match.utcDate);
      let score = "";
      let winner = "";

      if (match.status === "FINISHED" && match.score && match.score.fullTime) {
        const h = match.score.fullTime.home;
        const a = match.score.fullTime.away;
        // 🔧 FIX: != null
        if (h != null && a != null && !isNaN(h) && !isNaN(a)) {
          score = `${h}-${a}`;
          if (h > a) winner = "П1";
          else if (a > h) winner = "П2";
          else winner = "Ничья";
        }
      }
      rowsToAppend.push([`Тур ${tourNum}`, dateStr, matchName, score, winner]);
    }
  }

  if (rowsToAppend.length > 0) {
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, rowsToAppend.length, 5).setValues(rowsToAppend);
    Logger.log(`✅ Добавлено ${rowsToAppend.length} матчей тура ${tourNum}`);
  } else {
    Logger.log(`⚠️ Нет новых матчей для тура ${tourNum}`);
  }
}

function updateScores(sheet, grouped, existingMap) {
  const updateData = [];

  for (const matchday of Object.keys(grouped)) {
    for (const match of grouped[matchday]) {
      const home = match.homeTeam ? translateTeamName(match.homeTeam.name) : "Команда 1";
      const away = match.awayTeam ? translateTeamName(match.awayTeam.name) : "Команда 2";
      const matchName = `${home} - ${away}`;
      const key = `${matchday}_${matchName}`;

      if (!existingMap.has(key)) continue;
      const rowNum = existingMap.get(key);
      let score = "";
      let winner = "";

      if (match.status === "FINISHED" && match.score) {
        // 🔧 FIX: != null вместо !== null
        if (match.score.fullTime
            && match.score.fullTime.home != null && match.score.fullTime.away != null) {
          score = `${match.score.fullTime.home}-${match.score.fullTime.away}`;
        }
        if (!score && match.score.extraTime
            && match.score.extraTime.home != null && match.score.extraTime.away != null) {
          score = `${match.score.extraTime.home}-${match.score.extraTime.away}`;
        }
        if (!score && match.score.penalties
            && match.score.penalties.home != null && match.score.penalties.away != null) {
          score = `${match.score.penalties.home}-${match.score.penalties.away}`;
        }

        if (score) {
          const [h, a] = score.split('-').map(x => parseInt(x, 10));
          if (h > a) winner = "П1";
          else if (a > h) winner = "П2";
          else winner = "Ничья";
        }
      }
      if (score) updateData.push({ rowNum, score, winner });
    }
  }

  if (updateData.length > 0) {
    const rows = updateData.map(u => u.rowNum);
    const minRow = Math.min(...rows);
    const maxRow = Math.max(...rows);

    const range = sheet.getRange(minRow, 4, maxRow - minRow + 1, 2);
    const values = range.getValues();

    const updateMap = {};
    updateData.forEach(u => { updateMap[u.rowNum] = [u.score, u.winner]; });

    for (let i = 0; i < values.length; i++) {
      const rowNum = minRow + i;
      if (updateMap[rowNum]) {
        values[i][0] = updateMap[rowNum][0];
        values[i][1] = updateMap[rowNum][1];
      }
    }
    range.setValues(values);
    Logger.log(`Обновлено счетов: ${updateData.length}`);
  }
}

// ================== РЕЙТИНГ ==================
// 🔧 FIX: эта функция больше НЕ перезаписывает глобальную normalizeMatchName.
// Используем normalizeMatchName_ из Code.gs (единая версия).

// 🔧 FIX: saveRatingSnapshot теперь no-op (в Code.gs уже user_points).
// Старая реализация писала в тот же "Рейтинг" и ломала данные.
function saveRatingSnapshot() {
  // Место для истории стрелок ↑↓. Сейчас не используется в WebApp.
  // Можно реализовать отдельно в лист "Рейтинг_История".
  Logger.log('saveRatingSnapshot: no-op (используем user_points)');
}

/**
 * Считает очки по всем лигам и пишет:
 *   1. в лист "Рейтинг" (Sheets) — как раньше
 *   2. в таблицу user_points (Supabase) — НОВОЕ
 *
 * Также начисляет XP за попадания (через logXPAward_ — только один раз).
 */
function updateAllRatings() {
  Logger.log('=== updateAllRatings: СТАРТ ===');
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);

    // 1. Реальные счета по всем лигам
    var allMatchData = {};
    for (var code in LEAGUES_CONFIG) {
      var cfg = LEAGUES_CONFIG[code];
      var matchesSheet = ss.getSheetByName(cfg.sheetName);
      if (!matchesSheet) continue;

      var lastRow = matchesSheet.getLastRow();
      if (lastRow < 2) { allMatchData[code] = {}; continue; }

      var matches = matchesSheet.getRange(2, 1, lastRow - 1, 5).getValues();
      var matchData = {};
      for (var i = 0; i < matches.length; i++) {
        var matchName = matches[i][2];
        var realScore = matches[i][3];
        if (matchName && realScore
            && String(realScore).trim() !== ''
            && String(realScore).trim() !== '-') {
          var norm = normalizeMatchName_(matchName);
          matchData[norm] = String(realScore).replace(/:/g, '-').replace(/\s/g, '');
        }
      }
      allMatchData[code] = matchData;
    }

    // 2. Прогнозы (последний по каждому user+league+match)
    var predSheet = ss.getSheetByName('Ответы на форму (3)');
    if (!predSheet) {
      Logger.log('❌ Лист "Ответы на форму (3)" не найден');
      return;
    }
    var pLast = predSheet.getLastRow();
    if (pLast < 2) {
      Logger.log('⚠️ Прогнозов нет');
      return;
    }
    var predictions = predSheet.getRange(2, 1, pLast - 1, 6).getValues();

    var userMatchPredictions = {};
    for (var p = 0; p < predictions.length; p++) {
      var userName = String(predictions[p][1] || '').trim();
      if (!userName) continue;

      var matchName = String(predictions[p][2] || '').trim();
      if (!matchName) continue;

      var outcome   = String(predictions[p][3] || '').trim();
      var score     = String(predictions[p][4] || '').trim();
      var leagueCode = String(predictions[p][5] || 'PL').trim() || 'PL';
      var dateMs    = predictions[p][0] instanceof Date
        ? predictions[p][0].getTime() : 0;

      var normMatch = normalizeMatchName_(matchName);
      var key = leagueCode + '_' + normMatch;

      if (!userMatchPredictions[userName]) userMatchPredictions[userName] = {};
      var prev = userMatchPredictions[userName][key];
      if (!prev || dateMs > prev.date) {
        userMatchPredictions[userName][key] = {
          outcome: outcome,
          score:   score,
          date:    dateMs,
          league:  leagueCode,
          match:   normMatch
        };
      }
    }

    // 3. Очки + XP
    var userStats = {};
    var leagueCodes = Object.keys(LEAGUES_CONFIG);

    for (var user in userMatchPredictions) {
      userStats[user] = { total: 0, leagues: {} };
      leagueCodes.forEach(function (c) { userStats[user].leagues[c] = 0; });

      var matchesObj = userMatchPredictions[user];
      for (var key in matchesObj) {
        var pred = matchesObj[key];
        var leagueData = allMatchData[pred.league] || {};
        var realScore = leagueData[pred.match];
        if (!realScore) continue;

        var res = calcPointsForPrediction_(pred.outcome, pred.score, realScore);
        var points = res.points;

        userStats[user].total += points;
        userStats[user].leagues[pred.league] += points;

        // XP за попадания (только один раз на match+reason)
        var gmMatchKey = pred.league + '||' + pred.match;

        if (points === 5) {
          if (!wasXPAwarded_(user, gmMatchKey, 'exactScore')) {
            addXP_(user, XP_REWARDS.exactScore, 'exactScore');
            logXPAward_(user, gmMatchKey, 'exactScore', XP_REWARDS.exactScore);
            bumpTasks_(user, 'exactScore');
            bumpTasks_(user, 'outcomeHit');
            checkBothScoredTask_(user, realScore);
            checkStreakAchievements_(user);
          }
        } else if (points === 3) {
          if (!wasXPAwarded_(user, gmMatchKey, 'diffHit')) {
            addXP_(user, XP_REWARDS.diffHit, 'diffHit');
            logXPAward_(user, gmMatchKey, 'diffHit', XP_REWARDS.diffHit);
            bumpTasks_(user, 'outcomeHit');
            checkBothScoredTask_(user, realScore);
            checkStreakAchievements_(user);
          }
        } else if (points === 1) {
          if (!wasXPAwarded_(user, gmMatchKey, 'outcomeHit')) {
            addXP_(user, XP_REWARDS.outcomeHit, 'outcomeHit');
            logXPAward_(user, gmMatchKey, 'outcomeHit', XP_REWARDS.outcomeHit);
            bumpTasks_(user, 'outcomeHit');
            checkStreakAchievements_(user);
          }
        }
      }
    }

    // 4. Лист "Рейтинг" (Sheets) — как раньше
    var ratingSheet = ss.getSheetByName('Рейтинг');
    if (!ratingSheet) {
      ratingSheet = ss.insertSheet('Рейтинг');
      var headers = ['Участник', 'Всего очков', 'Chat ID'];
      leagueCodes.forEach(function (c) {
        headers.push(LEAGUES_CONFIG[c].emoji + ' ' + LEAGUES_CONFIG[c].name);
      });
      ratingSheet.appendRow(headers);
      ratingSheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    }

    // Сохраняем существующие chat_id
    var existingChatIds = {};
    var ratingLast = ratingSheet.getLastRow();
    if (ratingLast >= 2) {
      var ratingData = ratingSheet.getRange(2, 1, ratingLast - 1, 3).getValues();
      for (var r = 0; r < ratingData.length; r++) {
        var u = String(ratingData[r][0] || '').trim();
        var cId = ratingData[r][2];
        if (u && cId) existingChatIds[u] = cId;
      }
      ratingSheet.deleteRows(2, ratingLast - 1);
    }

    var dataToWrite = [];
    for (var usr in userStats) {
      var stats = userStats[usr];
      var row = [usr, stats.total, existingChatIds[usr] || ''];
      leagueCodes.forEach(function (c) { row.push(stats.leagues[c] || 0); });
      dataToWrite.push(row);
    }
    if (dataToWrite.length) {
      dataToWrite.sort(function (a, b) { return b[1] - a[1]; });
      ratingSheet.getRange(2, 1, dataToWrite.length, 3 + leagueCodes.length)
        .setValues(dataToWrite);
    }
    Logger.log('✅ Рейтинг в Sheets обновлён. Участников: ' + Object.keys(userStats).length);

    // ─────────────────────────────────────────
    // 5. 🆕 СИНК В SUPABASE user_points
    // ─────────────────────────────────────────
    var totalUsersSynced = 0;
    for (var uname in userStats) {
      var st = userStats[uname];
      try {
        supabaseRequest_('user_points?on_conflict=user_name', {
          method: 'post',
          body: [{
            user_name:     uname,
            total_points:  st.total,
            per_league:    st.leagues,
            updated_at:    new Date().toISOString()
          }],
          prefer: 'return=minimal,resolution=merge-duplicates'
        });
        totalUsersSynced++;
      } catch (e) {
        Logger.log('❌ user_points upsert [' + uname + ']: ' + e);
      }
    }
    Logger.log('✅ user_points в Supabase обновлено: ' + totalUsersSynced);

    // 6. Сброс кэша
    bumpTablesCache_(['user_points', 'predictions', 'matches']);

    Logger.log('=== updateAllRatings: ГОТОВО ===');
  } catch (err) {
    Logger.log('❌ updateAllRatings ERROR: ' + err);
    throw err;
  }
}

function generateResultsSheet() {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);

    const allMatchData = {};
    for (const [code, config] of Object.entries(LEAGUES_CONFIG)) {
      const matchesSheet = ss.getSheetByName(config.sheetName);
      if (!matchesSheet) continue;

      const matchesData = matchesSheet.getDataRange().getValues();
      const matchMap = {};
      for (let i = 1; i < matchesData.length; i++) {
        const matchName = matchesData[i][2];
        const realScore = matchesData[i][3];
        const realOutcome = matchesData[i][4];
        if (!matchName) continue;
        if (realScore && String(realScore).trim() !== "" && String(realScore).trim() !== "-") {
          const scoreStr = String(realScore).trim();
          if (/^\d+\s*[-:]\s*\d+$/.test(scoreStr)) {
            const norm = normalizeMatchName_(matchName);
            matchMap[norm] = {
              originalName: matchName,
              realScore: scoreStr.replace(/:/g, "-"),
              realOutcome: realOutcome || "",
              league: code
            };
          }
        }
      }
      allMatchData[code] = matchMap;
    }

    const predSheet = ss.getSheetByName("Ответы на форму (3)");
    if (!predSheet) { Logger.log("Лист 'Ответы на форму (3)' не найден"); return; }
    const predData = predSheet.getDataRange().getValues();

    const userMatchPredictions = {};
    for (let i = 1; i < predData.length; i++) {
      const userName = String(predData[i][1]).trim();
      if (!userName) continue;
      const match = String(predData[i][2]).trim();
      const outcome = String(predData[i][3]).trim();
      const score = String(predData[i][4]).trim();
      const leagueCode = predData[i][5] || "PL";
      const date = predData[i][0] ? new Date(predData[i][0]).getTime() : 0;
      const normMatch = normalizeMatchName_(match);
      const key = `${leagueCode}_${normMatch}`;

      if (!userMatchPredictions[userName]) userMatchPredictions[userName] = {};
      if (!userMatchPredictions[userName][key] || date > userMatchPredictions[userName][key].date) {
        userMatchPredictions[userName][key] = {
          outcome: outcome, score: score, date: date,
          originalMatchName: match, league: leagueCode
        };
      }
    }

    const resultRows = [];
    resultRows.push(["Лига", "Матч", "Участник", "Прогноз (исход)", "Прогноз (счёт)", "Реальный счёт", "Очки"]);

    for (const [user, matches] of Object.entries(userMatchPredictions)) {
      for (const pred of Object.values(matches)) {
        const leagueCode = pred.league || "PL";
        const matchInfo = allMatchData[leagueCode]?.[normalizeMatchName_(pred.originalMatchName)];
        if (!matchInfo || !matchInfo.realScore) continue;

        // 🔧 FIX: calculatePoints → calcPointsForPrediction_
        const points = calcPointsForPrediction_(pred.outcome, pred.score, matchInfo.realScore).points;
        const leagueEmoji = LEAGUES_CONFIG[leagueCode]?.emoji || "🏆";
        resultRows.push([
          leagueEmoji + " " + (LEAGUES_CONFIG[leagueCode]?.name || leagueCode),
          matchInfo.originalName, user, pred.outcome,
          pred.score.replace(/:/g, "-"), matchInfo.realScore, points
        ]);
      }
    }

    let resultsSheet = ss.getSheetByName("Итоги");
    if (!resultsSheet) resultsSheet = ss.insertSheet("Итоги");
    else resultsSheet.clear();

    if (resultRows.length > 1) {
      resultsSheet.getRange(1, 1, resultRows.length, resultRows[0].length).setValues(resultRows);
      resultsSheet.getRange(1, 1, 1, resultRows[0].length).setFontWeight("bold");
      resultsSheet.autoResizeColumns(1, resultRows[0].length);
    }
    Logger.log("Лист 'Итоги' обновлён. Записей: " + (resultRows.length - 1));
  } catch (error) {
    Logger.log("Ошибка в generateResultsSheet: " + error);
  }
}

// ================== ЛИСТЫ ==================
function createAllLeagueSheets() {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    for (const [code, config] of Object.entries(LEAGUES_CONFIG)) {
      let sheet = ss.getSheetByName(config.sheetName);
      if (!sheet) {
        sheet = ss.insertSheet(config.sheetName);
        sheet.getRange(1, 1, 1, 5).setValues([["Тур", "Дата", "Матч", "Счёт", "Победитель"]]);
        sheet.getRange(1, 1, 1, 5).setFontWeight("bold");
        sheet.autoResizeColumns(1, 5);
        Logger.log(`✅ Создан лист ${config.sheetName}`);
      }
    }

    let predSheet = ss.getSheetByName("Ответы на форму (3)");
    if (predSheet) {
      const headers = predSheet.getRange(1, 1, 1, 6).getValues()[0];
      if (headers.length < 6 || String(headers[5] || "").trim() !== "Код лига") {
        predSheet.getRange(1, 6).setValue("Код лига");
        predSheet.getRange(1, 6).setFontWeight("bold");
        Logger.log("✅ Добавлена колонка 'Код лига'");
      }
    }
    Logger.log("✅ Все листы созданы/проверены");
  } catch (error) {
    Logger.log("Ошибка: " + error);
  }
}

// ================== ТРИГГЕРЫ ==================
// 🔧 FIX: удаляет только СВОИ триггеры, не убивает notifyUpcomingMatches
// 🔧 FIX: один onEditNotifyMatches, а не 8
function createAllTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    const fn = trigger.getHandlerFunction();
    if (fn === 'updateAllLeagues' || fn === 'onEditNotifyMatches') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger('updateAllLeagues')
    .timeBased()
    .everyHours(6)
    .create();

  // Один триггер на редактирование
  ScriptApp.newTrigger('onEditNotifyMatches')
    .forSpreadsheet(SHEET_ID)
    .onEdit()
    .create();

  Logger.log("✅ Триггеры созданы (updateAllLeagues, onEditNotifyMatches)");
}

function onEditNotifyMatches(e) {
  try {
    if (!e || !e.range) return;
    var sheet = e.range.getSheet();
    var sheetName = sheet.getName();

    var isMatchSheet = false;
    for (var c in LEAGUES_CONFIG) {
      if (sheetName === LEAGUES_CONFIG[c].sheetName) { isMatchSheet = true; break; }
    }
    if (!isMatchSheet) return;

    var row = e.range.getRow();
    var col = e.range.getColumn();
    if ((col === 4 || col === 5) && row > 1) {
      Logger.log('onEdit счёта в ' + sheetName + ', row=' + row + ' col=' + col);

      // 1. Синк в Supabase (matches + predictions + user_points)
      try {
        syncMatchesToSupabase();
      } catch (err) {
        Logger.log('❌ syncMatchesToSupabase в onEdit: ' + err);
      }

      // 2. Пересчёт листа "Рейтинг" (он же перезапишет user_points)
      try {
        updateAllRatings();
      } catch (err) {
        Logger.log('❌ updateAllRatings в onEdit: ' + err);
      }

      Logger.log('✅ onEdit: Sheets + Supabase обновлены');
    }
  } catch (error) {
    Logger.log('❌ onEditNotifyMatches: ' + error);
  }
}

// ================== МАТЧИ (устаревший код бота на кнопках) ==================
// ⚠️ Эти функции сейчас не используются WebApp-версией.
// Оставлены для совместимости. editMessage → fallback на sendText.

function _editOrSend(chatId, messageId, text, keyboard) {
  // 🔧 FIX: editMessage не была определена — падало с ReferenceError.
  // Теперь — пробуем edit, при ошибке send.
  if (messageId) {
    try {
      UrlFetchApp.fetch("https://api.telegram.org/bot" + TOKEN + "/editMessageText", {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify({
          chat_id: chatId, message_id: messageId,
          text: text, parse_mode: "Markdown",
          reply_markup: keyboard
        }),
        muteHttpExceptions: true
      });
      return;
    } catch (e) {
      Logger.log("editMessage fallback: " + e);
    }
  }
  sendText(chatId, text, keyboard);
}

function showMatchesForLeague(chatId, messageId, userName, leagueCode) {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const league = LEAGUES[leagueCode];
    if (!league) { sendText(chatId, "❌ Лига не найдена."); return; }

    const predictionsSheet = ss.getSheetByName("Ответы на форму (3)");
    const predRows = predictionsSheet.getDataRange().getValues();
    const userPredictedMatches = new Set();

    for (let j = 1; j < predRows.length; j++) {
      if (String(predRows[j][1]).trim() === String(userName).trim()) {
        const predLeague = predRows[j][5] || "PL";
        if (predLeague === leagueCode) {
          userPredictedMatches.add(normalizeMatchName_(predRows[j][2]));
        }
      }
    }

    let sheet = ss.getSheetByName(league.sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(league.sheetName);
      sheet.getRange(1, 1, 1, 5).setValues([["Тур", "Дата", "Матч", "Счёт", "Победитель"]]);
      sheet.getRange(1, 1, 1, 5).setFontWeight("bold");
      sheet.autoResizeColumns(1, 5);

      const txt = `📅 *${league.emoji} ${league.name}*\n\n⚠️ Матчей пока нет.`;
      const kb = { inline_keyboard: [[{ text: "🔙 Назад", callback_data: "back_to_league_selection" }]] };
      _editOrSend(chatId, messageId, txt, kb);
      return;
    }

    const rows = sheet.getDataRange().getValues();
    const buttons = [];

    for (let i = 1; i < rows.length; i++) {
      if (!rows[i] || rows[i].length < 3) continue;
      const matchName = String(rows[i][2] || "").trim();
      const realScore = rows[i][3] ? String(rows[i][3]).trim() : "";
      if (!matchName) continue;

      const hasNoScore = !realScore || realScore === "-" || realScore === "—";
      if (!hasNoScore) continue;

      const normalizedMatch = normalizeMatchName_(matchName);
      if (userPredictedMatches.has(normalizedMatch)) continue;

      let matchTime = "";
      if (rows[i][1]) {
        if (rows[i][1] instanceof Date) {
          matchTime = Utilities.formatDate(rows[i][1], "Europe/Moscow", "dd.MM HH:mm");
        } else if (typeof rows[i][1] === 'string') {
          const dateMatch = String(rows[i][1]).match(/(\d{4}-\d{2}-\d{2})/);
          if (dateMatch) {
            try {
              const d = new Date(dateMatch[1]);
              if (!isNaN(d.getTime())) {
                const timeMatch = String(rows[i][1]).match(/(\d{2}:\d{2})/);
                matchTime = Utilities.formatDate(d, "Europe/Moscow", "dd.MM") + " " + (timeMatch ? timeMatch[1] : "00:00");
              }
            } catch (e) { matchTime = String(rows[i][1]); }
          } else { matchTime = String(rows[i][1]); }
        }
      }

      const safeMatchName = String(matchName).replace(/\|/g, '');
      buttons.push([{
        text: matchTime ? `🕒 ${matchTime} | ${matchName}` : matchName,
        callback_data: `match|${safeMatchName}|${leagueCode}`
      }]);
    }

    const txt = buttons.length === 0
      ? `🎉 Нет доступных матчей в ${league.name}.`
      : `📅 *${league.emoji} ${league.name}* - выберите матч:`;

    const kb = {
      inline_keyboard: [...buttons, [{ text: "🔙 Назад к выбору лиги", callback_data: "back_to_league_selection" }]]
    };

    _editOrSend(chatId, messageId, txt, kb);
  } catch (error) {
    Logger.log("showMatchesForLeague error: " + error);
    sendText(chatId, "❌ Ошибка при загрузке матчей.");
  }
}

function showMatchSelection(chatId, messageId, userName) {
  try {
    const keyboard = { inline_keyboard: [] };
    for (const [code, league] of Object.entries(LEAGUES)) {
      keyboard.inline_keyboard.push([
        { text: `${league.emoji} ${league.name}`, callback_data: `league_${code}` }
      ]);
    }
    if (messageId) keyboard.inline_keyboard.push([{ text: "🔙 Назад", callback_data: "back_to_menu" }]);

    const text = "🏆 *Выберите лигу для прогноза:*";
    _editOrSend(chatId, messageId, text, keyboard);
  } catch (error) {
    Logger.log("showMatchSelection error: " + error);
    sendText(chatId, "❌ Ошибка при загрузке лиг.");
  }
}

// ================== ДИАГНОСТИКА ==================
function diagnoseResults() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const clSheet = ss.getSheetByName("Матчи_CL");
  const clRows = clSheet.getDataRange().getValues();
  Logger.log("=== МАТЧИ_CL ===");
  for (let i = 1; i < clRows.length; i++) {
    const match = String(clRows[i][2] || "").trim();
    const score = String(clRows[i][3] || "").trim();
    if (match.includes("Фенербахче") || match.includes("ПСВ") || match.includes("Бавария")) {
      Logger.log(`Строка ${i+1}: "${match}" | "${score}"`);
    }
  }
  const predSheet = ss.getSheetByName("Ответы на форму (3)");
  const predRows = predSheet.getDataRange().getValues();
  Logger.log("=== ПРОГНОЗЫ ===");
  for (let i = 1; i < predRows.length; i++) {
    const match = String(predRows[i][2] || "").trim();
    if (match.includes("Фенербахче") || match.includes("ПСВ") || match.includes("Бавария")) {
      Logger.log(`"${match}" → "${normalizeMatchName_(match)}"`);
    }
  }
}

function fullDiagnose() {
  const allMatches = fetchAllMatchesForLeague("PL");
  Logger.log(`Всего матчей PL: ${allMatches.length}`);
  const target = allMatches.find(m =>
    (m.homeTeam?.name || "").includes("Manchester United FC") ||
    (m.awayTeam?.name || "").includes("Manchester City FC")
  );
  if (!target) { Logger.log("❌ Матч не найден в API!"); return; }
  Logger.log(`✅ ${target.homeTeam.name} - ${target.awayTeam.name}`);
  Logger.log(`   Статус: ${target.status}`);
  Logger.log(`   Счёт: ${JSON.stringify(target.score)}`);
}

function testNationsLeagueTheSportsDB() {
  const season = `${TARGET_YEAR}-${TARGET_YEAR + 1}`;
  const matches = fetchNationsLeagueFromTheSportsDB(season);
  Logger.log(`Найдено матчей: ${matches.length}`);
  if (matches.length > 0) {
    Logger.log(JSON.stringify(matches[0], null, 2));
  }
}

function checkUNLTour1Ready() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName("Матчи_UNL");
  if (!sheet) { Logger.log("❌ Лист 'Матчи_UNL' не найден"); return; }
  const rows = sheet.getDataRange().getValues();
  const tourStats = {};
  for (let i = 1; i < rows.length; i++) {
    const tourStr = String(rows[i][0] || "").trim();
    const score = String(rows[i][3] || "").trim();
    if (!tourStr) continue;
    if (!tourStats[tourStr]) tourStats[tourStr] = { total: 0, withScore: 0 };
    tourStats[tourStr].total++;
    if (score && /^\d+\s*[-:]\s*\d+$/.test(score)) tourStats[tourStr].withScore++;
  }
  for (const [tour, stat] of Object.entries(tourStats)) {
    const ready = stat.withScore === stat.total;
    Logger.log(`${tour}: ${stat.withScore}/${stat.total} → ${ready ? "✅" : "⏳"}`);
  }
}

function debugUNLSeason() {
  const season = `${TARGET_YEAR}-${TARGET_YEAR + 1}`;
  const url = `${THESPORTSDB_BASE_URL}/eventsseason.php?id=${THESPORTSDB_UNL_LEAGUE_ID}&s=${season}`;
  const data = JSON.parse(UrlFetchApp.fetch(url).getContentText());
  const events = data.events || [];
  Logger.log(`Всего событий: ${events.length}`);
  events.forEach(e => {
    Logger.log(`${e.strEvent} | ${e.dateEvent} ${e.strTime} | ${e.strStatus} | R${e.intRound} | ${e.intHomeScore}:${e.intAwayScore}`);
  });
}

function showAllUNLEvents() {
  const season = `${TARGET_YEAR}-${TARGET_YEAR + 1}`;
  const url = `${THESPORTSDB_BASE_URL}/eventsseason.php?id=${THESPORTSDB_UNL_LEAGUE_ID}&s=${season}`;
  const response = UrlFetchApp.fetch(url);
  const data = JSON.parse(response.getContentText());
  const events = data.events || [];
  Logger.log(`Всего событий: ${events.length}`);
  events.forEach((e, i) => {
    Logger.log(`#${i+1}: ${e.strHomeTeam} - ${e.strAwayTeam} | ${e.dateEvent} | ${e.strStatus} | ${e.intHomeScore}:${e.intAwayScore}`);
  });
}

// ================== UNL: матчи на сегодня ==================
function fetchTodayUNLMatches() {
  const today = Utilities.formatDate(new Date(), "UTC", "yyyy-MM-dd");
  const url = `${THESPORTSDB_BASE_URL}/eventsday.php?d=${today}&s=Soccer`;
  Logger.log(`Запрос: ${url}`);
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) {
    Logger.log(`Ошибка API: ${response.getContentText()}`);
    return [];
  }
  const data = JSON.parse(response.getContentText());
  let events = data.events || [];
  events = events.filter(e =>
    String(e.idLeague) === String(THESPORTSDB_UNL_LEAGUE_ID) ||
    String(e.strLeague).includes("Nations League")
  );
  Logger.log(`Найдено UNL на сегодня: ${events.length}`);

  return events.map(e => ({
    utcDate: (e.strTimestamp || (e.dateEvent + "T" + (e.strTime || "00:00:00"))) + "Z",
    matchday: e.intRound ? parseInt(String(e.intRound).replace(/[^\d]/g, ''), 10) || null : null,
    status: convertTheSportsDBStatus(e.strStatus),
    homeTeam: { name: e.strHomeTeam },
    awayTeam: { name: e.strAwayTeam },
    score: {
      fullTime: {
        home: e.intHomeScore != null ? Number(e.intHomeScore) : null,
        away: e.intAwayScore != null ? Number(e.intAwayScore) : null
      }
    }
  }));
}

function forceAddTodayUNLMatches() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName("Матчи_UNL");
  if (!sheet) { Logger.log("❌ Лист 'Матчи_UNL' не найден"); return; }

  const todayMatches = fetchTodayUNLMatches();
  if (todayMatches.length === 0) {
    Logger.log("ℹ️ На сегодня нет матчей UNL.");
    return;
  }

  todayMatches.sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));

  const existingData = sheet.getDataRange().getValues();
  const existingMatches = new Set();
  for (let i = 1; i < existingData.length; i++) {
    const matchName = String(existingData[i][2]).trim();
    if (matchName) existingMatches.add(normalizeMatchName_(matchName));
  }

  const rowsToAppend = [];
  for (const match of todayMatches) {
    const home = match.homeTeam ? translateTeamName(match.homeTeam.name) : "Команда 1";
    const away = match.awayTeam ? translateTeamName(match.awayTeam.name) : "Команда 2";
    const matchName = `${home} - ${away}`;
    const normalized = normalizeMatchName_(matchName);

    if (!existingMatches.has(normalized)) {
      const dateStr = formatDate(match.utcDate);
      let score = "", winner = "";

      if (match.status === "FINISHED" && match.score && match.score.fullTime) {
        const h = match.score.fullTime.home;
        const a = match.score.fullTime.away;
        if (h != null && a != null && !isNaN(h) && !isNaN(a)) {
          score = `${h}-${a}`;
          if (h > a) winner = "П1";
          else if (a > h) winner = "П2";
          else winner = "Ничья";
        }
      }

      const tourNum = match.matchday || 2;
      rowsToAppend.push([`Тур ${tourNum}`, dateStr, matchName, score, winner]);
      existingMatches.add(normalized);
      Logger.log(`➕ ${matchName} | Тур: ${tourNum} | ${score || "ожидается"}`);
    }
  }

  if (rowsToAppend.length > 0) {
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, rowsToAppend.length, 5).setValues(rowsToAppend);
    Logger.log(`✅ Добавлено ${rowsToAppend.length} матчей UNL.`);
  } else {
    Logger.log("⚠️ Все матчи уже есть в таблице.");
  }
}

function verifyChain_() {
  var raw = PropertiesService.getScriptProperties().getProperty('UPDATE_ALL_STATE_V1');
  Logger.log('=== STATE ===');
  if (!raw) {
    Logger.log('❌ State отсутствует — цепочка не идёт или завершена');
  } else {
    var s = JSON.parse(raw);
    Logger.log('Этап:      ' + s.stage);
    Logger.log('Лига:      ' + s.currentIndex + '/' + s.leagues.length +
               ' (' + (s.leagues[s.currentIndex] || '—') + ')');
    Logger.log('Финал шаг: ' + s.finalStep + '/3');
    Logger.log('Старт:     ' + s.startedAt);
    Logger.log('Обновлено: ' + (s.updatedLeagues || []).join(', '));
  }

  Logger.log('=== TRIGGERS ===');
  var found = 0;
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'processNextUpdateStep') {
      found++;
      Logger.log('🔔 ' + t.getHandlerFunction() +
                 ' | eventType=' + t.getEventType() +
                 ' | id=' + t.getUniqueId());
    }
  });
  Logger.log(found ? 'Всего триггеров processNextUpdateStep: ' + found
                   : '❌ Триггера processNextUpdateStep НЕТ — цепочка оборвана');
}

function checkUpdateStatus() {
  var raw = PropertiesService.getScriptProperties().getProperty('UPDATE_ALL_STATE_V1');
  if (!raw) {
    Logger.log('✅ State отсутствует — обновление ЗАВЕРШЕНО');
    return;
  }
  var s = JSON.parse(raw);
  var age = Math.round((Date.now() - new Date(s.startedAt).getTime()) / 60000);
  Logger.log('Этап:       ' + s.stage);
  Logger.log('Лига:       ' + s.currentIndex + '/' + s.leagues.length +
             ' (' + (s.leagues[s.currentIndex] || '—') + ')');
  Logger.log('Финал шаг:  ' + s.finalStep + '/3');
  Logger.log('Обновлено:  ' + (s.updatedLeagues || []).join(', '));
  Logger.log('Идёт уже:   ' + age + ' мин');
}