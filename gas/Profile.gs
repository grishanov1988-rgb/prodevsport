/**
 * Показывает профиль пользователя с раздельной статистикой по лигам
 */
function showProfileLegacy_(chatId, userName, user) {
  try {
    const sheetId = SHEET_ID;
    const ss = SpreadsheetApp.openById(sheetId);
    
    // === 1. Считаем статистику прогнозов ===
    const predictionsSheet = ss.getSheetByName("Ответы на форму (3)");
    const predictions = predictionsSheet.getDataRange().getValues();
    
    let totalPredictions = 0;
    let lastPredictionDate = "—";
    const leagueStats = {};
    
    // Инициализируем статистику по лигам (только PL и CL)
    for (const [code, league] of Object.entries(LEAGUES)) {
      leagueStats[code] = {
        name: league.name,
        emoji: league.emoji,
        count: 0,
        lastDate: null
      };
    }
    
    for (let i = 1; i < predictions.length; i++) {
      if (String(predictions[i][1]).trim() === String(userName).trim()) {
        totalPredictions++;
        
        // Получаем лигу (6-я колонка, индекс 5)
        const leagueCode = predictions[i][5] || "PL";
        if (leagueStats[leagueCode]) {
          leagueStats[leagueCode].count++;
          if (predictions[i][0]) {
            const d = new Date(predictions[i][0]);
            if (!leagueStats[leagueCode].lastDate || d > leagueStats[leagueCode].lastDate) {
              leagueStats[leagueCode].lastDate = d;
            }
          }
        }
        
        if (predictions[i][0]) {
          const d = new Date(predictions[i][0]);
          if (!lastPredictionDate || d > new Date(lastPredictionDate)) {
            lastPredictionDate = Utilities.formatDate(d, "Europe/Moscow", "dd.MM.yyyy");
          }
        }
      }
    }

    // === 2. Получаем рейтинг и вычисляем место ===
    const ratingSheet = ss.getSheetByName("Рейтинг");
    const ratingData = ratingSheet.getDataRange().getValues();
    
    // Собираем массив всех игроков с их очками
    const players = [];
    for (let i = 1; i < ratingData.length; i++) {
      const name = String(ratingData[i][0]).trim();
      const points = parseFloat(ratingData[i][1]) || 0;
      if (name) {
        players.push({ name, points });
      }
    }
    
    // Сортируем по убыванию очков
    players.sort((a, b) => b.points - a.points);
    
    // Находим место текущего пользователя
    let place = "—";
    let points = 0;
    let totalPlayers = players.length;
    let leaguePoints = {};
    
    for (let i = 0; i < players.length; i++) {
      if (players[i].name === String(userName).trim()) {
        place = i + 1;
        points = players[i].points;
        break;
      }
    }
    
    // Получаем очки по лигам (начиная с 4-й колонки)
    for (let i = 1; i < ratingData.length; i++) {
      const name = String(ratingData[i][0]).trim();
      if (name === String(userName).trim()) {
        const leagueCodes = Object.keys(LEAGUES);
        for (let j = 0; j < leagueCodes.length; j++) {
          const code = leagueCodes[j];
          leaguePoints[code] = ratingData[i][3 + j] || 0;
        }
        break;
      }
    }
    
    // === 3. Формируем сообщение ===
    const firstName = user.first_name || userName;
    const lastName = user.last_name || "";
    const fullName = lastName ? `${firstName} ${lastName}` : firstName;
    const username = user.username ? `@${user.username}` : "не указан";
    
    let message = `👤 *Мой профиль*\n\n`;
    message += `🆔 *Имя:* ${escapeMdLegacy_(fullName)}\n`;
    message += `🔖 *Username:* ${escapeMdLegacy_(username)}\n\n`;
    
    message += `📊 *Общая статистика:*\n`;
    message += `🎯 Всего прогнозов: *${totalPredictions}*\n`;
    message += `📅 Последний прогноз: *${lastPredictionDate}*\n\n`;
    
    // Статистика по лигам
    let hasLeagueStats = false;
    let leagueStatsText = "";
    for (const [code, stat] of Object.entries(leagueStats)) {
      if (stat.count > 0) {
        hasLeagueStats = true;
        const lastDate = stat.lastDate ? 
          Utilities.formatDate(stat.lastDate, "Europe/Moscow", "dd.MM.yyyy") : "—";
        const pointsInLeague = leaguePoints[code] || 0;
        leagueStatsText += `${stat.emoji} *${stat.name}:* ${stat.count} прогнозов, ${pointsInLeague} очков\n`;
      }
    }
    
    if (hasLeagueStats) {
      message += `📊 *Статистика по лигам:*\n${leagueStatsText}\n`;
    }
    
    message += `🏆 *Рейтинг:*\n`;
    message += `🥇 Место: *${place}* из *${totalPlayers}*\n`;
    message += `⭐ Очков: *${points}*\n`;

        // ===== ДОСТИЖЕНИЯ =====
    const userAchievements = getUserAchievements(userName);
    const totalAch = Object.keys(ACHIEVEMENTS).length;
    message += `\n🏅 *Достижения:* (${userAchievements.length}/${totalAch})\n`;
    
    if (userAchievements.length === 0) {
      message += `_Пока нет достижений. Делайте прогнозы, чтобы получить их!_\n`;
    } else {
      for (const a of userAchievements) {
        message += `${a.name}\n`;
      }
    }
    
    // Мотивационные сообщения
    if (totalPredictions === 0) {
      message += `\n💡 _Вы ещё не делали прогнозов._\n_Нажмите «📝 Сделать прогноз», чтобы начать!_`;
    } else if (place === 1) {
      message += `\n🎉 _Поздравляем! Вы лидер рейтинга!_`;
    } else if (place <= 3 && place !== "—") {
      message += `\n🔥 _Отличный результат! Вы в топ-3!_`;
    }
    
    // === 5. Кнопки ===
    const keyboard = {
      inline_keyboard: [
        [
          { text: "📝 Сделать прогноз", callback_data: "profile_make_prediction" },
          { text: "🏆 К рейтингу", callback_data: "profile_go_rating" }
        ],
        [
          { text: "🔄 Обновить", callback_data: "profile_refresh" }
        ]
      ]
    };
    
    sendText(chatId, message, keyboard);
    
  } catch (error) {
    sendText(chatId, `❌ Ошибка при загрузке профиля: ${error.message}`);
    console.error("showProfile error:", error);
  }
}

/**
 * Показывает список прогнозов пользователя с очками (с поддержкой лиг)
 */
/**
 * Показывает список прогнозов пользователя с выбором лиги и отображением последних 10 прогнозов
 */
/**
 * Показывает список прогнозов пользователя с выбором лиги и отображением последних 10 прогнозов
 */
/**
 * Показывает список прогнозов пользователя с выбором лиги и отображением последних 10 прогнозов
 */
/**
 * Показывает список прогнозов пользователя с выбором лиги и отображением последних 10 прогнозов
 */
/**
 * Показывает список прогнозов пользователя с выбором лиги и отображением последних 10 прогнозов
 */
/**
 * Показывает список прогнозов пользователя с выбором лиги и отображением последних 10 прогнозов
 */
/**
 * Показывает список прогнозов пользователя с выбором лиги
 * и под каждым прогнозом — кнопку «Сравнить матч».
 */
function showMyPredictions(chatId, userName, leagueCode = null) {
  if (!chatId) {
    chatId = getChatIdByUserName(userName);
    if (!chatId) return;
  }

  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);

    // === 1. Собираем данные о матчах ===
    const allMatchData = {};
    for (const [code, league] of Object.entries(LEAGUES)) {
      const matchesSheet = ss.getSheetByName(league.sheetName);
      if (!matchesSheet) continue;

      const matches = matchesSheet.getDataRange().getValues();
      const matchData = {};

      for (let i = 1; i < matches.length; i++) {
        const matchName = matches[i][2];
        const realOutcome = matches[i][4];
        const realScore = matches[i][3];
        const matchDate = matches[i][1];
        const normalizedName = normalizeMatchNameLegacy_(matchName);
        if (!normalizedName) continue;

        let scoreValue = null;
        let isPlayed = false;
        let dateObj = null;

        if (matchDate) {
          try {
            if (matchDate instanceof Date) {
              dateObj = matchDate;
            } else if (typeof matchDate === "string") {
              const dateStr = matchDate.trim();
              let parsed = new Date(dateStr);
              if (!isNaN(parsed.getTime())) {
                dateObj = parsed;
              } else {
                const parts = dateStr.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
                if (parts) {
                  parsed = new Date(parts[1], parts[2] - 1, parts[3], parts[4], parts[5]);
                  if (!isNaN(parsed.getTime())) dateObj = parsed;
                }
              }
            }
          } catch (e) { /* ignore */ }
        }

        if (realScore && String(realScore).trim() !== "" && String(realScore).trim() !== "-") {
          const scoreStr = String(realScore).trim();
          const scorePattern = /^\d+\s*[-:]\s*\d+$/;
          if (scorePattern.test(scoreStr)) {
            scoreValue = scoreStr.replace(/:/g, "-");
            isPlayed = true;
          }
        }

        matchData[normalizedName] = {
          realOutcome: realOutcome || null,
          realScore: scoreValue,
          originalName: matchName,
          league: code,
          isPlayed: isPlayed,
          date: dateObj
        };
      }

      allMatchData[code] = matchData;
    }

    // === 2. Получаем прогнозы пользователя ===
    const predictionsSheet = ss.getSheetByName("Ответы на форму (3)");
    const predictions = predictionsSheet.getDataRange().getValues();
    const allUserPredictions = [];

    for (let i = 1; i < predictions.length; i++) {
      if (String(predictions[i][1]).trim() === String(userName).trim()) {
        const predLeague = predictions[i][5] || "PL";
        allUserPredictions.push({
          date: predictions[i][0],
          match: predictions[i][2],
          outcome: predictions[i][3],
          score: predictions[i][4],
          league: predLeague
        });
      }
    }

    if (allUserPredictions.length === 0) {
      sendText(chatId, `📋 *Мои прогнозы*\n\n_Вы ещё не сделали ни одного прогноза._\n\n💡 Нажмите «📝 Сделать прогноз», чтобы начать!`);
      return;
    }

    // Сортируем по дате (новые сверху)
    allUserPredictions.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Группируем по лигам
    const userLeagues = {};
    for (const pred of allUserPredictions) {
      const code = pred.league || "PL";
      if (!userLeagues[code]) userLeagues[code] = [];
      userLeagues[code].push(pred);
    }

    // === 3. Если лига не выбрана — показываем меню выбора лиги ===
    if (!leagueCode) {
      let message = `📋 *Мои прогнозы*\n\n`;
      message += `👤 *${escapeMdLegacy_(userName)}*\n`;
      message += `📊 Всего прогнозов: *${allUserPredictions.length}*\n\n`;
      message += `🏆 *Выберите лигу для просмотра прогнозов:*\n\n`;

      const keyboard = { inline_keyboard: [] };

      for (const [code, league] of Object.entries(LEAGUES)) {
        if (userLeagues[code]) {
          const count = userLeagues[code].length;
          keyboard.inline_keyboard.push([
            {
              text: `${league.emoji} ${league.name} (${count})`,
              callback_data: `filter_predictions|${code}`
            }
          ]);
        }
      }

      sendText(chatId, message, keyboard);
      return;
    }

    // === 4. Прогнозы по конкретной лиге ===
    const league = LEAGUES[leagueCode];
    if (!league) {
      sendText(chatId, "❌ Лига не найдена.");
      return;
    }

    const leaguePredictions = userLeagues[leagueCode] || [];
    if (leaguePredictions.length === 0) {
      sendText(chatId, `📋 *Мои прогнозы в ${league.name}*\n\n_У вас нет прогнозов в этой лиге._`);
      return;
    }

    // Сортировка по дате матча (старые сверху)
    leaguePredictions.sort((a, b) => {
      const dateA = a.date ? new Date(a.date) : new Date(0);
      const dateB = b.date ? new Date(b.date) : new Date(0);
      return dateA - dateB;
    });

    let totalPoints = 0;
    let playedCount = 0;
    let notPlayedCount = 0;

    // Заголовок
    let headerMessage = `📋 *Мои прогнозы в ${league.emoji} ${league.name}*\n`;
    headerMessage += `👤 *${escapeMdLegacy_(userName)}*\n`;
    headerMessage += `📊 Всего прогнозов: *${leaguePredictions.length}*\n`;

    const maxVisible = 10;
    const shownPredictions = leaguePredictions.slice(-maxVisible);

    if (leaguePredictions.length > maxVisible) {
      headerMessage += `⚠️ _Показаны последние ${maxVisible} прогнозов из ${leaguePredictions.length}._\n`;
    }
    sendText(chatId, headerMessage);

    // Отправляем каждый прогноз отдельным сообщением с кнопкой «Сравнить матч»
    for (let i = 0; i < shownPredictions.length; i++) {
      const pred = shownPredictions[i];
      const matchData = allMatchData[leagueCode] || {};
      const normalizedPredMatch = normalizeMatchNameLegacy_(pred.match);
      const matchInfo = matchData[normalizedPredMatch];
      const displayName = cleanText(pred.match);

      let dateStr = "";
      if (pred.date) {
        try {
          const d = new Date(pred.date);
          dateStr = Utilities.formatDate(d, "Europe/Moscow", "dd.MM HH:mm");
        } catch (e) { dateStr = ""; }
      }

      let matchDateStr = "";
      if (matchInfo && matchInfo.date) {
        try {
          matchDateStr = Utilities.formatDate(matchInfo.date, "Europe/Moscow", "dd.MM");
        } catch (e) { matchDateStr = ""; }
      }

      const predNumber = i + 1;
      let message = `${predNumber}. *${escapeMdLegacy_(displayName)}*\n`;
      if (matchDateStr) message += `    📅 ${matchDateStr}\n`;
      if (dateStr) message += `    🕐 Прогноз сделан: ${dateStr}\n`;
      message += `    🔮 Прогноз: *${escapeMdLegacy_(String(pred.outcome))}* (${escapeMdLegacy_(cleanText(String(pred.score).replace(/:/g, "-")))})\n`;

      if (matchInfo && matchInfo.isPlayed && matchInfo.realScore) {
        const points = calcPointsLegacy_(String(pred.outcome), String(pred.score), String(matchInfo.realScore));
        totalPoints += points;
        playedCount++;
        message += `    ✅ Реальный счёт: *${escapeMdLegacy_(String(matchInfo.realScore))}*\n`;
        message += `    🎯 Очки: *+${points}*\n`;
      } else {
        notPlayedCount++;
        message += `    ⏳ _Матч ещё не сыгран_\n`;
      }

      // Формируем inline-кнопку «Сравнить матч»
      const safeMatch = String(pred.match).replace(/\|/g, "");
      const keyboard = {
        inline_keyboard: [
          [
            {
              text: "🔍 Сравнить матч",
              callback_data: `compare_match|${leagueCode}|${safeMatch}`
            }
          ]
        ]
      };

      sendText(chatId, message, keyboard);
    }

    // Итоговое сообщение
    let footer = `━━━━━━━━━━━━━━━━━━\n`;
    footer += `⭐ *Всего очков в ${league.emoji} ${league.name}:* *${totalPoints}*\n`;

    if (playedCount > 0 || notPlayedCount > 0) {
      footer += `\n📊 *Статистика:*\n`;
      if (playedCount > 0) footer += `✅ Завершено: *${playedCount}*\n`;
      if (notPlayedCount > 0) footer += `⏳ Ожидают завершения: *${notPlayedCount}*\n`;
    }

    const footerKeyboard = {
      inline_keyboard: [
        [{ text: "🔄 Обновить", callback_data: `filter_predictions|${leagueCode}` }]
      ]
    };

    sendText(chatId, footer, footerKeyboard);

  } catch (error) {
    console.error("showMyPredictions error:", error);
    sendText(chatId, `❌ Ошибка при загрузке прогнозов: ${error.message}`);
  }
}

/**
 * Показывает все прогнозы на конкретный матч + статистику по исходам.
 * @param {number} chatId   — Telegram chat_id
 * @param {number|null} messageId — id сообщения для редактирования (не обязательно)
 * @param {string} leagueCode — код лиги (PL/CL)
 * @param {string} matchName  — название матча (как в таблице)
 */
function showMatchComparison(chatId, messageId, leagueCode, matchName) {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const league = LEAGUES[leagueCode];
    if (!league) {
      sendText(chatId, "❌ Лига не найдена.");
      return;
    }

    const targetNorm = normalizeMatchNameLegacy_(matchName);

    // === 1. Находим реальный счёт матча ===
    let realScore = null;
    let realOutcome = null;
    const matchesSheet = ss.getSheetByName(league.sheetName);
    if (matchesSheet) {
      const rows = matchesSheet.getDataRange().getValues();
      for (let i = 1; i < rows.length; i++) {
        const mName = String(rows[i][2] || "").trim();
        if (normalizeMatchNameLegacy_(mName) === targetNorm) {
          const s = String(rows[i][3] || "").trim();
          if (s && /^\d+\s*[-:]\s*\d+$/.test(s)) {
            realScore = s.replace(/:/g, "-");
            const [h, a] = realScore.split("-").map(x => parseInt(x, 10));
            realOutcome = h > a ? "П1" : (h < a ? "П2" : "Ничья");
          }
          break;
        }
      }
    }

    // === 2. Собираем ВСЕ прогнозы на этот матч ===
    const predSheet = ss.getSheetByName("Ответы на форму (3)");
    const predRows = predSheet.getDataRange().getValues();

    const allPredictions = [];   // { user, outcome, score, date }
    const latestByUser = {};     // user -> prediction (последний)

    for (let i = 1; i < predRows.length; i++) {
      const user = String(predRows[i][1] || "").trim();
      const match = String(predRows[i][2] || "").trim();
      const outcome = String(predRows[i][3] || "").trim();
      const score = String(predRows[i][4] || "").trim();
      const predLeague = predRows[i][5] || "PL";
      const date = predRows[i][0] ? new Date(predRows[i][0]).getTime() : 0;

      if (predLeague !== leagueCode) continue;
      if (normalizeMatchNameLegacy_(match) !== targetNorm) continue;
      if (!user) continue;

      allPredictions.push({ user, outcome, score, date });

      // оставляем последний прогноз пользователя
      if (!latestByUser[user] || date > latestByUser[user].date) {
        latestByUser[user] = { outcome, score, date };
      }
    }

    if (allPredictions.length === 0) {
      const text = `🔍 *Сравнение матча*\n\n⚽️ *${escapeMdLegacy_(cleanText(matchName))}*\n\n_Пока никто не сделал прогноз на этот матч._`;
      const kb = {
        inline_keyboard: [[{ text: "🔙 Назад", callback_data: `filter_predictions|${leagueCode}` }]]
      };
      if (messageId) editMessage(chatId, messageId, text, kb);
      else sendText(chatId, text, kb);
      return;
    }

    // === 3. Считаем статистику по исходам ===
    let countP1 = 0, countDraw = 0, countP2 = 0;
    for (const u in latestByUser) {
      const o = latestByUser[u].outcome;
      if (o === "П1") countP1++;
      else if (o === "П2") countP2++;
      else if (o === "Ничья") countDraw++;
    }
    const totalUsers = Object.keys(latestByUser).length;

    // === 4. Формируем сообщение ===
    let msg = `🔍 *Сравнение матча*\n\n`;
    msg += `⚽️ *${escapeMdLegacy_(cleanText(matchName))}*\n`;
    if (realScore) {
      msg += `✅ Реальный счёт: *${escapeMdLegacy_(realScore)}* (${escapeMdLegacy_(realOutcome)})\n`;
    } else {
      msg += `⏳ _Матч ещё не сыгран_\n`;
    }
    msg += `👥 Всего прогнозов: *${totalUsers}*\n\n`;

    msg += `📊 *Распределение исходов:*\n`;
    msg += `🔵 П1 (победа 1): *${countP1}* (${totalUsers ? Math.round(countP1 / totalUsers * 100) : 0}%)\n`;
    msg += `⚪️ Ничья: *${countDraw}* (${totalUsers ? Math.round(countDraw / totalUsers * 100) : 0}%)\n`;
    msg += `🔴 П2 (победа 2): *${countP2}* (${totalUsers ? Math.round(countP2 / totalUsers * 100) : 0}%)\n\n`;

    msg += `━━━━━━━━━━━━━━━━━━\n`;
    msg += `📋 *Прогнозы участников:*\n\n`;

    // Сортируем по количеству очков (если матч сыгран) или по имени
    const entries = Object.entries(latestByUser).map(([user, p]) => {
      let pts = null;
      if (realScore) {
        pts = calcPointsLegacy_(p.outcome, p.score, realScore);
      }
      return { user, ...p, pts };
    });

    if (realScore) {
      entries.sort((a, b) => (b.pts || 0) - (a.pts || 0));
    } else {
      entries.sort((a, b) => a.user.localeCompare(b.user, "ru"));
    }

    for (const e of entries) {
      // 👇 Добавляем проверку имени и иконку
      let displayName = e.user;
      if (displayName === "Мария") {
        displayName = "🐱 " + displayName; // Иконка ставится перед именем
        // Если хотите после имени, напишите: displayName = displayName + " 🐱";
      }
      
      let line = `• *${escapeMdLegacy_(displayName)}* — ${escapeMdLegacy_(e.outcome)} (${escapeMdLegacy_(String(e.score).replace(/:/g, "-"))})`;
      if (realScore) {
        line += ` → *+${e.pts}*`;
      }
      msg += line + `\n`;
    }

    const keyboard = {
      inline_keyboard: [
        [{ text: "🔙 Назад к прогнозам", callback_data: `filter_predictions|${leagueCode}` }]
      ]
    };

    if (messageId) {
      try {
        editMessage(chatId, messageId, msg, keyboard);
      } catch (e) {
        sendText(chatId, msg, keyboard);
      }
    } else {
      sendText(chatId, msg, keyboard);
    }

  } catch (error) {
    console.error("showMatchComparison error:", error);
    sendText(chatId, `❌ Ошибка при загрузке сравнения: ${error.message}`);
  }
}

/**
 * Подсчитывает очки за прогноз
 * Точный счёт = 5, угаданная разница = 3, угаданный исход = 1
 */
function calcPointsLegacy_(predictedOutcome, predictedScore, realScore) {
  try {
    // Приводим счета к единому формату "число-число"
    const pScore = String(predictedScore).replace(/:/g, "-").trim();
    const rScore = String(realScore).replace(/:/g, "-").trim();

    if (!pScore || !rScore || !pScore.includes("-") || !rScore.includes("-")) {
      return 0;
    }

    const predParts = pScore.split("-").map(s => parseInt(s.trim(), 10));
    const realParts = rScore.split("-").map(s => parseInt(s.trim(), 10));

    if (predParts.length !== 2 || realParts.length !== 2) return 0;
    if (isNaN(predParts[0]) || isNaN(predParts[1]) || isNaN(realParts[0]) || isNaN(realParts[1])) {
      return 0;
    }

    const predHome = predParts[0];
    const predAway = predParts[1];
    const realHome = realParts[0];
    const realAway = realParts[1];

    // 1. Точный счёт → 5 очков
    if (predHome === realHome && predAway === realAway) {
      return 5;
    }

    // 2. Угаданная разница мячей → 3 очка
    const predDiff = predHome - predAway;
    const realDiff = realHome - realAway;
    if (predDiff === realDiff) {
      return 3;
    }

    // 3. Угаданный исход → 1 очко
    const realResult = realHome > realAway ? "П1" : (realHome < realAway ? "П2" : "Ничья");
    if (String(predictedOutcome).trim() === realResult) {
      return 1;
    }

    // Ничего не угадано → 0
    return 0;
  } catch (error) {
    console.error("calculatePoints error:", error);
    return 0;
  }
}

/**
 * Экранирует специальные символы Markdown
 */
function escapeMdLegacy_(text) {
  if (!text) return "";
  return String(text).replace(/[_*\[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

/**
 * Очищает текст от лишних пробелов
 */
function cleanText(text) {
  if (!text) return "";
  return String(text).replace(/\s+/g, ' ').trim();
}

/**
 * Нормализует название матча для сравнения
 */
function normalizeMatchNameLegacy_(name) {
  if (!name) return "";
  return String(name)
    .toLowerCase()
    .replace(/[^a-zа-яё0-9-]/g, '');
}

// ================== ИСТОРИЯ РЕЙТИНГА (для движения ↑↓) ==================

/**
 * ⚠ УДАЛЕНО: прежняя версия писала снимок в RATING_HISTORY_SHEET = "Рейтинг"
 * и перезаписывала боевой лист. Движение ↑↓ больше не поддерживается (лигаси).
 */
function saveRatingSnapshot() {
  Logger.log('saveRatingSnapshot: no-op (legacy, движение рейтинга отключено)');
}

/**
 * Возвращает карту прошлого рейтинга: { "Имя": { rank: N, points: X } }
 */
function getPreviousRating() {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const histSheet = ss.getSheetByName(RATING_HISTORY_SHEET);
    if (!histSheet) return {};

    const rows = histSheet.getDataRange().getValues();
    if (rows.length < 2) return {};

    // Собираем строки, сортируем по очкам
    const entries = [];
    for (let i = 1; i < rows.length; i++) {
      const name = String(rows[i][1] || "").trim();
      const points = Number(rows[i][2]) || 0;
      if (name) entries.push({ name, points });
    }
    entries.sort((a, b) => b.points - a.points);

    const map = {};
    entries.forEach((e, idx) => {
      map[e.name] = { rank: idx + 1, points: e.points };
    });
    return map;
  } catch (e) {
    console.error("getPreviousRating error:", e);
    return {};
  }
}

/**
 * Формирует стрелку движения: ↑2 / ↓1 / →0 / 🆕 (новичок)
 */
function formatMovement(userName, currentRank, previousMap) {
  const prev = previousMap[userName];
  if (!prev) return " 🆕";
  const diff = prev.rank - currentRank; // + значит поднялся
  if (diff > 0) return ` ↑${diff}`;
  if (diff < 0) return ` ↓${Math.abs(diff)}`;
  return ` →0`;
}

// ================== РЕЙТИНГ ЗА ТУР ==================

/**
 * Считает очки каждого участника за конкретный тур конкретной лиги.
 * @returns {Array<{user, points, count}>} отсортировано по очкам
 */
function getTourRating(leagueCode, tourNumber) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const league = LEAGUES[leagueCode];
  if (!league) return [];

  // 1. Матчи тура и их реальные счета
  const matchesSheet = ss.getSheetByName(league.sheetName);
  if (!matchesSheet) return [];
  const matches = matchesSheet.getDataRange().getValues();

  const tourMatches = {}; // normName -> realScore
  for (let i = 1; i < matches.length; i++) {
    const tourStr = String(matches[i][0] || "").trim();
    const tourNum = parseInt(tourStr.replace(/[^\d]/g, ""), 10);
    if (isNaN(tourNum) || tourNum !== tourNumber) continue;

    const matchName = String(matches[i][2] || "").trim();
    const score = String(matches[i][3] || "").trim();
    if (!matchName) continue;
    if (!/^\d+\s*[-:]\s*\d+$/.test(score)) continue;
    tourMatches[normalizeMatchNameLegacy_(matchName)] = score.replace(/:/g, "-");
  }

  if (Object.keys(tourMatches).length === 0) return [];

  // 2. Все прогнозы пользователей на матчи этого тура
  const predSheet = ss.getSheetByName("Ответы на форму (3)");
  const predRows = predSheet.getDataRange().getValues();

  // user -> { normMatch -> { outcome, score, date } } — берём последний прогноз
  const userPreds = {};

  for (let i = 1; i < predRows.length; i++) {
    const user = String(predRows[i][1] || "").trim();
    const match = String(predRows[i][2] || "").trim();
    const outcome = String(predRows[i][3] || "").trim();
    const score = String(predRows[i][4] || "").trim();
    const predLeague = predRows[i][5] || "PL";
    const date = predRows[i][0] ? new Date(predRows[i][0]).getTime() : 0;

    if (predLeague !== leagueCode || !user) continue;
    const normMatch = normalizeMatchNameLegacy_(match);
    if (!tourMatches[normMatch]) continue;

    if (!userPreds[user]) userPreds[user] = {};
    if (!userPreds[user][normMatch] || date > userPreds[user][normMatch].date) {
      userPreds[user][normMatch] = { outcome, score, date };
    }
  }

  // 3. Очки по каждому участнику
  const result = [];
  for (const [user, predsMap] of Object.entries(userPreds)) {
    let total = 0;
    let count = 0;
    for (const [normMatch, p] of Object.entries(predsMap)) {
      const realScore = tourMatches[normMatch];
      total += calcPointsLegacy_(p.outcome, p.score, realScore);
      count++;
    }
    result.push({ user, points: total, count });
  }

  result.sort((a, b) => b.points - a.points);
  return result;
}

/**
 * Возвращает последний (максимальный) номер тура с сыгранными матчами для лиги.
 */
function getLastPlayedTour(leagueCode) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const league = LEAGUES[leagueCode];
  if (!league) return null;

  const sheet = ss.getSheetByName(league.sheetName);
  if (!sheet) return null;

  const rows = sheet.getDataRange().getValues();
  let maxTour = null;
  for (let i = 1; i < rows.length; i++) {
    const tourStr = String(rows[i][0] || "").trim();
    const tourNum = parseInt(tourStr.replace(/[^\d]/g, ""), 10);
    const score = String(rows[i][3] || "").trim();
    if (isNaN(tourNum)) continue;
    if (!/^\d+\s*[-:]\s*\d+$/.test(score)) continue;
    if (maxTour === null || tourNum > maxTour) maxTour = tourNum;
  }
  return maxTour;
}

// ================== РЕЙТИНГ ЗА МЕСЯЦ ==================

/**
 * Очки пользователей за прогнозы на матчи, состоявшиеся в текущем месяце
 * (месяц берётся по дате матча в листах лиг).
 */
function getMonthlyRating() {
  const ss = SpreadsheetApp.openById(SHEET_ID);

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-11

  // 1. Собираем все сыгранные матчи месяца: normMatch -> realScore
  const matchScores = {};
  for (const [code, league] of Object.entries(LEAGUES)) {
    const sheet = ss.getSheetByName(league.sheetName);
    if (!sheet) continue;
    const rows = sheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      const matchName = String(rows[i][2] || "").trim();
      const score = String(rows[i][3] || "").trim();
      const rawDate = rows[i][1];
      if (!matchName || !score) continue;
      if (!/^\d+\s*[-:]\s*\d+$/.test(score)) continue;

      let d = null;
      if (rawDate instanceof Date) d = rawDate;
      else if (typeof rawDate === "string") {
        const parsed = new Date(rawDate);
        if (!isNaN(parsed.getTime())) d = parsed;
      }
      if (!d) continue;
      if (d.getFullYear() !== year || d.getMonth() !== month) continue;

      matchScores[normalizeMatchNameLegacy_(matchName)] = score.replace(/:/g, "-");
    }
  }

  // 2. Прогнозы на эти матчи
  const predSheet = ss.getSheetByName("Ответы на форму (3)");
  const predRows = predSheet.getDataRange().getValues();

  // user -> { normMatch -> { outcome, score, date } } — последний прогноз
  const userPreds = {};

  for (let i = 1; i < predRows.length; i++) {
    const user = String(predRows[i][1] || "").trim();
    const match = String(predRows[i][2] || "").trim();
    if (!user || !match) continue;
    const normMatch = normalizeMatchNameLegacy_(match);
    if (!matchScores[normMatch]) continue;

    const outcome = String(predRows[i][3] || "").trim();
    const score = String(predRows[i][4] || "").trim();
    const date = predRows[i][0] ? new Date(predRows[i][0]).getTime() : 0;

    if (!userPreds[user]) userPreds[user] = {};
    if (!userPreds[user][normMatch] || date > userPreds[user][normMatch].date) {
      userPreds[user][normMatch] = { outcome, score, date };
    }
  }

  const result = [];
  for (const [user, predsMap] of Object.entries(userPreds)) {
    let total = 0;
    let count = 0;
    for (const [normMatch, p] of Object.entries(predsMap)) {
      total += calcPointsLegacy_(p.outcome, p.score, matchScores[normMatch]);
      count++;
    }
    result.push({ user, points: total, count });
  }

  result.sort((a, b) => b.points - a.points);
  return result;
}

