import { randomBytes, randomUUID } from "node:crypto";
import { CARD_DEFINITIONS, DECK_COUNTS, type CardType, type CharacterId } from "../../shared/cards.js";
import type { CardEffectEvent, CardView, GameResult, GameSettings, PendingView, PlayerView, RoomView } from "../../shared/types.js";

export interface CardInstance {
  instanceId: string;
  type: CardType;
}

export interface PlayerInternal {
  id: string;
  token: string;
  name: string;
  character: CharacterId;
  socketId: string | null;
  connected: boolean;
  isAlly: boolean;
  hand: CardInstance[];
  pendingNotices: QueuedNotice[];
  turnsCompleted: number;
}

interface BasePending {
  id: string;
  actorId: string;
  expiresAt: number;
}

interface TargetPending extends BasePending {
  kind: "target";
  card: CardType;
  cardInstanceId: string;
  allowedTargetIds: string[];
  resumeTurnEndsAt: number | null;
}

interface NoEffectPending extends BasePending {
  kind: "no-effect";
  card: CardType;
  cardInstanceId: string;
  reason: string;
  resumeTurnEndsAt: number | null;
}

interface RecallPending extends BasePending {
  kind: "recall";
  allowedRecordIds: string[];
}

interface ShareActorPending extends BasePending {
  kind: "share-actor-card";
  targetId: string;
}

interface ShareTargetPending extends BasePending {
  kind: "share-target-card";
  targetId: string;
  actorCardId: string;
}

interface RotatePending extends BasePending {
  kind: "rotate";
  selections: Record<string, string | null | undefined>;
}

export type PendingAction = TargetPending | ShareActorPending | ShareTargetPending | RotatePending | NoEffectPending | RecallPending;

interface DiscardRecord {
  id: string;
  playerId: string;
  card: CardInstance;
  reason: "played" | "passive" | "timeout";
}

export interface RoomInternal {
  code: string;
  status: "lobby" | "incident" | "playing" | "finished";
  hostId: string;
  players: PlayerInternal[];
  settings: GameSettings;
  turnIndex: number;
  turnNumber: number;
  turnEndsAt: number | null;
  discard: CardType[];
  discardRecords: DiscardRecord[];
  logs: { id: string; text: string; at: number }[];
  pending: PendingAction | null;
  result: GameResult | null;
  startedAt: number | null;
  firstFinderId: string | null;
  incidentTitle: string | null;
  updatedAt: number;
}

export interface PrivateNotice {
  playerId: string;
  title: string;
  message?: string;
  cards: CardType[];
  durationMs: number;
}

export interface QueuedNotice extends PrivateNotice {
  id: string;
}

export interface ActionOutcome {
  notices: PrivateNotice[];
  effects: CardEffectEvent[];
  turnAdvanced: boolean;
}

const CHARACTERS: CharacterId[] = ["sheep", "hamster", "tanuki", "wolf", "penguin"];

const shuffle = <T>(items: T[], random = Math.random): T[] => {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
};

const randomItem = <T>(items: T[], random = Math.random): T => items[Math.floor(random() * items.length)];

const normalizeName = (name: string): string => name.trim().replace(/\s+/g, " ").slice(0, 16);
const withSan = (name: string): string => name.endsWith("さん") ? name : `${name}さん`;

export function createPlayer(name: string, socketId: string | null, index: number): PlayerInternal {
  return {
    id: randomUUID(),
    token: randomBytes(24).toString("base64url"),
    name: normalizeName(name),
    character: CHARACTERS[index % CHARACTERS.length],
    socketId,
    connected: Boolean(socketId),
    isAlly: false,
    hand: [],
    pendingNotices: [],
    turnsCompleted: 0,
  };
}

export function createRoom(code: string, hostName: string, socketId: string): RoomInternal {
  const host = createPlayer(hostName, socketId, 0);
  return {
    code,
    status: "lobby",
    hostId: host.id,
    players: [host],
    settings: { maxPlayers: 8, turnSeconds: 0, animationSpeed: "normal" },
    turnIndex: 0,
    turnNumber: 0,
    turnEndsAt: null,
    discard: [],
    discardRecords: [],
    logs: [],
    pending: null,
    result: null,
    startedAt: null,
    firstFinderId: null,
    incidentTitle: null,
    updatedAt: Date.now(),
  };
}

export function addPlayer(room: RoomInternal, name: string, socketId: string): PlayerInternal {
  if (room.status !== "lobby") throw new Error("ゲーム開始後は参加できません");
  if (room.players.length >= room.settings.maxPlayers) throw new Error("この部屋は満員です");
  const normalized = normalizeName(name);
  if (!normalized) throw new Error("プレイヤー名を入力してください");
  if (room.players.some((player) => player.name === normalized)) throw new Error("同じ名前のプレイヤーがいます");
  const player = createPlayer(normalized, socketId, room.players.length);
  room.players.push(player);
  addLog(room, `${withSan(player.name)}が参加しました`);
  touch(room);
  return player;
}

export function buildDeck(playerCount: number, random = Math.random): CardInstance[] {
  const counts = DECK_COUNTS[playerCount];
  if (!counts) throw new Error("対応人数は3〜8人です");
  const deck: CardInstance[] = [];
  for (const [type, count] of Object.entries(counts) as [CardType, number][]) {
    for (let index = 0; index < count; index += 1) {
      deck.push({ instanceId: randomUUID(), type });
    }
  }
  if (deck.length !== playerCount * 4) throw new Error("デッキ枚数が正しくありません");
  return shuffle(deck, random);
}

export function startGame(room: RoomInternal, actorId: string, random = Math.random): void {
  if (actorId !== room.hostId) throw new Error("ホストだけが開始できます");
  if (room.status !== "lobby" && room.status !== "finished") throw new Error("すでにゲーム中です");
  if (room.players.length < 3 || room.players.length > 8) throw new Error("3〜8人で開始してください");

  room.players.forEach((player) => {
    player.hand = [];
    player.isAlly = false;
    player.turnsCompleted = 0;
    player.pendingNotices = [];
  });
  const previousFirstFinderId = room.firstFinderId;
  const connectedPlayers = room.players.filter((player) => player.connected);
  const candidates = connectedPlayers.filter((player) => player.id !== previousFirstFinderId);
  const finderPool = candidates.length ? candidates : connectedPlayers.length ? connectedPlayers : room.players;
  const firstFinder = randomItem(finderPool, random);
  room.firstFinderId = firstFinder.id;
  room.incidentTitle = null;
  room.turnIndex = room.players.findIndex((player) => player.id === firstFinder.id);
  room.turnNumber = 0;
  room.discard = [];
  room.discardRecords = [];
  room.logs = [];
  room.pending = null;
  room.result = null;
  room.startedAt = null;
  room.status = "incident";
  addLog(room, `${withSan(firstFinder.name)}が最初の発見者になりました`);
  touch(room);
}

export function submitIncident(room: RoomInternal, actorId: string, title: string, random = Math.random): void {
  if (room.status !== "incident") throw new Error("事件発表の受付中ではありません");
  const firstFinder = room.players.find((player) => player.id === room.firstFinderId);
  if (!firstFinder) throw new Error("最初の発見者が見つかりません");
  const canSubstitute = actorId === room.hostId && !firstFinder.connected;
  if (actorId !== firstFinder.id && !canSubstitute) throw new Error("最初の発見者だけが事件を発表できます");
  const normalized = title.trim().replace(/\s+/g, " ").slice(0, 80);
  if (!normalized) throw new Error("今回の事件を入力してください");

  const deck = buildDeck(room.players.length, random);
  room.players.forEach((player) => { player.hand = []; });
  deck.forEach((card, index) => room.players[index % room.players.length].hand.push(card));
  room.turnIndex = room.players.findIndex((player) => player.id === firstFinder.id);
  room.turnNumber = 1;
  room.incidentTitle = normalized;
  room.startedAt = Date.now();
  room.status = "playing";
  addLog(room, `今回の事件は「${normalized}」です`);
  addLog(room, `ゲーム開始！ 最初は${withSan(firstFinder.name)}です`);
  touch(room);
}

export function updateSettings(room: RoomInternal, actorId: string, settings: Partial<GameSettings>): void {
  if (actorId !== room.hostId) throw new Error("ホストだけが設定できます");
  if (room.status !== "lobby") throw new Error("設定はロビーで変更してください");
  if (settings.maxPlayers !== undefined) {
    if (settings.maxPlayers < 3 || settings.maxPlayers > 8 || settings.maxPlayers < room.players.length) {
      throw new Error("参加人数以上の3〜8人を選んでください");
    }
    room.settings.maxPlayers = settings.maxPlayers;
  }
  if (settings.turnSeconds !== undefined && [0, 30, 60, 90].includes(settings.turnSeconds)) {
    room.settings.turnSeconds = settings.turnSeconds;
  }
  if (settings.animationSpeed !== undefined && ["normal", "fast"].includes(settings.animationSpeed)) {
    room.settings.animationSpeed = settings.animationSpeed;
  }
  touch(room);
}

export function kickPlayer(room: RoomInternal, actorId: string, targetId: string): PlayerInternal {
  if (actorId !== room.hostId) throw new Error("ホストだけが操作できます");
  if (room.status !== "lobby") throw new Error("ゲーム中は退出させられません");
  if (targetId === room.hostId) throw new Error("ホスト自身は退出させられません");
  const index = room.players.findIndex((player) => player.id === targetId);
  if (index < 0) throw new Error("プレイヤーが見つかりません");
  const [removed] = room.players.splice(index, 1);
  addLog(room, `${withSan(removed.name)}が退出しました`);
  touch(room);
  return removed;
}

export interface EffectAvailability {
  canUse: boolean;
  reason: string;
}

export function canUseEffect(room: RoomInternal, actorId: string, card: CardInstance): EffectAvailability {
  const actor = playerById(room, actorId);
  const unavailable = (reason: string): EffectAvailability => ({ canUse: false, reason });
  if (card.type === "secret") return unavailable("『ひみつ』は直接使えません");
  if (card.type === "decoy") return unavailable("『おとり』は手札にある間だけ自動で効果を発揮します");
  if (card.type === "deduce" && room.players.some((player) => player.turnsCompleted === 0)) {
    return unavailable("『みぬく』は全員が1回行動してから使えます");
  }
  if (["swap", "share", "observe"].includes(card.type) && !actor.hand.some((item) => item.instanceId !== card.instanceId)) {
    return unavailable("効果に必要な自分のカードがありません");
  }
  if (["deduce", "peek", "swap", "share", "observe", "footprint"].includes(card.type) && targetIdsFor(room, actorId, card.type).length === 0) {
    return unavailable("効果が成立する対象がいません");
  }
  if (card.type === "ally" && actor.isAlly) return unavailable("すでにひみつ側のなかまです");
  if (card.type === "again" && recallableRecords(room, actorId).length === 0) {
    return unavailable("回収できる自分の使用済みカードがありません");
  }
  return { canUse: true, reason: "" };
}

export function playCard(room: RoomInternal, actorId: string, instanceId: string, random = Math.random): ActionOutcome {
  assertPlaying(room);
  if (room.pending) throw new Error("カードの処理が終わるまでお待ちください");
  const actor = currentPlayer(room);
  if (actor.id !== actorId) throw new Error("あなたのターンではありません");
  const cardIndex = actor.hand.findIndex((card) => card.instanceId === instanceId);
  if (cardIndex < 0) throw new Error("そのカードは手札にありません");
  const card = actor.hand[cardIndex];
  if (card.type === "secret") throw new Error("『ひみつ』は直接使えません");

  const notices: PrivateNotice[] = [];
  const effects: CardEffectEvent[] = [];
  let turnAdvanced = false;

  const availability = canUseEffect(room, actorId, card);
  if (!availability.canUse) {
    room.pending = {
      id: randomUUID(),
      kind: "no-effect",
      actorId,
      expiresAt: Date.now() + 60_000,
      card: card.type,
      cardInstanceId: card.instanceId,
      reason: availability.reason,
      resumeTurnEndsAt: room.turnEndsAt,
    };
    room.turnEndsAt = null;
    touch(room);
    return { notices, effects, turnAdvanced };
  }

  if (["deduce", "peek", "swap", "share", "observe", "footprint"].includes(card.type)) {
    const allowedTargetIds = targetIdsFor(room, actorId, card.type);
    room.pending = { id: randomUUID(), kind: "target", actorId, expiresAt: Date.now() + 60_000, card: card.type, cardInstanceId: card.instanceId, allowedTargetIds, resumeTurnEndsAt: room.turnEndsAt };
    room.turnEndsAt = null;
  } else if (card.type === "rotate") {
    commitCard(room, actor, card.instanceId);
    effects.push(effectEvent(actor, card.type));
    const selections: Record<string, string | null | undefined> = {};
    for (const player of room.players) selections[player.id] = player.hand.length ? undefined : null;
    room.pending = { id: randomUUID(), kind: "rotate", actorId, expiresAt: Date.now() + 60_000, selections };
    if (Object.values(selections).every((value) => value !== undefined)) {
      resolveRotate(room);
      turnAdvanced = finishAction(room, actorId, false);
    }
  } else if (card.type === "rumor") {
    commitCard(room, actor, card.instanceId);
    effects.push(effectEvent(actor, card.type));
    const holder = secretHolder(room);
    const candidateCount = room.players.length >= 5 ? 3 : 2;
    const others = shuffle(room.players.filter((player) => player.id !== holder.id), random).slice(0, candidateCount - 1);
    const candidates = shuffle([holder, ...others], random).map((player) => player.name);
    addLog(room, `うわさの候補は「${candidates.join("・")}」です`);
    turnAdvanced = finishAction(room, actorId, false);
  } else if (card.type === "again") {
    commitCard(room, actor, card.instanceId);
    effects.push(effectEvent(actor, card.type));
    const records = recallableRecords(room, actorId);
    room.pending = { id: randomUUID(), kind: "recall", actorId, expiresAt: Date.now() + 60_000, allowedRecordIds: records.map((record) => record.id) };
  } else if (card.type === "ally") {
    commitCard(room, actor, card.instanceId);
    actor.isAlly = true;
    effects.push(effectEvent(actor, card.type));
    addLog(room, `${withSan(actor.name)}がひみつ側の『なかま』になりました`);
    turnAdvanced = finishAction(room, actorId, false);
  } else if (card.type === "chaos") {
    commitCard(room, actor, card.instanceId);
    effects.push(effectEvent(actor, card.type));
    const counts = room.players.map((player) => player.hand.length);
    const pool = shuffle(room.players.flatMap((player) => player.hand), random);
    room.players.forEach((player) => { player.hand = []; });
    let cursor = 0;
    room.players.forEach((player, index) => {
      player.hand = pool.slice(cursor, cursor + counts[index]);
      cursor += counts[index];
    });
    addLog(room, "全員の手札が大きく入れ替わりました");
    const holder = secretHolder(room);
    const candidateCount = room.players.length >= 5 ? 3 : 2;
    const others = shuffle(room.players.filter((player) => player.id !== holder.id), random).slice(0, candidateCount - 1);
    const candidates = shuffle([holder, ...others], random).map((player) => player.name);
    addLog(room, `大混乱後の候補は「${candidates.join("・")}」です`);
    turnAdvanced = finishAction(room, actorId, false);
  }

  touch(room);
  return { notices, effects, turnAdvanced };
}

export function submitAction(room: RoomInternal, playerId: string, pendingId: string, optionId: string, random = Math.random): ActionOutcome {
  assertPlaying(room);
  const pending = room.pending;
  if (!pending || pending.id !== pendingId) throw new Error("この選択はすでに終了しています");
  const notices: PrivateNotice[] = [];
  const effects: CardEffectEvent[] = [];
  let turnAdvanced = false;

  if (pending.kind === "no-effect") {
    if (pending.actorId !== playerId) throw new Error("選択できるプレイヤーではありません");
    if (optionId !== "confirm") throw new Error("その操作は選べません");
    const actor = playerById(room, pending.actorId);
    const card = actor.hand.find((item) => item.instanceId === pending.cardInstanceId);
    if (!card) throw new Error("捨てるカードが見つかりません");
    if (canUseEffect(room, actor.id, card).canUse) throw new Error("現在はカード効果を使用できます");
    room.pending = null;
    commitCard(room, actor, card.instanceId, false);
    addLog(room, card.type === "decoy"
      ? `${withSan(actor.name)}が『${CARD_DEFINITIONS[card.type].name}』を捨てました`
      : `${withSan(actor.name)}が『${CARD_DEFINITIONS[card.type].name}』を使用しましたが、効果は発生しませんでした`);
    turnAdvanced = finishAction(room, actor.id, false);
  } else if (pending.kind === "recall") {
    if (pending.actorId !== playerId) throw new Error("選択できるプレイヤーではありません");
    if (!pending.allowedRecordIds.includes(optionId)) throw new Error("そのカードは回収できません");
    const actor = playerById(room, pending.actorId);
    const recordIndex = room.discardRecords.findIndex((record) => record.id === optionId && record.playerId === actor.id);
    if (recordIndex < 0) throw new Error("回収するカードが見つかりません");
    const [record] = room.discardRecords.splice(recordIndex, 1);
    room.discard.splice(recordIndex, 1);
    actor.hand.push(record.card);
    room.pending = null;
    addLog(room, `${withSan(actor.name)}が『${CARD_DEFINITIONS[record.card.type].name}』を手札へ戻しました`);
    notices.push({ playerId: actor.id, title: "手もどし", message: "使用済みカードを1枚、手札へ戻しました。", cards: [record.card.type], durationMs: 3000 });
    turnAdvanced = finishAction(room, actor.id, false);
  } else if (pending.kind === "target") {
    if (pending.actorId !== playerId) throw new Error("選択できるプレイヤーではありません");
    if (!pending.allowedTargetIds.includes(optionId)) throw new Error("その人は選択できません");
    const actor = playerById(room, pending.actorId);
    const target = playerById(room, optionId);
    room.pending = null;
    commitCard(room, actor, pending.cardInstanceId);
    const targetPublic = CARD_DEFINITIONS[pending.card].targetVisibility === "public";
    effects.push(effectEvent(actor, pending.card, targetPublic ? target : undefined));
    if (targetPublic) addLog(room, `${withSan(actor.name)}が${withSan(target.name)}を選びました`);

    if (pending.card === "deduce") {
      const decoyIndex = target.hand.findIndex((card) => card.type === "decoy");
      if (decoyIndex >= 0) {
        const [decoy] = target.hand.splice(decoyIndex, 1);
        recordDiscard(room, target.id, decoy, "passive");
        effects.push(effectEvent(target, "decoy", actor));
        addLog(room, `${withSan(target.name)}の『おとり』が発動し、『みぬく』を防ぎました`);
        notices.push({ playerId: actor.id, title: "おとり発動！", message: `${withSan(target.name)}への『みぬく』は防がれました。`, cards: ["decoy"], durationMs: 3200 });
        if (!hasDeduceCards(room)) finishGame(room, "secret", "escaped");
        else turnAdvanced = finishAction(room, actor.id, false);
      } else if (actor.isAlly) {
        const hasSecret = target.hand.some((card) => card.type === "secret");
        notices.push({ playerId: actor.id, title: `${withSan(target.name)}をひそかに確認`, message: hasSecret ? "この人が現在の『ひみつ』保持者です。" : "この人は現在『ひみつ』を持っていません。", cards: hasSecret ? ["secret"] : [], durationMs: 3600 });
        if (!hasDeduceCards(room)) finishGame(room, "secret", "escaped");
        else turnAdvanced = finishAction(room, actor.id, false);
      } else if (target.hand.some((card) => card.type === "secret")) {
        finishGame(room, "detective", "deduced", actor);
      } else {
        addLog(room, `予想ははずれ。${withSan(target.name)}は『ひみつ』を持っていませんでした`);
        effects.push(effectEvent(actor, "deduce", target, "deduce-failed"));
        if (!hasDeduceCards(room)) {
          addLog(room, "『みぬく』をすべて使い切ったため、ひみつの持ち主が逃げ切りました");
          finishGame(room, "secret", "escaped");
        } else {
          turnAdvanced = finishAction(room, actor.id, false);
        }
      }
    } else if (pending.card === "peek") {
      if (target.hand.length) {
        const seen = randomItem(target.hand, random);
        notices.push({ playerId: actor.id, title: `${withSan(target.name)}の手札をちらり`, cards: [seen.type], durationMs: 3200 });
        notices.push({ playerId: target.id, title: "あなたへの効果", message: `${withSan(actor.name)}があなたの手札を1枚確認しました。カードの内容は公開されていません。`, cards: [], durationMs: 3200 });
      }
      addLog(room, `${withSan(actor.name)}だけがカードを確認しました（対象は非公開）`);
      turnAdvanced = finishAction(room, actor.id, false);
    } else if (pending.card === "swap") {
      if (actor.hand.length && target.hand.length) {
        const actorCard = randomItem(actor.hand, random);
        const targetCard = randomItem(target.hand, random);
        exchangeCards(actor, target, actorCard.instanceId, targetCard.instanceId);
        addLog(room, "カードがこっそり交換されました");
        notices.push({ playerId: actor.id, title: "こっそり交換しました", message: `${withSan(target.name)}とランダムに1枚交換しました。`, cards: [], durationMs: 3000 });
        notices.push({ playerId: target.id, title: "あなたへの効果", message: `${withSan(actor.name)}とランダムに1枚交換しました。`, cards: [], durationMs: 3000 });
      } else {
        addLog(room, "交換できるカードがなく、効果は発生しませんでした");
      }
      turnAdvanced = finishAction(room, actor.id, false);
    } else if (pending.card === "share") {
      if (!actor.hand.length || !target.hand.length) {
        addLog(room, "交換できるカードがなく、効果は発生しませんでした");
        turnAdvanced = finishAction(room, actor.id, false);
      } else {
        room.pending = { id: randomUUID(), kind: "share-actor-card", actorId: actor.id, targetId: target.id, expiresAt: Date.now() + 60_000 };
      }
    } else if (pending.card === "observe") {
      notices.push({ playerId: actor.id, title: `${withSan(target.name)}の手札`, cards: target.hand.map((card) => card.type), durationMs: 5200 });
      if (actor.hand.length) {
        notices.push({ playerId: target.id, title: `${withSan(actor.name)}の手札から見えた1枚`, cards: [randomItem(actor.hand, random).type], durationMs: 5200 });
      }
      addLog(room, `${withSan(actor.name)}が誰かをじっくり観察しました（対象は非公開）`);
      turnAdvanced = finishAction(room, actor.id, false);
    } else if (pending.card === "footprint") {
      const targetIndex = room.players.findIndex((player) => player.id === target.id);
      const nearby = [
        room.players[(targetIndex - 1 + room.players.length) % room.players.length],
        target,
        room.players[(targetIndex + 1) % room.players.length],
      ];
      const uniqueNearby = [...new Map(nearby.map((player) => [player.id, player])).values()];
      const found = uniqueNearby.some((player) => player.hand.some((item) => item.type === "secret"));
      addLog(room, `${withSan(target.name)}と左右どなりの中に『ひみつ』は${found ? "あります" : "ありません"}`);
      turnAdvanced = finishAction(room, actor.id, false);
    }
  } else if (pending.kind === "share-actor-card") {
    if (pending.actorId !== playerId) throw new Error("選択できるプレイヤーではありません");
    const actor = playerById(room, pending.actorId);
    if (!actor.hand.some((card) => card.instanceId === optionId)) throw new Error("そのカードは選べません");
    room.pending = { id: randomUUID(), kind: "share-target-card", actorId: actor.id, targetId: pending.targetId, actorCardId: optionId, expiresAt: Date.now() + 60_000 };
  } else if (pending.kind === "share-target-card") {
    if (pending.targetId !== playerId) throw new Error("選択できるプレイヤーではありません");
    const actor = playerById(room, pending.actorId);
    const target = playerById(room, pending.targetId);
    if (!target.hand.some((card) => card.instanceId === optionId)) throw new Error("そのカードは選べません");
    exchangeCards(actor, target, pending.actorCardId, optionId);
    room.pending = null;
    addLog(room, `${withSan(actor.name)}と誰かがお互いに1枚ずつ渡しました（対象は非公開）`);
    notices.push({ playerId: actor.id, title: "おすそわけ完了", message: `${withSan(target.name)}と1枚ずつ交換しました。`, cards: [], durationMs: 3000 });
    notices.push({ playerId: target.id, title: "おすそわけ完了", message: `${withSan(actor.name)}と1枚ずつ交換しました。`, cards: [], durationMs: 3000 });
    turnAdvanced = finishAction(room, actor.id, false);
  } else if (pending.kind === "rotate") {
    if (!(playerId in pending.selections) || pending.selections[playerId] !== undefined) throw new Error("すでに選択済みです");
    const player = playerById(room, playerId);
    if (!player.hand.some((card) => card.instanceId === optionId)) throw new Error("そのカードは選べません");
    pending.selections[playerId] = optionId;
    if (Object.values(pending.selections).every((value) => value !== undefined)) {
      const actorId = pending.actorId;
      resolveRotate(room);
      room.pending = null;
      addLog(room, "全員のカードが右どなり（次の順番の人）へ回りました");
      turnAdvanced = finishAction(room, actorId, false);
    }
  }

  touch(room);
  return { notices, effects, turnAdvanced };
}

export function cancelAction(room: RoomInternal, playerId: string, pendingId: string): void {
  assertPlaying(room);
  const pending = room.pending;
  if (!pending || pending.id !== pendingId) throw new Error("この選択はすでに終了しています");
  if (!["target", "no-effect"].includes(pending.kind) || pending.actorId !== playerId) throw new Error("この処理はキャンセルできません");
  room.pending = null;
  room.turnEndsAt = pending.kind === "target" || pending.kind === "no-effect" ? pending.resumeTurnEndsAt : null;
  touch(room);
}

export function expirePending(room: RoomInternal, random = Math.random): ActionOutcome {
  const pending = room.pending;
  if (!pending) return { notices: [], effects: [], turnAdvanced: false };
  if (pending.kind === "target" || pending.kind === "no-effect") {
    cancelAction(room, pending.actorId, pending.id);
    return { notices: [], effects: [], turnAdvanced: false };
  }
  if (pending.kind === "recall") {
    const record = randomItem(pending.allowedRecordIds, random);
    return submitAction(room, pending.actorId, pending.id, record, random);
  }
  if (pending.kind === "share-actor-card") {
    const actor = playerById(room, pending.actorId);
    const card = randomItem(actor.hand, random);
    return submitAction(room, actor.id, pending.id, card.instanceId, random);
  }
  if (pending.kind === "share-target-card") {
    const target = playerById(room, pending.targetId);
    const card = randomItem(target.hand, random);
    return submitAction(room, target.id, pending.id, card.instanceId, random);
  }
  let outcome: ActionOutcome = { notices: [], effects: [], turnAdvanced: false };
  for (const player of room.players) {
    const latest = room.pending;
    if (!latest || latest.kind !== "rotate" || latest.selections[player.id] !== undefined) continue;
    const card = randomItem(player.hand, random);
    outcome = submitAction(room, player.id, latest.id, card.instanceId, random);
  }
  return outcome;
}

export function timeoutTurn(room: RoomInternal, random = Math.random): boolean {
  if (room.status !== "playing" || room.pending) return false;
  const player = currentPlayer(room);
  const playable = player.hand.filter((card) => card.type !== "secret");
  if (playable.length) {
    const discarded = randomItem(playable, random);
    player.hand = player.hand.filter((card) => card.instanceId !== discarded.instanceId);
    recordDiscard(room, player.id, discarded, "timeout");
    addLog(room, `${withSan(player.name)}は時間切れでカードを1枚失いました`);
  } else {
    addLog(room, `${withSan(player.name)}は使えるカードがないためスキップしました`);
  }
  return finishAction(room, player.id, false);
}

export function returnToLobby(room: RoomInternal, actorId: string): void {
  if (actorId !== room.hostId) throw new Error("ホストだけがロビーへ戻せます");
  room.status = "lobby";
  room.players.forEach((player) => {
    player.hand = [];
    player.isAlly = false;
    player.turnsCompleted = 0;
    player.pendingNotices = [];
  });
  room.pending = null;
  room.discard = [];
  room.discardRecords = [];
  room.result = null;
  room.turnNumber = 0;
  room.turnEndsAt = null;
  room.firstFinderId = null;
  room.incidentTitle = null;
  room.startedAt = null;
  room.logs = [];
  addLog(room, "ロビーへ戻りました");
  touch(room);
}

export function roomView(room: RoomInternal, viewerId: string): RoomView {
  const viewer = playerById(room, viewerId);
  const current = room.status === "playing" ? room.players[room.turnIndex] : null;
  const players: PlayerView[] = room.players.map((player, index) => ({
    id: player.id,
    name: player.name,
    character: player.character,
    isHost: player.id === room.hostId,
    connected: player.connected,
    handCount: player.hand.length,
    isTurn: player.id === current?.id,
    isAlly: player.isAlly,
    seat: index + 1,
  }));

  const nextPlayer = room.status === "playing" ? nextPlayablePlayer(room) : null;

  return {
    code: room.code,
    status: room.status,
    viewerId,
    hostId: room.hostId,
    settings: { ...room.settings },
    players,
    hand: viewer.hand.map((card): CardView => ({ instanceId: card.instanceId, type: card.type })),
    discard: [...room.discard],
    logs: room.logs.slice(-24),
    turnNumber: room.turnNumber,
    turnEndsAt: room.turnEndsAt,
    turnDirection: "clockwise",
    nextPlayerId: nextPlayer?.id ?? null,
    firstRoundComplete: room.players.every((player) => player.turnsCompleted > 0),
    firstFinderId: room.firstFinderId,
    incidentTitle: room.incidentTitle,
    pending: pendingView(room, viewerId),
    result: room.result,
  };
}

function pendingView(room: RoomInternal, viewerId: string): PendingView | null {
  const pending = room.pending;
  if (!pending) return null;
  const pendingCard: CardType = pending.kind === "target" || pending.kind === "no-effect"
    ? pending.card
    : pending.kind === "recall"
      ? "again"
      : pending.kind.startsWith("share") ? "share" : "rotate";
  const waiting = (prompt: string): PendingView => ({ id: pending.id, kind: "waiting", prompt, options: [], card: pendingCard, expiresAt: pending.expiresAt });
  if (pending.kind === "target") {
    if (viewerId !== pending.actorId) return null;
    return {
      id: pending.id,
      kind: "select-player",
      prompt: "対象にする人を選んでください",
      options: pending.allowedTargetIds.map((id) => ({ id, label: playerById(room, id).name })),
      cancellable: true,
      card: pending.card,
      expiresAt: pending.expiresAt,
    };
  }
  if (pending.kind === "no-effect") {
    if (viewerId !== pending.actorId) return null;
    return {
      id: pending.id,
      kind: "no-effect",
      prompt: `現在、このカードの効果を使用できません（${pending.reason}）\n効果を発動せず、このカードを捨てますか？`,
      options: [{ id: "confirm", label: "効果なしで使用する" }],
      cancellable: true,
      card: pending.card,
      expiresAt: pending.expiresAt,
    };
  }
  if (pending.kind === "recall") {
    if (viewerId !== pending.actorId) return waiting(`${withSan(playerById(room, pending.actorId).name)}が戻すカードを選んでいます…`);
    return {
      id: pending.id,
      kind: "select-card",
      prompt: "手札へ戻す、自分の使用済みカードを選んでください",
      options: pending.allowedRecordIds.map((id) => {
        const record = room.discardRecords.find((item) => item.id === id)!;
        return { id, label: CARD_DEFINITIONS[record.card.type].name, meta: record.card.type };
      }),
      card: "again",
      expiresAt: pending.expiresAt,
    };
  }
  if (pending.kind === "share-actor-card") {
    if (viewerId !== pending.actorId) return waiting(`${withSan(playerById(room, pending.actorId).name)}が渡すカードを選んでいます…`);
    return { ...cardSelectionView(room, pending.id, viewerId, "相手へ渡すカードを選んでください"), card: "share", expiresAt: pending.expiresAt };
  }
  if (pending.kind === "share-target-card") {
    if (viewerId !== pending.targetId) return waiting(viewerId === pending.actorId ? `${withSan(playerById(room, pending.targetId).name)}が返すカードを選んでいます…` : "選ばれたプレイヤーが返すカードを選んでいます…");
    return { ...cardSelectionView(room, pending.id, viewerId, "交換で返すカードを選んでください"), card: "share", expiresAt: pending.expiresAt };
  }
  const selectedCount = Object.values(pending.selections).filter((value) => value !== undefined).length;
  if (pending.selections[viewerId] === undefined) {
    return { ...cardSelectionView(room, pending.id, viewerId, "右どなり（次の順番の人）へ渡すカードを選んでください"), kind: "rotate", selectedCount, totalCount: room.players.length, card: "rotate", expiresAt: pending.expiresAt };
  }
  return { id: pending.id, kind: "waiting", prompt: "ほかのプレイヤーの選択を待っています…", options: [], selectedCount, totalCount: room.players.length, card: "rotate", expiresAt: pending.expiresAt };
}

function cardSelectionView(room: RoomInternal, pendingId: string, viewerId: string, prompt: string): PendingView {
  return {
    id: pendingId,
    kind: "select-card",
    prompt,
    options: playerById(room, viewerId).hand.map((card) => ({ id: card.instanceId, label: CARD_DEFINITIONS[card.type].name, meta: card.type })),
  };
}

function targetIdsFor(room: RoomInternal, actorId: string, type: CardType): string[] {
  let targets = type === "footprint" ? [...room.players] : room.players.filter((player) => player.id !== actorId);
  if (["peek", "swap", "share", "observe"].includes(type)) targets = targets.filter((player) => player.hand.length > 0);
  return targets.map((player) => player.id);
}

function commitCard(room: RoomInternal, actor: PlayerInternal, instanceId: string, writeLog = true): CardInstance {
  const cardIndex = actor.hand.findIndex((card) => card.instanceId === instanceId);
  if (cardIndex < 0) throw new Error("使うカードが手札から見つかりません");
  const [card] = actor.hand.splice(cardIndex, 1);
  recordDiscard(room, actor.id, card, "played");
  room.turnEndsAt = null;
  if (writeLog) addLog(room, `${withSan(actor.name)}が『${CARD_DEFINITIONS[card.type].name}』を使いました`);
  return card;
}

function recordDiscard(room: RoomInternal, playerId: string, card: CardInstance, reason: DiscardRecord["reason"]): void {
  room.discard.push(card.type);
  room.discardRecords.push({ id: randomUUID(), playerId, card, reason });
}

function recallableRecords(room: RoomInternal, playerId: string): DiscardRecord[] {
  const allowed = new Set<CardType>(["peek", "swap", "share", "rumor"]);
  return room.discardRecords.filter((record) => record.playerId === playerId && record.reason === "played" && allowed.has(record.card.type));
}

function effectEvent(actor: PlayerInternal, card: CardType, target?: PlayerInternal, outcome?: CardEffectEvent["outcome"]): CardEffectEvent {
  return {
    id: randomUUID(),
    actorId: actor.id,
    actorName: actor.name,
    card,
    targetId: target?.id,
    targetName: target?.name,
    targetPublic: Boolean(target),
    outcome,
  };
}

function exchangeCards(first: PlayerInternal, second: PlayerInternal, firstCardId: string, secondCardId: string): void {
  const firstIndex = first.hand.findIndex((card) => card.instanceId === firstCardId);
  const secondIndex = second.hand.findIndex((card) => card.instanceId === secondCardId);
  if (firstIndex < 0 || secondIndex < 0) throw new Error("交換するカードが見つかりません");
  const firstCard = first.hand[firstIndex];
  const secondCard = second.hand[secondIndex];
  first.hand[firstIndex] = secondCard;
  second.hand[secondIndex] = firstCard;
}

function resolveRotate(room: RoomInternal): void {
  const pending = room.pending;
  if (!pending || pending.kind !== "rotate") throw new Error("回す処理が見つかりません");
  const moved: { fromId: string; card: CardInstance }[] = [];
  room.players.forEach((player) => {
    const selectedId = pending.selections[player.id];
    if (!selectedId) return;
    const cardIndex = player.hand.findIndex((card) => card.instanceId === selectedId);
    if (cardIndex < 0) throw new Error("選択したカードが見つかりません");
    moved.push({ fromId: player.id, card: player.hand.splice(cardIndex, 1)[0] });
  });
  moved.forEach(({ fromId, card }) => {
    const fromIndex = room.players.findIndex((player) => player.id === fromId);
    room.players[(fromIndex + 1) % room.players.length].hand.push(card);
  });
}

function finishAction(room: RoomInternal, actorId: string, extraTurn: boolean): boolean {
  if (room.status === "finished") return false;
  room.pending = null;
  const actor = playerById(room, actorId);
  actor.turnsCompleted += 1;
  if (allPlayableCardsUsed(room)) {
    finishGame(room, "secret", "escaped");
    return false;
  }
  const actorIndex = room.players.findIndex((player) => player.id === actorId);
  if (extraTurn && room.players[actorIndex].hand.some((card) => card.type !== "secret")) {
    room.turnIndex = actorIndex;
    room.turnNumber += 1;
    return true;
  }
  for (let offset = 1; offset <= room.players.length; offset += 1) {
    const nextIndex = (actorIndex + offset) % room.players.length;
    const next = room.players[nextIndex];
    if (next.hand.some((card) => card.type !== "secret")) {
      room.turnIndex = nextIndex;
      room.turnNumber += 1;
      addLog(room, `次は${withSan(next.name)}の番です`);
      return true;
    }
  }
  finishGame(room, "secret", "escaped");
  return false;
}

function finishGame(room: RoomInternal, winningSide: GameResult["winningSide"], reason: GameResult["reason"], deducer?: PlayerInternal): void {
  const holder = secretHolder(room);
  const asResultPlayer = (player: PlayerInternal) => ({ id: player.id, name: player.name });
  const allies = room.players.filter((player) => player.isAlly);
  const detectives = room.players.filter((player) => !player.isAlly && player.id !== holder.id);
  const winners = winningSide === "detective"
    ? detectives
    : [...new Map([holder, ...allies].map((player) => [player.id, player])).values()];
  const legacyWinner = deducer ?? winners[0] ?? holder;
  room.status = "finished";
  room.pending = null;
  room.turnEndsAt = null;
  room.result = {
    winningSide,
    winners: winners.map(asResultPlayer),
    roles: {
      secretHolder: asResultPlayer(holder),
      allies: allies.map(asResultPlayer),
      detectives: detectives.map(asResultPlayer),
    },
    winnerId: legacyWinner.id,
    winnerName: legacyWinner.name,
    secretHolderId: holder.id,
    secretHolderName: holder.name,
    reason,
    durationSeconds: Math.max(1, Math.round((Date.now() - (room.startedAt ?? Date.now())) / 1000)),
  };
  addLog(room, reason === "deduced" ? `${withSan(legacyWinner.name)}が『ひみつ』を見ぬき、推理側が勝利しました！` : `${withSan(holder.name)}が最後まで『ひみつ』を守り、ひみつ側が勝利しました！`);
}

function hasDeduceCards(room: RoomInternal): boolean {
  return room.players.some((player) => player.hand.some((card) => card.type === "deduce"));
}

function allPlayableCardsUsed(room: RoomInternal): boolean {
  return room.players.every((player) => player.hand.every((card) => card.type === "secret"));
}

function secretHolder(room: RoomInternal): PlayerInternal {
  const holder = room.players.find((player) => player.hand.some((card) => card.type === "secret"));
  if (!holder) throw new Error("『ひみつ』カードが見つかりません");
  return holder;
}

function currentPlayer(room: RoomInternal): PlayerInternal {
  const player = room.players[room.turnIndex];
  if (!player) throw new Error("現在のプレイヤーが見つかりません");
  return player;
}

function nextPlayablePlayer(room: RoomInternal): PlayerInternal | null {
  if (room.status !== "playing") return null;
  for (let offset = 1; offset <= room.players.length; offset += 1) {
    const player = room.players[(room.turnIndex + offset) % room.players.length];
    if (player.hand.some((card) => card.type !== "secret")) return player;
  }
  return null;
}

function playerById(room: RoomInternal, playerId: string): PlayerInternal {
  const player = room.players.find((candidate) => candidate.id === playerId);
  if (!player) throw new Error("プレイヤーが見つかりません");
  return player;
}

function assertPlaying(room: RoomInternal): void {
  if (room.status !== "playing") throw new Error("ゲーム中ではありません");
}

function addLog(room: RoomInternal, text: string): void {
  room.logs.push({ id: randomUUID(), text, at: Date.now() });
  if (room.logs.length > 80) room.logs.shift();
}

function touch(room: RoomInternal): void {
  room.updatedAt = Date.now();
}
