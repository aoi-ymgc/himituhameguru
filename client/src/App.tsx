import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import QRCode from "qrcode";
import { CARD_CATEGORY_LABELS, CARD_DEFINITIONS, CARD_TYPES, START_CARD_DEFINITION, type CardCategory, type CardType, type CharacterId } from "../../shared/cards";
import { INCIDENT_TEMPLATES } from "../../shared/incidents";
import { GAME_TITLE, type Ack, type CardEffectEvent, type CardView, type GameSettings, type RoomView } from "../../shared/types";
import { socket } from "./main";

interface SessionData { code: string; playerId: string; token: string }
interface Notice { id: string; playerId: string; title: string; message?: string; cards: CardType[]; durationMs: number }

const CHARACTER_NAMES: Record<CharacterId, string> = {
  sheep: "ふわっとひつじ",
  hamster: "ほっぺハムくん",
  tanuki: "ぶっきらたぬきくん",
  wolf: "ぶっきらおおかみくん",
  penguin: "コウハイペンギンくん",
};

const CHARACTER_ART: Record<CharacterId, string> = {
  sheep: "/assets/characters/icons/sheep.png?v=visual3",
  hamster: "/assets/characters/icons/hamster.png?v=visual3",
  tanuki: "/assets/characters/icons/tanuki.png?v=visual3",
  wolf: "/assets/characters/icons/wolf.png?v=visual3",
  penguin: "/assets/characters/icons/penguin.png?v=visual3",
};

const CUT_IN_SYMBOLS: Record<CardType, string> = {
  secret: "?",
  deduce: "!",
  peek: "◉",
  swap: "⇄",
  share: "◇",
  rotate: "↻",
  rumor: "…",
  decoy: "◆",
  observe: "◎",
  again: "↶",
  chaos: "✦",
  ally: "◆",
  footprint: "•••",
};

const roomCodeFromPath = () => window.location.pathname.match(/^\/room\/([A-Z2-9]{6})/i)?.[1]?.toUpperCase() ?? "";
const sessionKey = (code: string) => `himitsu-session:${code}`;
const withSan = (name: string) => name.endsWith("さん") ? name : `${name}さん`;

export default function App() {
  const [room, setRoom] = useState<RoomView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [entry, setEntry] = useState<"home" | "create" | "join">(roomCodeFromPath() ? "join" : "home");
  const [howTo, setHowTo] = useState(false);
  const [selectedCard, setSelectedCard] = useState<CardView | null>(null);
  const [privateNotice, setPrivateNotice] = useState<Notice | null>(null);
  const [noticeQueue, setNoticeQueue] = useState<Notice[]>([]);
  const [cutIn, setCutIn] = useState<CardEffectEvent | null>(null);
  const [effectQueue, setEffectQueue] = useState<CardEffectEvent[]>([]);
  const [soundOn, setSoundOn] = useState(() => localStorage.getItem("himitsu-sound") !== "off");
  const previousTurn = useRef<string | null>(null);
  const roomRef = useRef<RoomView | null>(null);
  const seenNoticeIds = useRef(new Set<string>());

  useEffect(() => {
    const reconnect = () => {
      const code = roomCodeFromPath();
      if (!code) return;
      const raw = localStorage.getItem(sessionKey(code));
      if (!raw) return;
      try {
        const saved = JSON.parse(raw) as SessionData;
        socket.emit("reconnectRoom", { code, token: saved.token }, (ack: Ack<SessionData>) => {
          if (!ack.ok) setError(ack.error ?? "再接続できませんでした");
        });
      } catch {
        localStorage.removeItem(sessionKey(code));
      }
    };
    const onState = (next: RoomView) => {
      setRoom(next);
      roomRef.current = next;
      setBusy(false);
      setError("");
      const active = next.players.find((player) => player.isTurn)?.id ?? null;
      if (active && active !== previousTurn.current && active === next.viewerId) {
        signal(soundOn, "turn");
      }
      previousTurn.current = active;
    };
    const onNotice = (notice: Notice) => {
      if (seenNoticeIds.current.has(notice.id)) return;
      seenNoticeIds.current.add(notice.id);
      setNoticeQueue((queue) => [...queue, notice]);
    };
    const onEffect = (effect: CardEffectEvent) => {
      setEffectQueue((queue) => [...queue, effect]);
    };
    const onKicked = (message: string) => {
      const code = roomCodeFromPath();
      if (code) localStorage.removeItem(sessionKey(code));
      setRoom(null);
      setEntry("home");
      setError(message);
      window.history.replaceState({}, "", "/");
    };
    const onDisconnect = () => setBusy(false);
    socket.on("connect", reconnect);
    socket.on("roomState", onState);
    socket.on("privateNotice", onNotice);
    socket.on("cardEffect", onEffect);
    socket.on("kicked", onKicked);
    socket.on("disconnect", onDisconnect);
    if (socket.connected) reconnect();
    return () => {
      socket.off("connect", reconnect);
      socket.off("roomState", onState);
      socket.off("privateNotice", onNotice);
      socket.off("cardEffect", onEffect);
      socket.off("kicked", onKicked);
      socket.off("disconnect", onDisconnect);
    };
  }, [soundOn]);

  useEffect(() => {
    if (cutIn || effectQueue.length === 0) return;
    const next = effectQueue[0];
    setEffectQueue((queue) => queue.slice(1));
    setCutIn(next);
  }, [cutIn, effectQueue]);

  useEffect(() => {
    if (!cutIn) return;
    signal(soundOn, "reveal");
    const duration = roomRef.current?.settings.animationSpeed === "fast" ? 1100 : 1850;
    const timer = window.setTimeout(() => setCutIn(null), duration);
    return () => window.clearTimeout(timer);
  }, [cutIn, soundOn]);

  useEffect(() => {
    if (cutIn || privateNotice || noticeQueue.length === 0) return;
    const next = noticeQueue[0];
    setNoticeQueue((queue) => queue.slice(1));
    setPrivateNotice(next);
    signal(soundOn, "reveal");
  }, [cutIn, privateNotice, noticeQueue, soundOn]);

  useEffect(() => {
    if (!privateNotice) return;
    const notice = privateNotice;
    const timer = window.setTimeout(() => {
      socket.emit("ackNotice", { noticeId: notice.id }, () => undefined);
      setPrivateNotice((current) => current === notice ? null : current);
    }, notice.durationMs);
    return () => window.clearTimeout(timer);
  }, [privateNotice]);

  const invoke = <T,>(event: string, payload: unknown = {}): Promise<T | undefined> => {
    setBusy(true);
    setError("");
    return new Promise((resolve) => {
      socket.timeout(8_000).emit(event, payload, (timeoutError: Error | null, ack?: Ack<T>) => {
        setBusy(false);
        if (timeoutError || !ack) {
          setError("通信に時間がかかっています。接続を確認して、もう一度お試しください");
          resolve(undefined);
          return;
        }
        if (!ack.ok) {
          setError(ack.error ?? "処理に失敗しました");
          resolve(undefined);
          return;
        }
        resolve(ack.data);
      });
    });
  };

  const enterRoom = async (event: "createRoom" | "joinRoom", payload: unknown) => {
    const data = await invoke<SessionData>(event, payload);
    if (!data) return;
    localStorage.setItem(sessionKey(data.code), JSON.stringify(data));
    window.history.pushState({}, "", `/room/${data.code}`);
  };

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    localStorage.setItem("himitsu-sound", next ? "on" : "off");
    if (next) signal(true, "click");
  };

  if (!room) {
    return (
      <Shell soundOn={soundOn} onSound={toggleSound}>
        <EntryScreen mode={entry} setMode={setEntry} onEnter={enterRoom} busy={busy} error={error} onHowTo={() => setHowTo(true)} />
        {howTo && <HowToModal onClose={() => setHowTo(false)} />}
      </Shell>
    );
  }

  return (
    <Shell soundOn={soundOn} onSound={toggleSound}>
      {error && <div className="error-banner" role="alert">{error}<button onClick={() => setError("")}>閉じる</button></div>}
      {room.status === "lobby" && <Lobby room={room} invoke={invoke} busy={busy} onHowTo={() => setHowTo(true)} />}
      {room.status === "incident" && <IncidentAnnouncement room={room} invoke={invoke} busy={busy} />}
      {room.status === "playing" && <Game room={room} invoke={invoke} selectedCard={selectedCard} setSelectedCard={setSelectedCard} busy={busy || Boolean(cutIn)} onHowTo={() => setHowTo(true)} />}
      {room.status === "finished" && <Game room={room} invoke={invoke} selectedCard={null} setSelectedCard={setSelectedCard} busy={busy || Boolean(cutIn)} onHowTo={() => setHowTo(true)} />}
      {howTo && <HowToModal onClose={() => setHowTo(false)} />}
      {privateNotice && <PrivateNotice notice={privateNotice} onClose={() => { socket.emit("ackNotice", { noticeId: privateNotice.id }, () => undefined); setPrivateNotice(null); }} />}
      {cutIn && <CardCutIn effect={cutIn} fast={room.settings.animationSpeed === "fast"} />}
    </Shell>
  );
}

function Shell({ children, soundOn, onSound }: { children: ReactNode; soundOn: boolean; onSound: () => void }) {
  return (
    <div className="app-shell">
      <header className="site-header">
        <button className="brand" onClick={() => window.location.assign("/")} aria-label="トップへ戻る">
          <span className="brand-mark"><img src="/assets/characters/icons/sheep.png?v=visual3" alt="" /></span><span>{GAME_TITLE}</span>
        </button>
        <button className="icon-button" onClick={onSound} aria-label={soundOn ? "音をオフ" : "音をオン"}>音 {soundOn ? "ON" : "OFF"}</button>
      </header>
      <main>{children}</main>
    </div>
  );
}

function EntryScreen({ mode, setMode, onEnter, busy, error, onHowTo }: {
  mode: "home" | "create" | "join";
  setMode: (mode: "home" | "create" | "join") => void;
  onEnter: (event: "createRoom" | "joinRoom", payload: unknown) => void;
  busy: boolean;
  error: string;
  onHowTo: () => void;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState(roomCodeFromPath());
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (mode === "create") onEnter("createRoom", { name });
    if (mode === "join") onEnter("joinRoom", { code: code.toUpperCase(), name });
  };

  return (
    <section className="entry-layout">
      <div className="hero-copy">
        <span className="eyebrow">小さな事件から始まる、オンライン推理カードゲーム</span>
        <h1>ひみつは、<br /><em>手から手へ。</em></h1>
        <p>ちらりとのぞいて、こっそり交換。うわさとおとりをかいくぐり、たった1枚の「ひみつ」を追いかけよう。持ち主をみぬくのは、だれ？</p>
        <div className="hero-facts"><span>3〜8人で遊べる</span><span>登録なしですぐ参加</span><span>1ゲーム約10分</span></div>
      </div>
      <div className="hero-stage">
        <img className="hero-key-visual" src="/assets/pages/top/hero.png?v=visual3" alt="5人のキャラクターがひみつカードをめぐらせている様子" />
        <div className="entry-card">
          {mode === "home" ? (
            <>
              <Button onClick={() => setMode("create")}>部屋を作ってはじめる</Button>
              <Button variant="secondary" onClick={() => setMode("join")}>ルームコードで参加</Button>
              <Button variant="ghost" onClick={onHowTo}>遊び方とカードを見る</Button>
            </>
          ) : (
            <form onSubmit={submit}>
              <button className="back-link" type="button" onClick={() => setMode("home")}>← 戻る</button>
              <h2>{mode === "create" ? "新しい部屋を作る" : "ひみつの部屋に参加"}</h2>
              {mode === "join" && <Field label="6桁のルームコード" value={code} onChange={(value) => setCode(value.replace(/[^a-z0-9]/gi, "").slice(0, 6).toUpperCase())} placeholder="ABC123" autoFocus={!code} />}
              <Field label="プレイヤー名" value={name} onChange={setName} placeholder="おなまえ" autoFocus={Boolean(code) || mode === "create"} maxLength={16} />
              {error && <p className="form-error" role="alert">{error}</p>}
              <Button type="submit" disabled={busy || !name.trim() || (mode === "join" && code.length !== 6)}>{busy ? "接続中…" : mode === "create" ? "この部屋を作る" : "この部屋に参加"}</Button>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}

function Lobby({ room, invoke, busy, onHowTo }: { room: RoomView; invoke: <T>(event: string, payload?: unknown) => Promise<T | undefined>; busy: boolean; onHowTo: () => void }) {
  const isHost = room.viewerId === room.hostId;
  const inviteUrl = `${window.location.origin}/room/${room.code}`;
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  useEffect(() => { QRCode.toDataURL(inviteUrl, { width: 280, margin: 1, color: { dark: "#173b36", light: "#ffffff" } }).then(setQr); }, [inviteUrl]);
  const copy = async () => {
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  const update = (patch: Partial<GameSettings>) => invoke("updateSettings", patch);

  return (
    <section className="lobby-layout page-width">
      <div className="room-heading">
        <div><span className="eyebrow">待ち合わせ中</span><h1>みんなが揃うのを待っています</h1></div>
        <button className="text-button" onClick={onHowTo}>遊び方</button>
      </div>
      <div className="lobby-grid">
        <section className="panel invite-panel">
          <div className="invite-copy"><p className="panel-label">ルームコード</p><strong className="room-code">{room.code}</strong><p>このURLかQRコードを友だちに共有してください。</p><div className="button-row"><Button onClick={copy}>{copied ? "コピーしました！" : "招待URLをコピー"}</Button><Button variant="secondary" onClick={() => setShowQr(true)}>QRコード</Button></div></div>
          <img className="lobby-visual" src="/assets/pages/lobby/waiting.png?v=visual3" alt="ひつじが友だちを待っている様子" />
        </section>
        <section className="panel members-panel">
          <div className="panel-title"><h2>参加者</h2><span>{room.players.length} / {room.settings.maxPlayers}人</span></div>
          <div className="member-list">
            {room.players.map((player) => (
              <div className="member" key={player.id}>
                <Avatar character={player.character} small />
                <div><strong>{player.name}</strong><span>{CHARACTER_NAMES[player.character]}</span></div>
                {player.isHost && <span className="host-badge">HOST</span>}
                {!player.connected && <span className="offline-badge">再接続待ち</span>}
                {isHost && !player.isHost && <button className="kick-button" onClick={() => invoke("kickPlayer", { playerId: player.id })}>退出</button>}
              </div>
            ))}
          </div>
        </section>
        {isHost && (
          <section className="panel settings-panel">
            <h2>ゲーム設定</h2>
            <label>最大人数<select value={room.settings.maxPlayers} onChange={(event) => update({ maxPlayers: Number(event.target.value) })}>{[3,4,5,6,7,8].map((n) => <option key={n} value={n}>{n}人</option>)}</select></label>
            <label>ターン時間<select value={room.settings.turnSeconds} onChange={(event) => update({ turnSeconds: Number(event.target.value) as GameSettings["turnSeconds"] })}><option value={0}>制限なし</option><option value={30}>30秒</option><option value={60}>60秒</option><option value={90}>90秒</option></select></label>
            <label>演出速度<select value={room.settings.animationSpeed} onChange={(event) => update({ animationSpeed: event.target.value as GameSettings["animationSpeed"] })}><option value="normal">普通</option><option value="fast">速い</option></select></label>
          </section>
        )}
      </div>
      <div className="sticky-action">
        {isHost ? <Button disabled={busy || room.players.length < 3} onClick={() => invoke("startGame")}>{room.players.length < 3 ? `あと${3 - room.players.length}人で開始` : "ゲームを開始"}</Button> : <p>ホストがゲームを開始するのを待っています…</p>}
      </div>
      {showQr && <Modal title="QRコードで招待" onClose={() => setShowQr(false)}><div className="qr-wrap">{qr && <img src={qr} alt={`${room.code}への招待QRコード`} />}<strong>{room.code}</strong><p>同じ部屋へ直接参加できます</p></div></Modal>}
    </section>
  );
}

function IncidentAnnouncement({ room, invoke, busy }: { room: RoomView; invoke: <T>(event: string, payload?: unknown) => Promise<T | undefined>; busy: boolean }) {
  const firstFinder = room.players.find((player) => player.id === room.firstFinderId)!;
  const canAnnounce = room.viewerId === firstFinder.id || (room.viewerId === room.hostId && !firstFinder.connected);
  const randomIncident = () => INCIDENT_TEMPLATES[Math.floor(Math.random() * INCIDENT_TEMPLATES.length)];
  const [title, setTitle] = useState(randomIncident);
  return (
    <section className="incident-layout page-width">
      <div className="incident-card panel">
        <div className="start-card-art"><img src={START_CARD_DEFINITION.art} alt="最初の発見者カード" /></div>
        <span className="eyebrow">ゲーム前の事件発表タイム</span>
        <h1>「{START_CARD_DEFINITION.name}」を<br />{withSan(firstFinder.name)}が受け取りました</h1>
        <p>{START_CARD_DEFINITION.description}</p>
        {canAnnounce ? (
          <div className="incident-form">
            <Field label="今回、起きた事件は？" value={title} onChange={setTitle} placeholder="例：冷蔵庫のプリンが消えた！" maxLength={80} />
            <div className="button-row"><Button variant="secondary" disabled={busy} onClick={() => setTitle(randomIncident())}>別のお題にする</Button><Button disabled={busy || !title.trim()} onClick={() => invoke("submitIncident", { title })}>この事件を発表して開始</Button></div>
            <small>自由に書き換えても、用意された{INCIDENT_TEMPLATES.length}個のお題から選んでも遊べます。</small>
          </div>
        ) : (
          <div className="incident-wait"><div className="waiting-dots"><i /><i /><i /></div><strong>{withSan(firstFinder.name)}が事件を考えています</strong><p>発表が終わると、同じ人のターンから始まります。</p></div>
        )}
      </div>
    </section>
  );
}

function Game({ room, invoke, selectedCard, setSelectedCard, busy, onHowTo }: {
  room: RoomView;
  invoke: <T>(event: string, payload?: unknown) => Promise<T | undefined>;
  selectedCard: CardView | null;
  setSelectedCard: (card: CardView | null) => void;
  busy: boolean;
  onHowTo: () => void;
}) {
  const me = room.players.find((player) => player.id === room.viewerId)!;
  const current = room.players.find((player) => player.isTurn);
  const canPlay = room.status === "playing" && me.isTurn && !room.pending && !busy;
  const meIndex = room.players.findIndex((player) => player.id === room.viewerId);
  const nextNeighbor = room.players[(meIndex + 1) % room.players.length];
  const previousNeighbor = room.players[(meIndex - 1 + room.players.length) % room.players.length];
  const next = room.players.find((player) => player.id === room.nextPlayerId);
  const [seconds, setSeconds] = useState<number | null>(null);
  useEffect(() => {
    if (!room.turnEndsAt) { setSeconds(null); return; }
    const tick = () => setSeconds(Math.max(0, Math.ceil((room.turnEndsAt! - Date.now()) / 1000)));
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [room.turnEndsAt]);

  return (
    <section className="game-layout">
      {room.incidentTitle && <div className="incident-ribbon"><span>今回の事件</span><strong>{room.incidentTitle}</strong></div>}
      {me.isAlly && <div className="ally-banner">あなたはひみつ側のなかまです</div>}
      <div className="turn-banner">
        <div><span>TURN {room.turnNumber} ・ 席順どおり</span><strong>{room.status === "finished" ? "ゲーム終了" : me.isTurn ? "あなたの番です" : `${withSan(current?.name ?? "")}の番`}</strong><small>{next ? `次は ${withSan(next.name)}` : ""}</small></div>
        <div className="turn-tools">{seconds !== null && <div className={`timer ${seconds <= 10 ? "timer-danger" : ""}`}>{seconds}</div>}<button onClick={onHowTo}>遊び方</button></div>
      </div>
      <div className="player-strip" aria-label="プレイヤー一覧">
        {room.players.map((player, index) => (<div className="order-item" key={player.id}>
          <div className={`player-chip ${player.isTurn ? "active" : ""} ${player.id === room.nextPlayerId ? "next" : ""}`}>
            <b className="seat-number">{player.seat}</b>
            <Avatar character={player.character} small />
            <div><strong>{player.name}{player.id === room.viewerId ? "（あなた）" : ""}</strong><span>手札 {player.handCount}枚 {player.isAlly ? "・ひみつ側" : ""}</span></div>
            {player.isTurn ? <em className="turn-label">現在</em> : player.id === room.nextPlayerId ? <em className="next-label">次</em> : null}
            {!player.connected && <i>OFF</i>}
          </div>
          {index < room.players.length - 1 && <span className="order-arrow" aria-hidden="true">→</span>}
        </div>))}
        <span className="order-loop" aria-label={`席${room.players.length}から席1へ戻る`}>↻ 席1</span>
      </div>
      <p className="order-hint">← 横にスワイプして全員の席順を確認 →</p>
      <div className="neighbor-guide page-width"><span>前の順番 <strong>{previousNeighbor?.name}</strong></span><b>あなた（席{me.seat}）</b><span>カード移動先・右どなり <strong>{nextNeighbor?.name}</strong> →</span></div>
      <div className="table-area page-width">
        <section className="played-card panel">
          <span className="panel-label">直前のカード</span>
          {room.discard.length ? <MiniCard type={room.discard.at(-1)!} /> : <div className="empty-table">最初のカードを待っています</div>}
        </section>
        <section className="game-log panel">
          <div className="panel-title"><h2>できごと</h2><span>秘密は表示されません</span></div>
          <div className="log-list" aria-live="polite">
            {[...room.logs].reverse().map((log, index) => <p key={log.id} className={index === 0 ? "latest" : ""}>{log.text}</p>)}
          </div>
        </section>
      </div>
      <section className="hand-area">
        <div className="hand-heading"><div><span className="panel-label">あなたの手札</span><strong>{canPlay ? "使うカードを選んでください" : room.pending ? "カードの処理中です" : "ほかの人の番です"}</strong></div><span>{room.hand.length}枚</span></div>
        <div className="hand-scroll">
          {room.hand.map((card) => <GameCard key={card.instanceId} card={card} disabled={!canPlay || card.type === "secret"} onClick={() => setSelectedCard(card)} />)}
          {room.hand.length === 0 && <div className="empty-hand">手札を使い切りました。みんなの推理を見守りましょう。</div>}
        </div>
      </section>
      {selectedCard && <CardDetail card={selectedCard} canUse={canPlay && selectedCard.type !== "secret"} busy={busy} onClose={() => setSelectedCard(null)} onUse={async () => { await invoke("playCard", { instanceId: selectedCard.instanceId }); setSelectedCard(null); signal(true, "click"); }} />}
      {room.pending && <PendingAction room={room} invoke={invoke} busy={busy} />}
      {room.result && <ResultModal room={room} invoke={invoke} busy={busy} />}
    </section>
  );
}

function PendingAction({ room, invoke, busy }: { room: RoomView; invoke: <T>(event: string, payload?: unknown) => Promise<T | undefined>; busy: boolean }) {
  const pending = room.pending!;
  const actionable = pending.kind !== "waiting";
  const cancel = pending.cancellable ? () => invoke("cancelAction", { pendingId: pending.id }) : undefined;
  const cardName = pending.card ? CARD_DEFINITIONS[pending.card].name : "カードの効果";
  const [remaining, setRemaining] = useState(() => pending.expiresAt ? Math.max(0, Math.ceil((pending.expiresAt - Date.now()) / 1000)) : null);
  useEffect(() => {
    if (!pending.expiresAt) return;
    const tick = () => setRemaining(Math.max(0, Math.ceil((pending.expiresAt! - Date.now()) / 1000)));
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [pending.expiresAt]);
  return (
    <Modal title={pending.kind === "no-effect" ? "現在、このカードの効果を使用できません" : actionable ? `${cardName}｜選択` : `${cardName}｜待機中`} lock={!pending.cancellable} onClose={cancel}>
      <div className="pending-action">
        {pending.card && <div className="pending-card-summary"><span className={`category-badge category-${CARD_DEFINITIONS[pending.card].category}`}>{CARD_CATEGORY_LABELS[CARD_DEFINITIONS[pending.card].category]}</span><strong>{CARD_DEFINITIONS[pending.card].shortDescription}</strong></div>}
        <p>{pending.prompt}</p>
        {remaining !== null && <small className="pending-time">あと{remaining}秒 {pending.cancellable ? "・期限で自動キャンセル" : "・未選択は自動で決定"}</small>}
        {pending.totalCount !== undefined && <div className="progress"><span style={{ width: `${((pending.selectedCount ?? 0) / pending.totalCount) * 100}%` }} /></div>}
        {actionable && <div className="option-grid">{pending.options.map((option) => {
          const type = option.meta as CardType | undefined;
          return <button key={option.id} disabled={busy} onClick={() => invoke("submitAction", { pendingId: pending.id, optionId: option.id })}>{type && <span className="option-card-dot" style={{ background: CARD_DEFINITIONS[type].accent }} />}{option.label}</button>;
        })}</div>}
        {pending.cancellable && <Button variant="ghost" disabled={busy} onClick={cancel}>{pending.kind === "no-effect" ? "戻る" : "戻る（カードは使いません）"}</Button>}
        {!actionable && <div className="waiting-dots"><i /><i /><i /></div>}
      </div>
    </Modal>
  );
}

function ResultModal({ room, invoke, busy }: { room: RoomView; invoke: <T>(event: string, payload?: unknown) => Promise<T | undefined>; busy: boolean }) {
  const result = room.result!;
  const isHost = room.viewerId === room.hostId;
  return (
    <Modal title="ゲーム終了" lock>
      <div className="result-content">
        <span className="result-mark">!</span>
        <p>{result.reason === "deduced" ? "ひみつを見ぬいた！" : "ひみつを守りきった！"}</p>
        <h2>{result.winningSide === "secret" ? "ひみつ側" : "推理側"}の勝ち</h2>
        <div className={`winning-side side-${result.winningSide}`}><span>勝者</span><strong>{result.winners.map((player) => withSan(player.name)).join("・")}</strong></div>
        <dl>
          <div><dt>最後のひみつ保持者</dt><dd>{withSan(result.roles.secretHolder.name)}</dd></div>
          <div><dt>ひみつ側のなかま</dt><dd>{result.roles.allies.length ? result.roles.allies.map((player) => withSan(player.name)).join("・") : "なし"}</dd></div>
          <div><dt>推理側</dt><dd>{result.roles.detectives.length ? result.roles.detectives.map((player) => withSan(player.name)).join("・") : "なし"}</dd></div>
          <div><dt>ゲーム時間</dt><dd>{formatDuration(result.durationSeconds)}</dd></div>
        </dl>
        {isHost ? <div className="result-actions"><Button disabled={busy} onClick={() => invoke("rematch")}>同じメンバーでもう一度</Button><Button variant="secondary" disabled={busy} onClick={() => invoke("returnToLobby")}>ロビーへ戻る</Button></div> : <p className="muted">ホストが次のゲームを選びます</p>}
        <Button variant="ghost" onClick={() => window.location.assign("/")}>トップへ戻る</Button>
      </div>
    </Modal>
  );
}

function PrivateNotice({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  return <Modal title="あなただけの情報" onClose={onClose}><div className="private-notice"><p>{notice.title}</p>{notice.message && <span>{notice.message}</span>}<div className="notice-cards">{notice.cards.map((type, index) => <MiniCard key={`${type}-${index}`} type={type} />)}</div><Button onClick={onClose}>確認しました</Button></div></Modal>;
}

function CardDetail({ card, canUse, busy, onClose, onUse }: { card: CardView; canUse: boolean; busy: boolean; onClose: () => void; onUse: () => void }) {
  const definition = CARD_DEFINITIONS[card.type];
  return <Modal title={definition.name} onClose={onClose}><div className="card-detail"><Art type={card.type} /><span className={`category-badge category-${definition.category}`}>{CARD_CATEGORY_LABELS[definition.category]}</span><p>{definition.description}</p><span className="character-credit">出演：{CHARACTER_NAMES[definition.character]}</span><Button disabled={!canUse || busy} onClick={onUse}>{card.type === "secret" ? "このカードは使えません" : canUse ? "このカードを使う" : "自分の番を待ってください"}</Button></div></Modal>;
}

function HowToModal({ onClose }: { onClose: () => void }) {
  const [category, setCategory] = useState<CardCategory | "all">("all");
  const [detail, setDetail] = useState<CardType | null>(null);
  const categories = Object.keys(CARD_CATEGORY_LABELS) as CardCategory[];
  const cards = CARD_TYPES.filter((type) => category === "all" || CARD_DEFINITIONS[type].category === category);
  return <Modal title="遊び方・カード一覧" onClose={onClose}><div className="howto">
    <div className="rule-lead"><img src="/assets/pages/help/guide.png?v=visual3" alt="ひつじがカードのめぐり方を案内している様子" /><p>たった1枚の「ひみつ」が、交換カードでみんなの手をめぐります。</p></div>
    <section><h3>ゲームの流れと勝ち方</h3><ol><li><strong>「みつけた！」の人が事件を発表</strong><span>自由入力かランダムのお題を発表し、その人からゲームを始めます。</span></li><li><strong>自分の番にカードを1枚使う</strong><span>情報を集め、交換で現在地を揺らします。</span></li><li><strong>「みぬく」で持ち主を指名</strong><span>当たれば推理側、使い切れば最後の保持者となかまが共同勝利です。</span></li></ol></section>
    <section><h3>席順と右どなり</h3><div className="howto-order"><b>席1</b><span>→</span><b>席2</b><span>→</span><b>席3</b><span>→</span><b>席1</b></div><p className="muted">ターンも「ぐるっと回す」の移動も、画面上の矢印どおりです。自分から見て右にいる次の順番の人へ進みます。</p></section>
    <section><h3>全{CARD_TYPES.length}種類のカード</h3><div className="category-filter"><button className={category === "all" ? "active" : ""} onClick={() => setCategory("all")}>すべて</button>{categories.map((item) => <button key={item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}>{CARD_CATEGORY_LABELS[item]}</button>)}</div><div className="card-catalog">{cards.map((type) => { const def = CARD_DEFINITIONS[type]; return <button key={type} onClick={() => setDetail(detail === type ? null : type)}><Art type={type} /><div><span className={`category-badge category-${def.category}`}>{CARD_CATEGORY_LABELS[def.category]}</span><strong>{def.name}</strong><small>{def.shortDescription}</small></div>{detail === type && <p>{def.description}</p>}</button>; })}</div></section>
    <p className="muted">カードの効果が成立しない場合だけ、確認後に効果なしで捨てて次へ進めます。「おとり」は手札にある間に自動発動し、自分の番では効果なしで捨てられます。対象選択は「戻る」で取り消せます。</p>
  </div></Modal>;
}

function GameCard({ card, disabled, onClick }: { card: CardView; disabled: boolean; onClick: () => void }) {
  const definition = CARD_DEFINITIONS[card.type];
  return <button className={`game-card category-${definition.category} ${disabled ? "disabled" : ""}`} onClick={onClick} style={{ "--card-accent": definition.accent } as CSSProperties}><span className="card-category-ribbon">{CARD_CATEGORY_LABELS[definition.category]}</span><Art type={card.type} /><span className="game-card-copy"><strong className="game-card-name">{definition.name}</strong><span className="game-card-hint">{definition.shortDescription}</span></span></button>;
}

function CardCutIn({ effect, fast }: { effect: CardEffectEvent; fast: boolean }) {
  const definition = CARD_DEFINITIONS[effect.card];
  const failed = effect.outcome === "deduce-failed";
  return <div className={`card-cut-in effect-${effect.card} category-${definition.category} ${failed ? "result-failure" : ""} ${fast ? "fast" : ""}`} style={{ "--effect-accent": definition.accent } as CSSProperties} role="status" aria-live="assertive"><div className="cut-in-speed" /><div className="cut-in-emblem" aria-hidden="true">{failed ? "×" : CUT_IN_SYMBOLS[effect.card]}</div><div className="cut-in-particles" aria-hidden="true">{Array.from({ length: 8 }, (_, index) => <i key={index} />)}</div><div className="cut-in-card"><Art type={effect.card} /><div><span>{failed ? `${withSan(effect.actorName)}の推理結果` : `${withSan(effect.actorName)}が使用`}</span><strong>{failed ? "みぬけなかった！" : definition.name}</strong><p>{failed && effect.targetName ? `${withSan(effect.targetName)}は「ひみつ」を持っていません` : definition.cutInText}</p>{!failed && effect.targetPublic && effect.targetName && <small>対象：{withSan(effect.targetName)}</small>}</div></div></div>;
}

function MiniCard({ type }: { type: CardType }) {
  const definition = CARD_DEFINITIONS[type];
  return <div className="mini-card" style={{ "--card-accent": definition.accent } as CSSProperties}><Art type={type} /><strong>{definition.name}</strong></div>;
}

function Art({ type }: { type: CardType }) {
  const definition = CARD_DEFINITIONS[type];
  return <div className="art-window" style={{ background: `${definition.accent}18` }}><img src={definition.art} alt={CHARACTER_NAMES[definition.character]} /></div>;
}

function Avatar({ character, small = false }: { character: CharacterId; small?: boolean }) {
  return <span className={`avatar ${small ? "avatar-small" : ""}`}><img src={CHARACTER_ART[character]} alt="" /></span>;
}

function Field({ label, value, onChange, placeholder, autoFocus, maxLength }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; autoFocus?: boolean; maxLength?: number }) {
  return <label className="field"><span>{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} autoFocus={autoFocus} maxLength={maxLength} autoComplete="off" /></label>;
}

function Button({ children, variant = "primary", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" }) {
  return <button className={`button button-${variant}`} {...props}>{children}</button>;
}

function Modal({ title, children, onClose, lock = false }: { title: string; children: ReactNode; onClose?: () => void; lock?: boolean }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && !lock) onClose?.(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [lock, onClose]);
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => { if (!lock && event.target === event.currentTarget) onClose?.(); }}><div className="modal" ref={dialogRef} tabIndex={-1}><div className="modal-header"><h2>{title}</h2>{!lock && <button onClick={onClose} aria-label="閉じる">×</button>}</div>{children}</div></div>;
}

function formatDuration(seconds: number) { return `${Math.floor(seconds / 60)}分${seconds % 60}秒`; }

function signal(enabled: boolean, kind: "click" | "turn" | "reveal") {
  if (!enabled) return;
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const context = new AudioCtx();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = kind === "turn" ? 660 : kind === "reveal" ? 520 : 440;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.07, context.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.16);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(); oscillator.stop(context.currentTime + 0.17);
  } catch { /* 音声未対応環境では無音で続行 */ }
  if (kind !== "click" && navigator.vibrate) navigator.vibrate(kind === "turn" ? [35, 35, 35] : 40);
}
