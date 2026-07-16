import { randomBytes, randomUUID } from "node:crypto";
import { CARD_DEFINITIONS, DECK_COUNTS, type CardType, type CharacterId } from "../../shared/cards.js";
import type { CardView, GameResult, GameSettings, PendingView, PlayerView, RoomView } from "../../shared/types.js";

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
  protected: boolean;
  hand: CardInstance[];
}

interface BasePending {
  id: string;
  actorId: string;
}

interface TargetPending extends BasePending {
  kind: "target";
  card: Exclude<CardType, "secret" | "rotate" | "rumor" | "again" | "chaos">;
  allowedTargetIds: string[];
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

export type PendingAction = TargetPending | ShareActorPending | ShareTargetPending | RotatePending;

export interface RoomInternal {
  code: string;
  status: "lobby" | "playing" | "finished";
  hostId: string;
  players: PlayerInternal[];
  settings: GameSettings;
  turnIndex: number;
  turnNumber: number;
  turnEndsAt: number | null;
  discard: CardType[];
  logs: { id: string; text: string; at: number }[];
  pending: PendingAction | null;
  result: GameResult | null;
  startedAt: number | null;
  againLockedPlayerId: string | null;
  updatedAt: number;
}

export interface PrivateNotice {
  playerId: string;
  title: string;
  cards: CardType[];
  durationMs: number;
}

export interface ActionOutcome {
  notices: PrivateNotice[];
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

export function createPlayer(name: string, socketId: string | null, index: number): PlayerInternal {
  return {
    id: randomUUID(),
    token: randomBytes(24).toString("base64url"),
    name: normalizeName(name),
    character: CHARACTERS[index % CHARACTERS.length],
    socketId,
    connected: Boolean(socketId),
    protected: false,
    hand: [],
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
    logs: [],
    pending: null,
    result: null,
    startedAt: null,
    againLockedPlayerId: null,
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
  addLog(room, `${player.name}さんが参加しました`);
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

  const deck = buildDeck(room.players.length, random);
  room.players.forEach((player) => {
    player.hand = [];
    player.protected = false;
  });
  deck.forEach((card, index) => room.players[index % room.players.length].hand.push(card));
  room.turnIndex = Math.floor(random() * room.players.length);
  room.turnNumber = 1;
  room.discard = [];
  room.logs = [];
  room.pending = null;
  room.result = null;
  room.startedAt = Date.now();
  room.status = "playing";
  room.againLockedPlayerId = null;
  room.players[room.turnIndex].protected = false;
  addLog(room, `ゲーム開始！ 最初は${room.players[room.turnIndex].name}さんです`);
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
  addLog(room, `${removed.name}さんが退出しました`);
  touch(room);
  return removed;
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
  if (card.type === "again" && room.againLockedPlayerId === actorId) throw new Error("『もう一回』は連続で使えません");

  actor.hand.splice(cardIndex, 1);
  room.discard.push(card.type);
  addLog(room, `${actor.name}さんが『${CARD_DEFINITIONS[card.type].name}』を使いました`);
  room.turnEndsAt = null;

  const notices: PrivateNotice[] = [];
  let turnAdvanced = false;

  if (["deduce", "peek", "swap", "share", "decoy", "observe"].includes(card.type)) {
    const allowedTargetIds = targetIdsFor(room, actorId, card.type);
    if (allowedTargetIds.length === 0) {
      addLog(room, "対象にできる人がいなかったため、効果は発生しませんでした");
      turnAdvanced = finishAction(room, actorId, false);
    } else {
      room.pending = { id: randomUUID(), kind: "target", actorId, card: card.type as TargetPending["card"], allowedTargetIds };
    }
  } else if (card.type === "rotate") {
    const selections: Record<string, string | null | undefined> = {};
    for (const player of room.players) selections[player.id] = player.hand.length ? undefined : null;
    room.pending = { id: randomUUID(), kind: "rotate", actorId, selections };
    if (Object.values(selections).every((value) => value !== undefined)) {
      resolveRotate(room);
      turnAdvanced = finishAction(room, actorId, false);
    }
  } else if (card.type === "rumor") {
    const holder = secretHolder(room);
    const candidateCount = room.players.length >= 5 ? 3 : 2;
    const others = shuffle(room.players.filter((player) => player.id !== holder.id), random).slice(0, candidateCount - 1);
    const candidates = shuffle([holder, ...others], random).map((player) => player.name);
    addLog(room, `うわさの候補は「${candidates.join("・")}」です`);
    turnAdvanced = finishAction(room, actorId, false);
  } else if (card.type === "again") {
    room.againLockedPlayerId = actorId;
    addLog(room, `${actor.name}さんは続けてもう一度行動します`);
    turnAdvanced = finishAction(room, actorId, true);
  } else if (card.type === "chaos") {
    const counts = room.players.map((player) => player.hand.length);
    const pool = shuffle(room.players.flatMap((player) => player.hand), random);
    room.players.forEach((player) => { player.hand = []; });
    let cursor = 0;
    room.players.forEach((player, index) => {
      player.hand = pool.slice(cursor, cursor + counts[index]);
      cursor += counts[index];
    });
    addLog(room, "全員の手札が大きく入れ替わりました");
    turnAdvanced = finishAction(room, actorId, false);
  }

  touch(room);
  return { notices, turnAdvanced };
}

export function submitAction(room: RoomInternal, playerId: string, pendingId: string, optionId: string, random = Math.random): ActionOutcome {
  assertPlaying(room);
  const pending = room.pending;
  if (!pending || pending.id !== pendingId) throw new Error("この選択はすでに終了しています");
  const notices: PrivateNotice[] = [];
  let turnAdvanced = false;

  if (pending.kind === "target") {
    if (pending.actorId !== playerId) throw new Error("選択できるプレイヤーではありません");
    if (!pending.allowedTargetIds.includes(optionId)) throw new Error("その人は選択できません");
    const actor = playerById(room, pending.actorId);
    const target = playerById(room, optionId);
    room.pending = null;
    addLog(room, `${actor.name}さんが${target.name}さんを選びました`);

    if (pending.card === "deduce") {
      if (target.hand.some((card) => card.type === "secret")) {
        finishGame(room, actor, "deduced");
      } else {
        addLog(room, `予想ははずれ。${target.name}さんは『ひみつ』を持っていませんでした`);
        turnAdvanced = finishAction(room, actor.id, false);
      }
    } else if (pending.card === "peek") {
      if (target.hand.length) {
        const seen = randomItem(target.hand, random);
        notices.push({ playerId: actor.id, title: `${target.name}さんの手札をちらり`, cards: [seen.type], durationMs: 3200 });
      }
      addLog(room, `${actor.name}さんだけがカードを確認しました`);
      turnAdvanced = finishAction(room, actor.id, false);
    } else if (pending.card === "swap") {
      if (actor.hand.length && target.hand.length) {
        const actorCard = randomItem(actor.hand, random);
        const targetCard = randomItem(target.hand, random);
        exchangeCards(actor, target, actorCard.instanceId, targetCard.instanceId);
        addLog(room, "カードがこっそり交換されました");
      } else {
        addLog(room, "交換できるカードがなく、効果は発生しませんでした");
      }
      turnAdvanced = finishAction(room, actor.id, false);
    } else if (pending.card === "share") {
      if (!actor.hand.length || !target.hand.length) {
        addLog(room, "交換できるカードがなく、効果は発生しませんでした");
        turnAdvanced = finishAction(room, actor.id, false);
      } else {
        room.pending = { id: randomUUID(), kind: "share-actor-card", actorId: actor.id, targetId: target.id };
      }
    } else if (pending.card === "decoy") {
      target.protected = true;
      addLog(room, `${target.name}さんは次の自分の番まで『みぬく』から守られます`);
      turnAdvanced = finishAction(room, actor.id, false);
    } else if (pending.card === "observe") {
      notices.push({ playerId: actor.id, title: `${target.name}さんの手札`, cards: target.hand.map((card) => card.type), durationMs: 5200 });
      if (actor.hand.length) {
        notices.push({ playerId: target.id, title: `${actor.name}さんの手札から見えた1枚`, cards: [randomItem(actor.hand, random).type], durationMs: 5200 });
      }
      addLog(room, `${actor.name}さんと${target.name}さんが、それぞれ情報を確認しました`);
      turnAdvanced = finishAction(room, actor.id, false);
    }
  } else if (pending.kind === "share-actor-card") {
    if (pending.actorId !== playerId) throw new Error("選択できるプレイヤーではありません");
    const actor = playerById(room, pending.actorId);
    if (!actor.hand.some((card) => card.instanceId === optionId)) throw new Error("そのカードは選べません");
    room.pending = { id: randomUUID(), kind: "share-target-card", actorId: actor.id, targetId: pending.targetId, actorCardId: optionId };
  } else if (pending.kind === "share-target-card") {
    if (pending.targetId !== playerId) throw new Error("選択できるプレイヤーではありません");
    const actor = playerById(room, pending.actorId);
    const target = playerById(room, pending.targetId);
    if (!target.hand.some((card) => card.instanceId === optionId)) throw new Error("そのカードは選べません");
    exchangeCards(actor, target, pending.actorCardId, optionId);
    room.pending = null;
    addLog(room, `${actor.name}さんと${target.name}さんがお互いに1枚ずつ渡しました`);
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
      addLog(room, "全員のカードが左どなりへ回りました");
      turnAdvanced = finishAction(room, actorId, false);
    }
  }

  touch(room);
  return { notices, turnAdvanced };
}

export function timeoutTurn(room: RoomInternal, random = Math.random): boolean {
  if (room.status !== "playing" || room.pending) return false;
  const player = currentPlayer(room);
  const playable = player.hand.filter((card) => card.type !== "secret");
  if (playable.length) {
    const discarded = randomItem(playable, random);
    player.hand = player.hand.filter((card) => card.instanceId !== discarded.instanceId);
    room.discard.push(discarded.type);
    addLog(room, `${player.name}さんは時間切れでカードを1枚失いました`);
  } else {
    addLog(room, `${player.name}さんは使えるカードがないためスキップしました`);
  }
  return finishAction(room, player.id, false);
}

export function returnToLobby(room: RoomInternal, actorId: string): void {
  if (actorId !== room.hostId) throw new Error("ホストだけがロビーへ戻せます");
  room.status = "lobby";
  room.players.forEach((player) => {
    player.hand = [];
    player.protected = false;
  });
  room.pending = null;
  room.discard = [];
  room.result = null;
  room.turnNumber = 0;
  room.turnEndsAt = null;
  room.logs = [];
  addLog(room, "ロビーへ戻りました");
  touch(room);
}

export function roomView(room: RoomInternal, viewerId: string): RoomView {
  const viewer = playerById(room, viewerId);
  const current = room.status === "playing" ? room.players[room.turnIndex] : null;
  const players: PlayerView[] = room.players.map((player) => ({
    id: player.id,
    name: player.name,
    character: player.character,
    isHost: player.id === room.hostId,
    connected: player.connected,
    handCount: player.hand.length,
    isTurn: player.id === current?.id,
    protected: player.protected,
  }));

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
    pending: pendingView(room, viewerId),
    result: room.result,
  };
}

function pendingView(room: RoomInternal, viewerId: string): PendingView | null {
  const pending = room.pending;
  if (!pending) return null;
  const waiting = (prompt: string): PendingView => ({ id: pending.id, kind: "waiting", prompt, options: [] });
  if (pending.kind === "target") {
    if (viewerId !== pending.actorId) return waiting("対象を選んでいます…");
    return {
      id: pending.id,
      kind: "select-player",
      prompt: "対象にする人を選んでください",
      options: pending.allowedTargetIds.map((id) => ({ id, label: playerById(room, id).name })),
    };
  }
  if (pending.kind === "share-actor-card") {
    if (viewerId !== pending.actorId) return waiting(`${playerById(room, pending.actorId).name}さんが渡すカードを選んでいます…`);
    return cardSelectionView(room, pending.id, viewerId, "相手へ渡すカードを選んでください");
  }
  if (pending.kind === "share-target-card") {
    if (viewerId !== pending.targetId) return waiting(`${playerById(room, pending.targetId).name}さんが返すカードを選んでいます…`);
    return cardSelectionView(room, pending.id, viewerId, "交換で返すカードを選んでください");
  }
  const selectedCount = Object.values(pending.selections).filter((value) => value !== undefined).length;
  if (pending.selections[viewerId] === undefined) {
    return { ...cardSelectionView(room, pending.id, viewerId, "左どなりへ渡すカードを選んでください"), kind: "rotate", selectedCount, totalCount: room.players.length };
  }
  return { id: pending.id, kind: "waiting", prompt: "ほかのプレイヤーの選択を待っています…", options: [], selectedCount, totalCount: room.players.length };
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
  if (type === "decoy") return room.players.map((player) => player.id);
  let targets = room.players.filter((player) => player.id !== actorId);
  if (type === "deduce") targets = targets.filter((player) => !player.protected);
  return targets.map((player) => player.id);
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
  if (allPlayableCardsUsed(room)) {
    finishGame(room, secretHolder(room), "escaped");
    return false;
  }
  const actorIndex = room.players.findIndex((player) => player.id === actorId);
  if (extraTurn && room.players[actorIndex].hand.some((card) => card.type !== "secret")) {
    room.turnIndex = actorIndex;
    room.turnNumber += 1;
    return true;
  }
  room.againLockedPlayerId = null;
  for (let offset = 1; offset <= room.players.length; offset += 1) {
    const nextIndex = (actorIndex + offset) % room.players.length;
    const next = room.players[nextIndex];
    if (next.hand.some((card) => card.type !== "secret")) {
      room.turnIndex = nextIndex;
      room.turnNumber += 1;
      next.protected = false;
      addLog(room, `次は${next.name}さんの番です`);
      return true;
    }
  }
  finishGame(room, secretHolder(room), "escaped");
  return false;
}

function finishGame(room: RoomInternal, winner: PlayerInternal, reason: GameResult["reason"]): void {
  const holder = secretHolder(room);
  room.status = "finished";
  room.pending = null;
  room.turnEndsAt = null;
  room.result = {
    winnerId: winner.id,
    winnerName: winner.name,
    secretHolderId: holder.id,
    secretHolderName: holder.name,
    reason,
    durationSeconds: Math.max(1, Math.round((Date.now() - (room.startedAt ?? Date.now())) / 1000)),
  };
  addLog(room, reason === "deduced" ? `${winner.name}さんが『ひみつ』を見ぬきました！` : `${holder.name}さんが最後まで『ひみつ』を守りました！`);
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
