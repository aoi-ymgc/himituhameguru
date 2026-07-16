import assert from "node:assert/strict";
import test from "node:test";
import { CARD_DEFINITIONS, CARD_TYPES } from "../../shared/cards.js";
import { addPlayer, buildDeck, cancelAction, createRoom, expirePending, playCard, roomView, startGame, submitAction, type CardInstance, type RoomInternal } from "./game.js";

const card = (type: CardInstance["type"], instanceId = crypto.randomUUID()): CardInstance => ({ type, instanceId });

function playingRoom(playerCount = 3): RoomInternal {
  const room = createRoom("ABC234", "ホスト", "socket-0");
  for (let index = 1; index < playerCount; index += 1) addPlayer(room, `プレイヤー${index + 1}`, `socket-${index}`);
  startGame(room, room.hostId, () => 0.4);
  room.turnIndex = 0;
  room.turnNumber = playerCount + 1;
  room.players.forEach((player) => { player.turnsCompleted = 1; });
  return room;
}

test("3〜8人のデッキが1人4枚かつ『ひみつ』1枚になる", () => {
  for (let count = 3; count <= 8; count += 1) {
    const deck = buildDeck(count, () => 0.5);
    assert.equal(deck.length, count * 4);
    assert.equal(deck.filter((item) => item.type === "secret").length, 1);
  }
});

test("8人開始時に全員へ4枚ずつ配る", () => {
  const room = playingRoom(8);
  assert.deepEqual(room.players.map((player) => player.hand.length), Array(8).fill(4));
});

test("こっそり交換で『ひみつ』が別プレイヤーへ移動する", () => {
  const room = playingRoom();
  const [actor, target, third] = room.players;
  actor.hand = [card("swap", "00000000-0000-4000-8000-000000000001"), card("secret", "00000000-0000-4000-8000-000000000002")];
  target.hand = [card("peek", "00000000-0000-4000-8000-000000000003")];
  third.hand = [card("deduce", "00000000-0000-4000-8000-000000000004")];
  playCard(room, actor.id, actor.hand[0].instanceId, () => 0);
  assert.equal(room.pending?.kind, "target");
  submitAction(room, actor.id, room.pending!.id, target.id, () => 0);
  assert.equal(actor.hand.some((item) => item.type === "secret"), false);
  assert.equal(target.hand.some((item) => item.type === "secret"), true);
});

test("みぬく正解時に即終了し、外れた場合は続行する", () => {
  const correct = playingRoom();
  correct.players[0].hand = [card("deduce")];
  correct.players[1].hand = [card("secret"), card("peek")];
  correct.players[2].hand = [card("swap")];
  playCard(correct, correct.players[0].id, correct.players[0].hand[0].instanceId);
  submitAction(correct, correct.players[0].id, correct.pending!.id, correct.players[1].id);
  assert.equal(correct.status, "finished");
  assert.equal(correct.result?.reason, "deduced");

  const wrong = playingRoom();
  wrong.players[0].hand = [card("deduce")];
  wrong.players[1].hand = [card("peek")];
  wrong.players[2].hand = [card("secret"), card("swap"), card("deduce")];
  playCard(wrong, wrong.players[0].id, wrong.players[0].hand[0].instanceId);
  submitAction(wrong, wrong.players[0].id, wrong.pending!.id, wrong.players[1].id);
  assert.equal(wrong.status, "playing");
  assert.equal(wrong.result, null);
});

test("使えるカードが尽きると最後の『ひみつ』保持者が勝つ", () => {
  const room = playingRoom();
  room.players[0].hand = [card("rumor")];
  room.players[1].hand = [card("secret")];
  room.players[2].hand = [];
  playCard(room, room.players[0].id, room.players[0].hand[0].instanceId);
  assert.equal(room.status, "finished");
  assert.equal(room.result?.reason, "escaped");
  assert.equal(room.result?.winnerId, room.players[1].id);
});

test("個別状態に他プレイヤーの手札内容を含めない", () => {
  const room = playingRoom();
  const view = roomView(room, room.players[0].id);
  assert.equal(view.players[1].handCount, 4);
  assert.equal("hand" in view.players[1], false);
  assert.equal(view.hand.length, 4);
});

test("ちらりとじっくり観察の情報は対象者だけへの通知になる", () => {
  const peekRoom = playingRoom();
  peekRoom.players[0].hand = [card("peek")];
  peekRoom.players[1].hand = [card("secret"), card("swap")];
  peekRoom.players[2].hand = [card("deduce")];
  playCard(peekRoom, peekRoom.players[0].id, peekRoom.players[0].hand[0].instanceId);
  const peekResult = submitAction(peekRoom, peekRoom.players[0].id, peekRoom.pending!.id, peekRoom.players[1].id, () => 0);
  assert.equal(peekResult.notices.length, 2);
  assert.equal(peekResult.notices[0].playerId, peekRoom.players[0].id);
  assert.deepEqual(peekResult.notices[0].cards, ["secret"]);
  assert.equal(peekResult.notices[1].playerId, peekRoom.players[1].id);
  assert.deepEqual(peekResult.notices[1].cards, []);

  const observeRoom = playingRoom();
  observeRoom.players[0].hand = [card("observe"), card("rumor")];
  observeRoom.players[1].hand = [card("secret"), card("swap")];
  observeRoom.players[2].hand = [card("deduce")];
  playCard(observeRoom, observeRoom.players[0].id, observeRoom.players[0].hand[0].instanceId);
  const observeResult = submitAction(observeRoom, observeRoom.players[0].id, observeRoom.pending!.id, observeRoom.players[1].id, () => 0);
  assert.equal(observeResult.notices.length, 2);
  assert.deepEqual(observeResult.notices[0].cards, ["secret", "swap"]);
  assert.deepEqual(observeResult.notices[1].cards, ["rumor"]);
});

test("おすそわけで双方が選んだカードを交換できる", () => {
  const room = playingRoom();
  room.players[0].hand = [card("share"), card("secret")];
  room.players[1].hand = [card("peek")];
  room.players[2].hand = [card("deduce")];
  const secretId = room.players[0].hand[1].instanceId;
  const peekId = room.players[1].hand[0].instanceId;
  playCard(room, room.players[0].id, room.players[0].hand[0].instanceId);
  submitAction(room, room.players[0].id, room.pending!.id, room.players[1].id);
  submitAction(room, room.players[0].id, room.pending!.id, secretId);
  submitAction(room, room.players[1].id, room.pending!.id, peekId);
  assert.equal(room.players[1].hand.some((item) => item.type === "secret"), true);
  assert.equal(room.players[0].hand.some((item) => item.type === "peek"), true);
});

test("ぐるっと回すで全員の選択後に左どなりへ同時移動する", () => {
  const room = playingRoom();
  room.players[0].hand = [card("rotate"), card("secret")];
  room.players[1].hand = [card("peek")];
  room.players[2].hand = [card("deduce")];
  const ids = room.players.map((player) => player.hand.at(-1)!.instanceId);
  playCard(room, room.players[0].id, room.players[0].hand[0].instanceId);
  for (let index = 0; index < room.players.length; index += 1) {
    submitAction(room, room.players[index].id, room.pending!.id, ids[index]);
  }
  assert.equal(room.players[1].hand.some((item) => item.type === "secret"), true);
  assert.equal(room.players[2].hand.some((item) => item.type === "peek"), true);
  assert.equal(room.players[0].hand.some((item) => item.type === "deduce"), true);
});

test("うわさは必ず現在のひみつ保持者を候補に含める", () => {
  const room = playingRoom(5);
  room.players.forEach((player) => { player.hand = [card("peek")]; });
  room.players[0].hand = [card("rumor")];
  room.players[3].hand.push(card("secret"));
  playCard(room, room.players[0].id, room.players[0].hand[0].instanceId, () => 0.3);
  assert.equal(room.logs.some((log) => log.text.includes("うわさの候補") && log.text.includes(room.players[3].name)), true);
});

test("おとり中のプレイヤーはみぬくの候補から除外される", () => {
  const room = playingRoom();
  room.players[0].hand = [card("decoy")];
  room.players[1].hand = [card("deduce")];
  room.players[2].hand = [card("secret"), card("peek")];
  playCard(room, room.players[0].id, room.players[0].hand[0].instanceId);
  submitAction(room, room.players[0].id, room.pending!.id, room.players[2].id);
  playCard(room, room.players[1].id, room.players[1].hand[0].instanceId);
  assert.equal(room.pending?.kind, "target");
  if (room.pending?.kind === "target") assert.equal(room.pending.allowedTargetIds.includes(room.players[2].id), false);
});

test("もう一回は同じプレイヤーの番を続けるが連続使用できない", () => {
  const room = playingRoom();
  room.players[0].hand = [card("again"), card("again"), card("peek")];
  room.players[1].hand = [card("secret"), card("swap")];
  room.players[2].hand = [card("deduce")];
  playCard(room, room.players[0].id, room.players[0].hand[0].instanceId);
  assert.equal(room.players[room.turnIndex].id, room.players[0].id);
  assert.throws(() => playCard(room, room.players[0].id, room.players[0].hand.find((item) => item.type === "again")!.instanceId), /連続/);
});

test("大混乱は各プレイヤーの枚数とひみつ1枚を維持する", () => {
  const room = playingRoom(4);
  room.players[0].hand = [card("chaos"), card("secret"), card("peek")];
  room.players[1].hand = [card("swap"), card("share")];
  room.players[2].hand = [card("deduce")];
  room.players[3].hand = [card("rumor"), card("again")];
  const before = room.players.map((player) => player.hand.length);
  playCard(room, room.players[0].id, room.players[0].hand[0].instanceId, () => 0.8);
  assert.deepEqual(room.players.map((player) => player.hand.length), [before[0] - 1, ...before.slice(1)]);
  assert.equal(room.players.flatMap((player) => player.hand).filter((item) => item.type === "secret").length, 1);
});

test("対象選択を戻るとカード・捨て札・ターン・ログが一切変わらない", () => {
  for (const type of ["deduce", "peek", "swap", "share", "decoy", "observe"] as const) {
    const room = playingRoom();
    room.players[0].hand = [card(type), card("rumor")];
    room.players[1].hand = [card("secret"), card("peek")];
    room.players[2].hand = [card("swap")];
    const before = {
      hand: room.players[0].hand.map((item) => item.instanceId),
      discard: [...room.discard],
      turnNumber: room.turnNumber,
      logs: room.logs.map((log) => log.text),
    };
    playCard(room, room.players[0].id, room.players[0].hand[0].instanceId);
    assert.equal(room.pending?.kind, "target");
    cancelAction(room, room.players[0].id, room.pending!.id);
    assert.deepEqual(room.players[0].hand.map((item) => item.instanceId), before.hand);
    assert.deepEqual(room.discard, before.discard);
    assert.equal(room.turnNumber, before.turnNumber);
    assert.deepEqual(room.logs.map((log) => log.text), before.logs);
  }
});

test("キャンセルは本人の最新の対象選択だけに許可される", () => {
  const room = playingRoom();
  room.players[0].hand = [card("peek"), card("rumor")];
  room.players[1].hand = [card("secret")];
  room.players[2].hand = [card("swap")];
  playCard(room, room.players[0].id, room.players[0].hand[0].instanceId);
  const pendingId = room.pending!.id;
  assert.throws(() => cancelAction(room, room.players[1].id, pendingId), /キャンセル/);
  cancelAction(room, room.players[0].id, pendingId);
  assert.throws(() => cancelAction(room, room.players[0].id, pendingId), /終了/);
});

test("3〜8人で席番号・現在・次の順番が一意に表示される", () => {
  for (let count = 3; count <= 8; count += 1) {
    const room = playingRoom(count);
    const view = roomView(room, room.players[0].id);
    assert.deepEqual(view.players.map((player) => player.seat), Array.from({ length: count }, (_, index) => index + 1));
    assert.equal(view.players.filter((player) => player.isTurn).length, 1);
    assert.equal(view.nextPlayerId, room.players[1].id);
    assert.equal(view.turnDirection, "clockwise");
  }
});

test("全カード定義に一覧・手札・カットイン用の文言がある", () => {
  for (const type of CARD_TYPES) {
    const definition = CARD_DEFINITIONS[type];
    assert.ok(definition.category);
    assert.ok(definition.shortDescription.length >= 8);
    assert.ok(definition.description.length >= 20);
    assert.ok(definition.cutInText.length >= 5);
    assert.ok(definition.art.startsWith("/assets/"));
  }
});

test("非公開カードの公開演出とログに対象者名を含めない", () => {
  const room = playingRoom();
  const [actor, target] = room.players;
  actor.hand = [card("peek"), card("rumor")];
  target.hand = [card("secret")];
  room.players[2].hand = [card("swap")];
  const logCount = room.logs.length;
  playCard(room, actor.id, actor.hand[0].instanceId);
  const outcome = submitAction(room, actor.id, room.pending!.id, target.id, () => 0);
  assert.equal(outcome.effects[0].targetPublic, false);
  assert.equal(outcome.effects[0].targetName, undefined);
  assert.equal(room.logs.slice(logCount).some((log) => log.text.includes(target.name)), false);
});

test("みぬくは最初の1巡中に使えず、最後の1枚が外れると持ち主が勝つ", () => {
  const early = playingRoom();
  early.players[2].turnsCompleted = 0;
  early.players[0].hand = [card("deduce")];
  assert.throws(() => playCard(early, early.players[0].id, early.players[0].hand[0].instanceId), /全員が1回/);

  const last = playingRoom();
  last.players[0].hand = [card("deduce")];
  last.players[1].hand = [card("peek")];
  last.players[2].hand = [card("secret"), card("swap")];
  playCard(last, last.players[0].id, last.players[0].hand[0].instanceId);
  submitAction(last, last.players[0].id, last.pending!.id, last.players[1].id);
  assert.equal(last.status, "finished");
  assert.equal(last.result?.winnerId, last.players[2].id);
});

test("おとり使用者の手札が尽きても席を一周した時点で保護が切れる", () => {
  const room = playingRoom();
  room.players[0].hand = [card("decoy")];
  room.players[1].hand = [card("rumor"), card("peek")];
  room.players[2].hand = [card("secret"), card("rumor")];
  playCard(room, room.players[0].id, room.players[0].hand[0].instanceId);
  submitAction(room, room.players[0].id, room.pending!.id, room.players[2].id);
  assert.equal(room.players[2].protected, true);
  playCard(room, room.players[1].id, room.players[1].hand.find((item) => item.type === "rumor")!.instanceId);
  playCard(room, room.players[2].id, room.players[2].hand.find((item) => item.type === "rumor")!.instanceId);
  assert.equal(room.players[2].protected, false);
});

test("成立する対象がいないカードは消費しない", () => {
  const room = playingRoom();
  room.players[0].hand = [card("swap")];
  room.players[1].hand = [card("secret")];
  room.players[2].hand = [];
  const instanceId = room.players[0].hand[0].instanceId;
  assert.throws(() => playCard(room, room.players[0].id, instanceId), /対象がいない/);
  assert.equal(room.players[0].hand[0].instanceId, instanceId);
  assert.equal(room.discard.length, 0);
});

test("pending期限で対象選択は取消、全員選択は自動完了する", () => {
  const targetRoom = playingRoom();
  targetRoom.players[0].hand = [card("peek"), card("rumor")];
  targetRoom.players[1].hand = [card("secret")];
  targetRoom.players[2].hand = [card("swap")];
  const peekId = targetRoom.players[0].hand[0].instanceId;
  playCard(targetRoom, targetRoom.players[0].id, peekId);
  expirePending(targetRoom);
  assert.equal(targetRoom.pending, null);
  assert.equal(targetRoom.players[0].hand.some((item) => item.instanceId === peekId), true);

  const rotateRoom = playingRoom();
  rotateRoom.players[0].hand = [card("rotate"), card("secret")];
  rotateRoom.players[1].hand = [card("peek")];
  rotateRoom.players[2].hand = [card("deduce")];
  playCard(rotateRoom, rotateRoom.players[0].id, rotateRoom.players[0].hand[0].instanceId);
  expirePending(rotateRoom, () => 0);
  assert.equal(rotateRoom.pending, null);
  assert.equal(rotateRoom.players[1].hand.some((item) => item.type === "secret"), true);
});
