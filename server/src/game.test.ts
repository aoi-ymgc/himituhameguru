import assert from "node:assert/strict";
import test from "node:test";
import { CARD_DEFINITIONS, CARD_TYPES } from "../../shared/cards.js";
import { addPlayer, buildDeck, cancelAction, createRoom, expirePending, playCard, roomView, startGame, submitAction, submitIncident, type CardInstance, type RoomInternal } from "./game.js";

const card = (type: CardInstance["type"], instanceId = crypto.randomUUID()): CardInstance => ({ type, instanceId });

function playingRoom(playerCount = 3): RoomInternal {
  const room = createRoom("ABC234", "ホスト", "socket-0");
  for (let index = 1; index < playerCount; index += 1) addPlayer(room, `プレイヤー${index + 1}`, `socket-${index}`);
  startGame(room, room.hostId, () => 0.4);
  submitIncident(room, room.firstFinderId!, "テスト事件", () => 0.4);
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

test("手札のおとりはみぬくを自動で防ぎ、双方を1枚ずつ捨てる", () => {
  const room = playingRoom();
  room.players[0].hand = [card("deduce")];
  room.players[1].hand = [card("secret"), card("decoy"), card("decoy")];
  room.players[2].hand = [card("deduce")];
  playCard(room, room.players[0].id, room.players[0].hand[0].instanceId);
  const outcome = submitAction(room, room.players[0].id, room.pending!.id, room.players[1].id);
  assert.equal(room.status, "playing");
  assert.equal(room.players[1].hand.filter((item) => item.type === "decoy").length, 1);
  assert.deepEqual(room.discard.slice(-2), ["deduce", "decoy"]);
  assert.equal(outcome.effects.some((effect) => effect.card === "decoy"), true);
});

test("手もどしは自分が使った通常カードを1枚だけ回収する", () => {
  const room = playingRoom();
  room.players[0].hand = [card("peek"), card("again")];
  room.players[1].hand = [card("secret"), card("rumor")];
  room.players[2].hand = [card("deduce")];
  playCard(room, room.players[0].id, room.players[0].hand[0].instanceId);
  submitAction(room, room.players[0].id, room.pending!.id, room.players[1].id);
  room.turnIndex = 0;
  const again = room.players[0].hand.find((item) => item.type === "again")!;
  playCard(room, room.players[0].id, again.instanceId);
  assert.equal(room.pending?.kind, "recall");
  const recallId = room.pending?.kind === "recall" ? room.pending.allowedRecordIds[0] : "";
  submitAction(room, room.players[0].id, room.pending!.id, recallId);
  assert.equal(room.players[0].hand.some((item) => item.type === "peek"), true);
  assert.equal(room.discard.includes("peek"), false);
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
  for (const type of ["deduce", "peek", "swap", "share", "observe", "footprint"] as const) {
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
  playCard(early, early.players[0].id, early.players[0].hand[0].instanceId);
  assert.equal(early.pending?.kind, "no-effect");
  assert.match(roomView(early, early.players[0].id).pending?.prompt ?? "", /全員が1回/);

  const last = playingRoom();
  last.players[0].hand = [card("deduce")];
  last.players[1].hand = [card("peek")];
  last.players[2].hand = [card("secret"), card("swap")];
  playCard(last, last.players[0].id, last.players[0].hand[0].instanceId);
  submitAction(last, last.players[0].id, last.pending!.id, last.players[1].id);
  assert.equal(last.status, "finished");
  assert.equal(last.result?.winnerId, last.players[2].id);
});

test("おとりは自分の番に効果なしで捨てられる", () => {
  const room = playingRoom();
  room.players[0].hand = [card("decoy")];
  room.players[1].hand = [card("secret"), card("peek")];
  room.players[2].hand = [card("deduce")];
  playCard(room, room.players[0].id, room.players[0].hand[0].instanceId);
  assert.equal(room.pending?.kind, "no-effect");
  submitAction(room, room.players[0].id, room.pending!.id, "confirm");
  assert.equal(room.players[0].hand.length, 0);
  assert.equal(room.discard.at(-1), "decoy");
});

test("成立する対象がいない最後のおすそわけは確認後に効果なしで捨てられる", () => {
  const room = playingRoom();
  room.players[0].hand = [card("share")];
  room.players[1].hand = [card("secret")];
  room.players[2].hand = [card("deduce")];
  const instanceId = room.players[0].hand[0].instanceId;
  playCard(room, room.players[0].id, instanceId);
  assert.equal(room.pending?.kind, "no-effect");
  assert.equal(room.players[0].hand[0].instanceId, instanceId);
  submitAction(room, room.players[0].id, room.pending!.id, "confirm");
  assert.equal(room.players[0].hand.length, 0);
  assert.equal(room.discard.at(-1), "share");
  assert.equal(room.players[room.turnIndex].id, room.players[2].id);
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

test("なかまは公開状態になり、ひみつ側の逃げ切りで共同勝利する", () => {
  const room = playingRoom(5);
  const [ally, holder] = room.players;
  ally.hand = [card("ally")];
  holder.hand = [card("secret")];
  room.players.slice(2).forEach((player) => { player.hand = []; });
  playCard(room, ally.id, ally.hand[0].instanceId);
  assert.equal(ally.isAlly, true);
  assert.equal(room.status, "finished");
  assert.equal(room.result?.winningSide, "secret");
  assert.equal(room.result?.winners.some((winner) => winner.id === ally.id), true);
  assert.equal(room.result?.winners.some((winner) => winner.id === holder.id), true);
});

test("なかま自身がひみつを持つ場合も勝者は重複しない", () => {
  const room = playingRoom(5);
  const ally = room.players[0];
  ally.hand = [card("ally"), card("secret")];
  room.players.slice(1).forEach((player) => { player.hand = []; });
  playCard(room, ally.id, ally.hand[0].instanceId);
  assert.equal(room.result?.winners.filter((winner) => winner.id === ally.id).length, 1);
  assert.equal(room.result?.roles.secretHolder.id, ally.id);
});

test("なかまの『みぬく』は勝敗を決めず本人だけへ結果を知らせる", () => {
  const room = playingRoom(5);
  const [ally, holder, third] = room.players;
  ally.isAlly = true;
  ally.hand = [card("deduce")];
  holder.hand = [card("secret"), card("peek")];
  third.hand = [card("deduce")];
  room.players.slice(3).forEach((player) => { player.hand = [card("rumor")]; });
  playCard(room, ally.id, ally.hand[0].instanceId);
  const outcome = submitAction(room, ally.id, room.pending!.id, holder.id);
  assert.equal(room.status, "playing");
  assert.equal(outcome.notices.length, 1);
  assert.equal(outcome.notices[0].playerId, ally.id);
  assert.match(outcome.notices[0].message ?? "", /保持者/);
});

test("事件発表前は配札せず、発見者の発表後にその人から始まる", () => {
  const room = createRoom("ABC234", "ホスト", "socket-0");
  addPlayer(room, "二人目", "socket-1");
  addPlayer(room, "三人目", "socket-2");
  startGame(room, room.hostId, () => 0.6);
  const finderId = room.firstFinderId!;
  assert.equal(room.status, "incident");
  assert.equal(room.players.every((player) => player.hand.length === 0), true);
  assert.throws(() => submitIncident(room, room.players.find((player) => player.id !== finderId)!.id, "横取り"), /発見者/);
  submitIncident(room, finderId, "青いペンが消えた", () => 0.3);
  assert.equal(room.status, "playing");
  assert.equal(room.players[room.turnIndex].id, finderId);
  assert.equal(room.players.every((player) => player.hand.length === 4), true);
});

test("再戦では別の発見者を選び、なかま状態をリセットする", () => {
  const room = playingRoom(5);
  const previous = room.firstFinderId!;
  room.players[0].isAlly = true;
  room.status = "finished";
  startGame(room, room.hostId, () => 0);
  assert.notEqual(room.firstFinderId, previous);
  assert.equal(room.players.every((player) => !player.isAlly), true);
});

test("効果が成立するカードを任意に空打ちすることはできない", () => {
  const room = playingRoom();
  room.players[0].hand = [card("peek")];
  room.players[1].hand = [card("secret"), card("rumor")];
  room.players[2].hand = [card("deduce")];
  playCard(room, room.players[0].id, room.players[0].hand[0].instanceId);
  assert.equal(room.pending?.kind, "target");
  assert.throws(() => submitAction(room, room.players[0].id, room.pending!.id, "confirm"), /選択/);
});

test("3〜8人の全構成が進行不能にならず最後まで完了する", () => {
  for (let count = 3; count <= 8; count += 1) {
    const room = playingRoom(count);
    let steps = 0;
    while (room.status === "playing" && steps < count * 20) {
      steps += 1;
      if (!room.pending) {
        const actor = room.players[room.turnIndex];
        const playable = actor.hand.find((item) => item.type !== "secret");
        if (!playable) throw new Error(`${count}人: 手番に使えるカードがありません`);
        playCard(room, actor.id, playable.instanceId, () => 0.2);
        continue;
      }
      const pending = room.pending;
      if (pending.kind === "no-effect") {
        submitAction(room, pending.actorId, pending.id, "confirm", () => 0.2);
      } else if (pending.kind === "target") {
        submitAction(room, pending.actorId, pending.id, pending.allowedTargetIds[0], () => 0.2);
      } else if (pending.kind === "recall") {
        submitAction(room, pending.actorId, pending.id, pending.allowedRecordIds[0], () => 0.2);
      } else if (pending.kind === "share-actor-card") {
        submitAction(room, pending.actorId, pending.id, room.players.find((player) => player.id === pending.actorId)!.hand[0].instanceId, () => 0.2);
      } else if (pending.kind === "share-target-card") {
        submitAction(room, pending.targetId, pending.id, room.players.find((player) => player.id === pending.targetId)!.hand[0].instanceId, () => 0.2);
      } else if (pending.kind === "rotate") {
        for (const player of room.players) {
          const current = room.pending;
          if (!current || current.kind !== "rotate") break;
          if (current.selections[player.id] === undefined) submitAction(room, player.id, current.id, player.hand[0].instanceId, () => 0.2);
        }
      }
    }
    assert.equal(room.status, "finished", `${count}人ゲームが完了しませんでした`);
  }
});
