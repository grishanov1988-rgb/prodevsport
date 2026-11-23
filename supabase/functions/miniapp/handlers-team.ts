// ============================================================
//  TEAM BUILDER + БИТВЫ (этап 6) — порт из Code.gs:
//  getTeamBuilder, saveTeam, getMyTeam, startTeamBattle, getBattleHistory
// ============================================================

import { db } from '../_shared/db.ts';
import { enc, getPeriodKey } from '../_shared/util.ts';
import { checkRateLimit } from '../_shared/core.ts';
import { addXP } from '../_shared/gamification.ts';

const BATTLE_MAX_PER_DAY = 3;
const BATTLE_WIN_XP = 150;
const BATTLE_LOSE_XP = 30;
const BATTLE_DRAW_XP = 80;

const TEAM_FORMATION_433 = {
  slots: [
    { index: 0, group: 'GK', label: 'ВРТ' },
    { index: 1, group: 'DEF', label: 'ЛЗ' },
    { index: 2, group: 'DEF', label: 'ЦЗ' },
    { index: 3, group: 'DEF', label: 'ЦЗ' },
    { index: 4, group: 'DEF', label: 'ПЗ' },
    { index: 5, group: 'MID', label: 'ЦП' },
    { index: 6, group: 'MID', label: 'ЦП' },
    { index: 7, group: 'MID', label: 'ЦП' },
    { index: 8, group: 'FWD', label: 'ЛФ' },
    { index: 9, group: 'FWD', label: 'ЦФ' },
    { index: 10, group: 'FWD', label: 'ПФ' },
  ],
};

const POSITION_GROUPS: Record<string, string[]> = {
  GK: ['GK'],
  DEF: ['CB', 'LB', 'RB', 'LWB', 'RWB', 'DEF', 'SW'],
  MID: ['CM', 'CDM', 'CAM', 'LM', 'RM', 'MF', 'MID'],
  FWD: ['ST', 'CF', 'LW', 'RW', 'SS', 'FWD'],
  COACH: ['COACH'],
};

function classifyPosition(pos: unknown): string {
  const p = String(pos || '').toUpperCase().trim();
  for (const group in POSITION_GROUPS) {
    if (POSITION_GROUPS[group].indexOf(p) !== -1) return group;
  }
  return 'MID'; // дефолт
}

function calcTeamPower(slots: any[], coachCard: any): number {
  let sum = 0, count = 0;
  slots.forEach((s) => {
    if (s.card) { sum += Number(s.card.ovr) || 0; count++; }
  });
  if (!count) return 0;
  const avg = sum / count;
  const coachBonus = coachCard ? (Number(coachCard.ovr) || 0) * 0.1 : 0;
  return Math.round((avg + coachBonus) * 100) / 100;
}

// ------------------------------------------------------------
//  getTeamBuilder
// ------------------------------------------------------------
export async function getTeamBuilder(_chatId: unknown, userName: unknown) {
  try {
    const clean = String(userName || '').trim();
    if (!clean) return { ok: false, error: 'Не указан пользователь' };

    const userCards = await db(`user_cards?user_name=eq.${enc(clean)}&select=card_id,quantity,cards_catalog(id,name,position,club,country,country_code,ovr,rarity,image_url)`) ?? [];

    const cardsByGroup: Record<string, any[]> = { GK: [], DEF: [], MID: [], FWD: [], COACH: [] };
    userCards.forEach((r: any) => {
      const c = r.cards_catalog;
      if (!c) return;
      const group = classifyPosition(c.position);
      cardsByGroup[group].push({
        cardId: r.card_id, name: c.name, position: c.position, club: c.club,
        country: c.country, countryCode: c.country_code, ovr: Number(c.ovr) || 0,
        rarity: c.rarity, group, quantity: Number(r.quantity) || 1,
      });
    });
    for (const g in cardsByGroup) cardsByGroup[g].sort((a, b) => b.ovr - a.ovr);

    const teamRows = await db(`user_teams?user_name=eq.${enc(clean)}`) ?? [];
    const team = teamRows[0] || null;

    const slotsRows = await db(`user_team_slots?user_name=eq.${enc(clean)}&select=slot_index,card_id,cards_catalog(id,name,position,club,country_code,ovr,rarity)`) ?? [];

    const slotsMap: Record<string, any> = {};
    slotsRows.forEach((s: any) => { slotsMap[s.slot_index] = s; });

    const slots = TEAM_FORMATION_433.slots.map((def) => {
      const cur = slotsMap[def.index];
      return {
        index: def.index, group: def.group, label: def.label,
        card: cur && cur.cards_catalog ? {
          cardId: cur.card_id, name: cur.cards_catalog.name, position: cur.cards_catalog.position,
          club: cur.cards_catalog.club, countryCode: cur.cards_catalog.country_code,
          ovr: Number(cur.cards_catalog.ovr) || 0, rarity: cur.cards_catalog.rarity,
        } : null,
      };
    });

    let coachCard = null;
    if (team && team.coach_card_id) {
      const coachRows = await db(`cards_catalog?id=eq.${team.coach_card_id}&select=id,name,position,club,country_code,ovr,rarity`) ?? [];
      if (coachRows[0]) {
        coachCard = {
          cardId: coachRows[0].id, name: coachRows[0].name, position: coachRows[0].position,
          club: coachRows[0].club, countryCode: coachRows[0].country_code,
          ovr: Number(coachRows[0].ovr) || 0, rarity: coachRows[0].rarity,
        };
      }
    }

    let currentPower: number | null = null;
    const filledSlots = slots.filter((s: any) => s.card).length;
    if (filledSlots === 11 && coachCard) currentPower = calcTeamPower(slots, coachCard);

    return {
      ok: true, slots, coachCard, cardsByGroup,
      teamName: team ? team.team_name : null,
      teamExists: !!team,
      filledSlots,
      currentPower,
      isComplete: filledSlots === 11 && !!coachCard,
    };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

// ------------------------------------------------------------
//  saveTeam
// ------------------------------------------------------------
export async function saveTeam(_chatId: unknown, userName: unknown, slots: unknown, coachCardId: unknown, teamName: unknown) {
  try {
    const clean = String(userName || '').trim();
    if (!clean) return { ok: false, error: 'Не указан пользователь' };

    if (!Array.isArray(slots)) return { ok: false, error: 'Неверный формат слотов' };
    if (slots.length !== 11) return { ok: false, error: 'Нужно заполнить все 11 позиций' };
    if (!coachCardId) return { ok: false, error: 'Выберите тренера' };

    const cardIds = (slots as any[]).map((s) => s.cardId);
    cardIds.push(coachCardId);

    const owned = await db(`user_cards?user_name=eq.${enc(clean)}&card_id=in.(${cardIds.map((v) => enc(String(v))).join(',')})&select=card_id`) ?? [];
    const ownedSet: Record<string, boolean> = {};
    owned.forEach((o: any) => { ownedSet[o.card_id] = true; });

    for (let i = 0; i < cardIds.length; i++) {
      if (!ownedSet[cardIds[i]]) {
        return { ok: false, error: 'Карточка #' + cardIds[i] + ' не найдена в коллекции' };
      }
    }

    await db('user_teams?on_conflict=user_name', {
      method: 'post',
      body: [{
        user_name: clean,
        team_name: String(teamName || 'Моя команда').substring(0, 40),
        formation: '4-3-3',
        coach_card_id: coachCardId,
        updated_at: new Date().toISOString(),
      }],
      prefer: 'return=minimal,resolution=merge-duplicates',
    });

    await db(`user_team_slots?user_name=eq.${enc(clean)}`, { method: 'delete', prefer: 'return=minimal' });

    const rows = (slots as any[]).map((s) => ({ user_name: clean, slot_index: s.index, card_id: s.cardId }));
    await db('user_team_slots', { method: 'post', body: rows, prefer: 'return=minimal' });

    return { ok: true };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

// ------------------------------------------------------------
//  getMyTeam
// ------------------------------------------------------------
export async function getMyTeam(_chatId: unknown, userName: unknown) {
  try {
    const clean = String(userName || '').trim();
    const teams = await db(`user_teams?user_name=eq.${enc(clean)}`) ?? [];
    if (!teams.length) return { ok: false, error: 'Команда не создана' };
    const team = teams[0];

    const slots = await db(`user_team_slots?user_name=eq.${enc(clean)}&select=slot_index,card_id,cards_catalog(id,name,position,club,country_code,ovr,rarity)`) ?? [];

    let coach = null;
    if (team.coach_card_id) {
      const cr = await db(`cards_catalog?id=eq.${team.coach_card_id}&select=id,name,position,club,country_code,ovr,rarity`) ?? [];
      if (cr[0]) coach = cr[0];
    }

    const mappedSlots = TEAM_FORMATION_433.slots.map((def) => {
      const found = slots.filter((s: any) => s.slot_index === def.index)[0];
      return {
        index: def.index, group: def.group, label: def.label,
        card: found && found.cards_catalog ? found.cards_catalog : null,
      };
    });

    const power = (mappedSlots.every((s: any) => s.card) && coach)
      ? calcTeamPower(mappedSlots, coach) : null;

    return {
      ok: true,
      teamName: team.team_name,
      formation: team.formation,
      slots: mappedSlots,
      coach,
      power,
    };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

// ------------------------------------------------------------
//  BATTLE
// ------------------------------------------------------------
function generateBattleScript(power1: number, power2: number) {
  const attacksPerSide = 3;
  const events: any[] = [];
  let score1 = 0, score2 = 0;

  for (let i = 0; i < attacksPerSide * 2; i++) {
    const attacker = (i % 2 === 0) ? 'me' : 'opp';
    const attackerPower = attacker === 'me' ? power1 : power2;
    const defenderPower = attacker === 'me' ? power2 : power1;

    // Базовый шанс гола от силы (0.3–0.75)
    let goalChance = 0.35 + (attackerPower - defenderPower) * 0.015;
    goalChance += (Math.random() - 0.5) * 0.3; // джиттер ±15%
    goalChance = Math.max(0.15, Math.min(0.85, goalChance));

    const isGoal = Math.random() < goalChance;
    const hitPost = !isGoal && Math.random() < 0.3;

    if (isGoal) { if (attacker === 'me') score1++; else score2++; }

    events.push({
      attacker, isGoal, hitPost,
      minute: 8 + i * 13,
      scoreAfter: { me: score1, opp: score2 },
    });
  }

  return { events, score1, score2 };
}

// ------------------------------------------------------------
//  startTeamBattle
// ------------------------------------------------------------
export async function startTeamBattle(chatId: unknown, userName: unknown) {
  try {
    const clean = String(userName || '').trim();
    if (!clean) return { ok: false, error: 'Не указан пользователь' };

    if (!(await checkRateLimit('battle_' + clean, 10))) return { ok: false, error: 'Слишком часто. Подождите.' };

    // Дневной лимит
    const todayKey = getPeriodKey('daily');
    const battlesToday = await db(`team_battles?or=(user1.eq.${enc(clean)},user2.eq.${enc(clean)})&created_at=gte.${enc(todayKey + 'T00:00:00.000Z')}&select=id`) ?? [];
    if (battlesToday.length >= BATTLE_MAX_PER_DAY) {
      return { ok: false, error: 'Дневной лимит битв: ' + BATTLE_MAX_PER_DAY };
    }

    const myTeam = await getMyTeam(chatId, clean);
    if (!myTeam || !(myTeam as any).ok) return { ok: false, error: 'Сначала соберите команду' };
    if (!(myTeam as any).power) return { ok: false, error: 'Команда неполная' };

    // ============ ВЫБОР СОПЕРНИКА ============
    const realTeams = await db(`user_teams?user_name=neq.${enc(clean)}&is_bot=eq.false&select=user_name`) ?? [];

    const opponentCandidates: any[] = [];

    for (let i = 0; i < realTeams.length; i++) {
      const t = await getMyTeam(null, realTeams[i].user_name);
      if (t && (t as any).ok && (t as any).power) {
        opponentCandidates.push({ user: realTeams[i].user_name, isBot: false, team: t });
      }
    }

    // Если реальных мало (< 3) — подмешиваем ботов
    if (opponentCandidates.length < 3) {
      const botTeams = await db(`user_teams?user_name=neq.${enc(clean)}&is_bot=eq.true&select=user_name`) ?? [];
      for (let j = 0; j < botTeams.length; j++) {
        const bt = await getMyTeam(null, botTeams[j].user_name);
        if (bt && (bt as any).ok && (bt as any).power) {
          opponentCandidates.push({ user: botTeams[j].user_name, isBot: true, team: bt });
        }
      }
    }

    if (!opponentCandidates.length) {
      return { ok: false, error: 'Нет доступных соперников. Попросите друзей собрать команду или создайте ботов.' };
    }

    const opponentData = opponentCandidates[Math.floor(Math.random() * opponentCandidates.length)];
    const opponent = opponentData.user;
    const oppTeam = opponentData.team;
    const opponentIsBot = opponentData.isBot;

    // ============ СИМУЛЯЦИЯ МАТЧА ============
    const jitter1 = (Math.random() - 0.5) * 2;
    const jitter2 = (Math.random() - 0.5) * 2;
    const power1 = Math.round(((myTeam as any).power + jitter1) * 100) / 100;
    const power2 = Math.round((oppTeam.power + jitter2) * 100) / 100;

    const script = generateBattleScript(power1, power2);

    let winner: string | null = null;
    let xpReward = 0;
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

    await db('team_battles', {
      method: 'post',
      body: [{
        user1: clean, user2: opponent,
        user1_power: power1, user2_power: power2,
        winner, xp_reward: xpReward,
        score1: script.score1, score2: script.score2,
      }],
      prefer: 'return=minimal',
    });

    // ============ НАЧИСЛЕНИЕ XP ============
    let xpResult = null;
    try {
      if (xpReward > 0) xpResult = await addXP(clean, xpReward, 'battle');
    } catch { /* ignore */ }

    if (!opponentIsBot) {
      try {
        if (winner === opponent) {
          await addXP(opponent, BATTLE_WIN_XP, 'battle');
        } else if (winner === null) {
          await addXP(opponent, BATTLE_DRAW_XP, 'battle');
        }
      } catch { /* ignore */ }
    }

    return {
      ok: true,
      result: {
        me: { user: clean, power: power1, team: myTeam },
        opponent: { user: opponent, power: power2, team: oppTeam, isBot: opponentIsBot },
        winner,
        outcome: winner === clean ? 'win' : (winner === null ? 'draw' : 'lose'),
        xpReward,
        score: { me: script.score1, opp: script.score2 },
        events: script.events, // сценарий матча для анимации
      },
      xp: xpResult,
    };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

// ------------------------------------------------------------
//  getBattleHistory
// ------------------------------------------------------------
export async function getBattleHistory(_chatId: unknown, userName: unknown) {
  try {
    const clean = String(userName || '').trim();
    const rows = await db(`team_battles?or=(user1.eq.${enc(clean)},user2.eq.${enc(clean)})&order=created_at.desc&limit=10`) ?? [];

    const battles = rows.map((b: any) => {
      const isMe1 = b.user1 === clean;
      const myPower = isMe1 ? b.user1_power : b.user2_power;
      const oppPower = isMe1 ? b.user2_power : b.user1_power;
      const oppUser = isMe1 ? b.user2 : b.user1;
      let outcome = 'draw';
      if (b.winner === clean) outcome = 'win';
      else if (b.winner === oppUser) outcome = 'lose';
      return {
        id: b.id, opponent: oppUser,
        myPower, oppPower, outcome,
        xpReward: b.xp_reward, date: b.created_at,
      };
    });
    return { ok: true, battles };
  } catch (e: any) { return { ok: false, error: e.message }; }
}
