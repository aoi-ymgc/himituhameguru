import { CARD_TYPES, type CardType } from "../../shared/cards.js";
import { addPlayer, createRoom, playCard, startGame, submitAction, submitIncident, type ActionOutcome, type RoomInternal } from "./game.js";

class SeededRandom {
  constructor(private state: number) {}
  next = (): number => {
    this.state = (this.state * 1664525 + 1013904223) >>> 0;
    return this.state / 0x1_0000_0000;
  };
  item<T>(items: T[]): T { return items[Math.floor(this.next() * items.length)]; }
}

interface Metrics {
  games: number;
  detectiveWins: number;
  secretWins: number;
  allyGames: number;
  allyWins: number;
  turns: number;
  estimatedSeconds: number;
  unusedPlayable: number;
  noEffect: number;
  dealt: Record<CardType, number>;
  unused: Record<CardType, number>;
  triggers: Record<string, number>;
}

const emptyCardRecord = (): Record<CardType, number> => Object.fromEntries(CARD_TYPES.map((type) => [type, 0])) as Record<CardType, number>;

function choosePlayable(room: RoomInternal, random: SeededRandom) {
  const actor = room.players[room.turnIndex];
  const playable = actor.hand.filter((card) => card.type !== "secret");
  const firstRoundComplete = room.players.every((player) => player.turnsCompleted > 0);
  const safe = playable.filter((card) => card.type !== "deduce" || firstRoundComplete);
  const pool = safe.length ? safe : playable;
  if (actor.isAlly) {
    const allyInfo = pool.find((card) => card.type === "deduce");
    if (allyInfo && random.next() < 0.45) return allyInfo;
  }
  const ally = pool.find((card) => card.type === "ally");
  if (ally) return ally;
  const holdsSecret = actor.hand.some((card) => card.type === "secret");
  const withoutDeduce = pool.filter((card) => card.type !== "deduce");
  if (holdsSecret && withoutDeduce.length) return random.item(withoutDeduce);
  const deduce = pool.find((card) => card.type === "deduce");
  if (deduce && (pool.length <= 2 || random.next() < 0.25)) return deduce;
  const information = pool.filter((card) => ["peek", "observe", "rumor", "footprint"].includes(card.type));
  if (information.length && random.next() < 0.55) return random.item(information);
  return random.item(pool);
}

function observeNotices(knowledge: Map<string, string>, outcome: ActionOutcome, actorId: string, targetId?: string): void {
  if (!targetId) return;
  const notice = outcome.notices.find((item) => item.playerId === actorId && item.cards.includes("secret"));
  if (notice) knowledge.set(actorId, targetId);
}

function simulateOne(playerCount: number, random: SeededRandom, metrics: Metrics): void {
  const room = createRoom("SIM234", "P1", "s1");
  for (let index = 1; index < playerCount; index += 1) addPlayer(room, `P${index + 1}`, `s${index + 1}`);
  startGame(room, room.hostId, random.next);
  submitIncident(room, room.firstFinderId!, "シミュレーション事件", random.next);
  room.players.flatMap((player) => player.hand).forEach((card) => { metrics.dealt[card.type] += 1; });
  const knowledge = new Map<string, string>();
  let steps = 0;
  while (room.status === "playing" && steps < playerCount * 24) {
    steps += 1;
    if (!room.pending) {
      const actor = room.players[room.turnIndex];
      const selected = choosePlayable(room, random);
      playCard(room, actor.id, selected.instanceId, random.next);
      if (["swap", "share", "rotate", "chaos"].includes(selected.type)) knowledge.clear();
      continue;
    }
    const pending = room.pending;
    if (pending.kind === "no-effect") {
      submitAction(room, pending.actorId, pending.id, "confirm", random.next);
      metrics.noEffect += 1;
    } else if (pending.kind === "target") {
      const actor = room.players.find((player) => player.id === pending.actorId)!;
      let targetId = knowledge.get(actor.id);
      if (!targetId || !pending.allowedTargetIds.includes(targetId)) {
        const allies = room.players.filter((player) => player.isAlly && pending.allowedTargetIds.includes(player.id));
        targetId = pending.card === "swap" && actor.hand.some((card) => card.type === "secret") && allies.length
          ? random.item(allies).id
          : random.item(pending.allowedTargetIds);
      }
      const outcome = submitAction(room, actor.id, pending.id, targetId, random.next);
      if (["peek", "observe", "deduce"].includes(pending.card)) observeNotices(knowledge, outcome, actor.id, targetId);
    } else if (pending.kind === "recall") {
      submitAction(room, pending.actorId, pending.id, random.item(pending.allowedRecordIds), random.next);
    } else if (pending.kind === "share-actor-card") {
      const actor = room.players.find((player) => player.id === pending.actorId)!;
      const choices = actor.hand.filter((card) => card.type !== "secret");
      submitAction(room, actor.id, pending.id, random.item(choices.length ? choices : actor.hand).instanceId, random.next);
    } else if (pending.kind === "share-target-card") {
      const target = room.players.find((player) => player.id === pending.targetId)!;
      const choices = target.hand.filter((card) => card.type !== "secret");
      submitAction(room, target.id, pending.id, random.item(choices.length ? choices : target.hand).instanceId, random.next);
    } else if (pending.kind === "rotate") {
      for (const player of room.players) {
        const current = room.pending;
        if (!current || current.kind !== "rotate") break;
        if (current.selections[player.id] !== undefined) continue;
        const choices = player.hand.filter((card) => card.type !== "secret");
        submitAction(room, player.id, current.id, random.item(choices.length ? choices : player.hand).instanceId, random.next);
      }
    }
  }
  if (room.status !== "finished" || !room.result) throw new Error(`${playerCount}人ゲームが${steps}ステップで完了しませんでした`);
  metrics.games += 1;
  metrics[room.result.winningSide === "detective" ? "detectiveWins" : "secretWins"] += 1;
  const allies = room.players.filter((player) => player.isAlly);
  if (allies.length) {
    metrics.allyGames += 1;
    if (room.result.winningSide === "secret") metrics.allyWins += 1;
  }
  metrics.turns += room.turnNumber;
  metrics.estimatedSeconds += 45 + room.turnNumber * 18;
  for (const card of room.players.flatMap((player) => player.hand)) {
    metrics.unused[card.type] += 1;
    if (card.type !== "secret") metrics.unusedPlayable += 1;
  }
  const logs = room.logs.map((log) => log.text);
  metrics.triggers.decoy += logs.filter((log) => log.includes("『おとり』が発動")).length;
  metrics.triggers.ally += logs.filter((log) => log.includes("『なかま』になりました")).length;
  metrics.triggers.recall += logs.filter((log) => log.includes("手札へ戻しました")).length;
  metrics.triggers.footprint += logs.filter((log) => log.includes("左右どなりの中")).length;
  metrics.triggers.chaos += logs.filter((log) => log.includes("大きく入れ替わりました")).length;
}

function run(playerCount: number, games: number, seed: number) {
  const metrics: Metrics = {
    games: 0, detectiveWins: 0, secretWins: 0, allyGames: 0, allyWins: 0, turns: 0,
    estimatedSeconds: 0, unusedPlayable: 0, noEffect: 0, dealt: emptyCardRecord(), unused: emptyCardRecord(),
    triggers: { decoy: 0, ally: 0, recall: 0, footprint: 0, chaos: 0 },
  };
  const random = new SeededRandom(seed + playerCount * 10_007);
  for (let index = 0; index < games; index += 1) simulateOne(playerCount, random, metrics);
  const pct = (value: number, base = games) => Number((value / Math.max(1, base) * 100).toFixed(1));
  return {
    players: playerCount,
    games,
    detectiveWinPct: pct(metrics.detectiveWins),
    secretWinPct: pct(metrics.secretWins),
    allyActivatedPct: pct(metrics.allyGames),
    allyWinPctWhenActivated: pct(metrics.allyWins, metrics.allyGames),
    avgTurns: Number((metrics.turns / games).toFixed(2)),
    avgEstimatedMinutes: Number((metrics.estimatedSeconds / games / 60).toFixed(2)),
    avgUnusedPlayableCards: Number((metrics.unusedPlayable / games).toFixed(2)),
    noEffectPerGame: Number((metrics.noEffect / games).toFixed(2)),
    unusedPctByCard: Object.fromEntries(CARD_TYPES.filter((type) => metrics.dealt[type]).map((type) => [type, pct(metrics.unused[type], metrics.dealt[type])])),
    specialTriggersPer100Games: Object.fromEntries(Object.entries(metrics.triggers).map(([key, value]) => [key, Number((value / games * 100).toFixed(1))])),
  };
}

const games = Number(process.argv[2] ?? 3000);
const results = [3, 4, 5, 6, 8].map((count) => run(count, games, 20260717));
console.log(JSON.stringify({ model: "observable-information heuristic AI with seeded random noise", gamesPerPlayerCount: games, results }, null, 2));
