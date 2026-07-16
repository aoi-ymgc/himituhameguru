import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import QRCode from "qrcode";
import { CARD_DEFINITIONS, type CardType, type CharacterId } from "../../shared/cards";
import { GAME_TITLE, type Ack, type CardView, type GameSettings, type RoomView } from "../../shared/types";
import { socket } from "./main";

interface SessionData { code: string; playerId: string; token: string }
interface Notice { playerId: string; title: string; cards: CardType[]; durationMs: number }

const CHARACTER_NAMES: Record<CharacterId, string> = {
  sheep: "ふわっとひつじ",
  hamster: "ほっぺハムくん",
  tanuki: "ぶっきらたぬきくん",
  wolf: "ぶっきらおおかみくん",
  penguin: "コウハイペンギンくん",
};

const CHARACTER_ART: Record<CharacterId, string> = {
  sheep: CARD_DEFINITIONS.rumor.art,
  hamster: CARD_DEFINITIONS.share.art,
  tanuki: CARD_DEFINITIONS.deduce.art,
  wolf: CARD_DEFINITIONS.peek.art,
  penguin: CARD_DEFINITIONS.again.art,
};

const roomCodeFromPath = () => window.location.pathname.match(/^\/room\/([A-Z2-9]{6})/i)?.[1]?.toUpperCase() ?? "";
const sessionKey = (code: string) => `himitsu-session:${code}`;

export default function App() {
  const [room, setRoom] = useState<RoomView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [entry, setEntry] = useState<"home" | "create" | "join">(roomCodeFromPath() ? "join" : "home");
  const [howTo, setHowTo] = useState(false);
  const [selectedCard, setSelectedCard] = useState<CardView | null>(null);
  const [privateNotice, setPrivateNotice] = useState<Notice | null>(null);
  const [soundOn, setSoundOn] = useState(() => localStorage.getItem("himitsu-sound") !== "off");
  const previousTurn = useRef<string | null>(null);

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
      setBusy(false);
      setError("");
      const active = next.players.find((player) => player.isTurn)?.id ?? null;
      if (active && active !== previousTurn.current && active === next.viewerId) {
        signal(soundOn, "turn");
      }
      previousTurn.current = active;
    };
    const onNotice = (notice: Notice) => {
      setPrivateNotice(notice);
      signal(soundOn, "reveal");
      window.setTimeout(() => setPrivateNotice((current) => current === notice ? null : current), notice.durationMs);
    };
    const onKicked = (message: string) => {
      const code = roomCodeFromPath();
      if (code) localStorage.removeItem(sessionKey(code));
      setRoom(null);
      setEntry("home");
      setError(message);
      window.history.replaceState({}, "", "/");
    };
    socket.on("connect", reconnect);
    socket.on("roomState", onState);
    socket.on("privateNotice", onNotice);
    socket.on("kicked", onKicked);
    if (socket.connected) reconnect();
    return () => {
      socket.off("connect", reconnect);
      socket.off("roomState", onState);
      socket.off("privateNotice", onNotice);
      socket.off("kicked", onKicked);
    };
  }, [soundOn]);

  const invoke = <T,>(event: string, payload: unknown = {}): Promise<T | undefined> => {
    setBusy(true);
    setError("");
    return new Promise((resolve) => {
      socket.emit(event, payload, (ack: Ack<T>) => {
        setBusy(false);
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
      {room.status === "playing" && <Game room={room} invoke={invoke} selectedCard={selectedCard} setSelectedCard={setSelectedCard} busy={busy} />}
      {room.status === "finished" && <Game room={room} invoke={invoke} selectedCard={null} setSelectedCard={setSelectedCard} busy={busy} />}
      {howTo && <HowToModal onClose={() => setHowTo(false)} />}
      {privateNotice && <PrivateNotice notice={privateNotice} onClose={() => setPrivateNotice(null)} />}
    </Shell>
  );
}

function Shell({ children, soundOn, onSound }: { children: ReactNode; soundOn: boolean; onSound: () => void }) {
  return (
    <div className="app-shell">
      <header className="site-header">
        <button className="brand" onClick={() => window.location.assign("/")} aria-label="トップへ戻る">
          <span className="brand-mark">?</span><span>{GAME_TITLE}</span>
        </button>
        <button className="icon-button" onClick={onSound} aria-label={soundOn ? "音をオフ" : "音をオン"}>{soundOn ? "♪" : "×"}</button>
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
        <span className="eyebrow">3〜8人のオンライン推理ゲーム</span>
        <h1>そのひみつ、<br /><em>いま誰の手に？</em></h1>
        <p>カードを見て、交換して、惑わせて。めぐり続ける「ひみつ」の現在地を見ぬこう。</p>
        <div className="hero-characters" aria-hidden="true">
          {(["sheep", "hamster", "tanuki", "penguin"] as CharacterId[]).map((id) => <Avatar key={id} character={id} />)}
        </div>
      </div>
      <div className="entry-card">
        {mode === "home" ? (
          <>
            <Button onClick={() => setMode("create")}>部屋を作る</Button>
            <Button variant="secondary" onClick={() => setMode("join")}>部屋に参加</Button>
            <Button variant="ghost" onClick={onHowTo}>遊び方</Button>
          </>
        ) : (
          <form onSubmit={submit}>
            <button className="back-link" type="button" onClick={() => setMode("home")}>← 戻る</button>
            <h2>{mode === "create" ? "新しい部屋" : "部屋に参加"}</h2>
            {mode === "join" && <Field label="6桁のルームコード" value={code} onChange={(value) => setCode(value.replace(/[^a-z0-9]/gi, "").slice(0, 6).toUpperCase())} placeholder="ABC123" autoFocus={!code} />}
            <Field label="プレイヤー名" value={name} onChange={setName} placeholder="おなまえ" autoFocus={Boolean(code) || mode === "create"} maxLength={16} />
            {error && <p className="form-error" role="alert">{error}</p>}
            <Button type="submit" disabled={busy || !name.trim() || (mode === "join" && code.length !== 6)}>{busy ? "接続中…" : mode === "create" ? "部屋を作成" : "参加する"}</Button>
          </form>
        )}
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
          <p className="panel-label">ルームコード</p>
          <strong className="room-code">{room.code}</strong>
          <p>このURLかQRコードを友だちに共有してください。</p>
          <div className="button-row"><Button onClick={copy}>{copied ? "コピーしました！" : "招待URLをコピー"}</Button><Button variant="secondary" onClick={() => setShowQr(true)}>QRコード</Button></div>
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

function Game({ room, invoke, selectedCard, setSelectedCard, busy }: {
  room: RoomView;
  invoke: <T>(event: string, payload?: unknown) => Promise<T | undefined>;
  selectedCard: CardView | null;
  setSelectedCard: (card: CardView | null) => void;
  busy: boolean;
}) {
  const me = room.players.find((player) => player.id === room.viewerId)!;
  const current = room.players.find((player) => player.isTurn);
  const canPlay = room.status === "playing" && me.isTurn && !room.pending;
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
      <div className="turn-banner">
        <div><span>TURN {room.turnNumber}</span><strong>{room.status === "finished" ? "ゲーム終了" : me.isTurn ? "あなたの番です" : `${current?.name ?? ""}さんの番`}</strong></div>
        {seconds !== null && <div className={`timer ${seconds <= 10 ? "timer-danger" : ""}`}>{seconds}</div>}
      </div>
      <div className="player-strip" aria-label="プレイヤー一覧">
        {room.players.map((player) => (
          <div className={`player-chip ${player.isTurn ? "active" : ""}`} key={player.id}>
            <Avatar character={player.character} small />
            <div><strong>{player.name}{player.id === room.viewerId ? "（あなた）" : ""}</strong><span>手札 {player.handCount}枚 {player.protected ? "・守られ中" : ""}</span></div>
            {!player.connected && <i>OFF</i>}
          </div>
        ))}
      </div>
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
  return (
    <Modal title={actionable ? "カードの効果" : "しばらくお待ちください"} lock>
      <div className="pending-action">
        <p>{pending.prompt}</p>
        {pending.totalCount !== undefined && <div className="progress"><span style={{ width: `${((pending.selectedCount ?? 0) / pending.totalCount) * 100}%` }} /></div>}
        {actionable && <div className="option-grid">{pending.options.map((option) => {
          const type = option.meta as CardType | undefined;
          return <button key={option.id} disabled={busy} onClick={() => invoke("submitAction", { pendingId: pending.id, optionId: option.id })}>{type && <span className="option-card-dot" style={{ background: CARD_DEFINITIONS[type].accent }} />}{option.label}</button>;
        })}</div>}
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
        <h2>{result.winnerName}さんの勝ち</h2>
        <dl><div><dt>最後のひみつ</dt><dd>{result.secretHolderName}さん</dd></div><div><dt>ゲーム時間</dt><dd>{formatDuration(result.durationSeconds)}</dd></div></dl>
        {isHost ? <div className="result-actions"><Button disabled={busy} onClick={() => invoke("rematch")}>同じメンバーでもう一度</Button><Button variant="secondary" disabled={busy} onClick={() => invoke("returnToLobby")}>ロビーへ戻る</Button></div> : <p className="muted">ホストが次のゲームを選びます</p>}
        <Button variant="ghost" onClick={() => window.location.assign("/")}>トップへ戻る</Button>
      </div>
    </Modal>
  );
}

function PrivateNotice({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  return <Modal title="あなただけの情報" onClose={onClose}><div className="private-notice"><p>{notice.title}</p><div className="notice-cards">{notice.cards.map((type, index) => <MiniCard key={`${type}-${index}`} type={type} />)}</div><Button onClick={onClose}>確認しました</Button></div></Modal>;
}

function CardDetail({ card, canUse, busy, onClose, onUse }: { card: CardView; canUse: boolean; busy: boolean; onClose: () => void; onUse: () => void }) {
  const definition = CARD_DEFINITIONS[card.type];
  return <Modal title={definition.name} onClose={onClose}><div className="card-detail"><Art type={card.type} /><p>{definition.description}</p><span className="character-credit">出演：{CHARACTER_NAMES[definition.character]}</span><Button disabled={!canUse || busy} onClick={onUse}>{card.type === "secret" ? "このカードは使えません" : canUse ? "このカードを使う" : "自分の番を待ってください"}</Button></div></Modal>;
}

function HowToModal({ onClose }: { onClose: () => void }) {
  return <Modal title="遊び方" onClose={onClose}><div className="howto"><div className="rule-lead"><span>?</span><p>たった1枚の「ひみつ」が、交換カードでみんなの手をめぐります。</p></div><ol><li><strong>カードを使う</strong><span>のぞく・交換する・候補を絞る。自分の番に1枚使います。</span></li><li><strong>いまの持ち主を考える</strong><span>見た情報と公開ログを頼りに、ひみつの行方を追います。</span></li><li><strong>「みぬく」で勝負</strong><span>当てれば推理側の勝ち。全員がカードを使い切れば、最後の持ち主が勝ち。</span></li></ol><p className="muted">3〜8人用・アカウント不要。手札の内容は持ち主にしか送られません。</p></div></Modal>;
}

function GameCard({ card, disabled, onClick }: { card: CardView; disabled: boolean; onClick: () => void }) {
  const definition = CARD_DEFINITIONS[card.type];
  return <button className={`game-card ${disabled ? "disabled" : ""}`} onClick={onClick} style={{ "--card-accent": definition.accent } as CSSProperties}><Art type={card.type} /><span className="game-card-name">{definition.name}</span><span className="game-card-hint">タップして確認</span></button>;
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
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => { if (!lock && event.target === event.currentTarget) onClose?.(); }}><div className="modal"><div className="modal-header"><h2>{title}</h2>{!lock && <button onClick={onClose} aria-label="閉じる">×</button>}</div>{children}</div></div>;
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
