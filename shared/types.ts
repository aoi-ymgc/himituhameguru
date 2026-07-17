import type { CardType, CharacterId } from "./cards.js";

export const GAME_TITLE = "ひみつはめぐる";

export interface CardView {
  instanceId: string;
  type: CardType;
}

export interface PlayerView {
  id: string;
  name: string;
  character: CharacterId;
  isHost: boolean;
  connected: boolean;
  handCount: number;
  isTurn: boolean;
  isAlly: boolean;
  seat: number;
}

export interface GameSettings {
  maxPlayers: number;
  turnSeconds: 0 | 30 | 60 | 90;
  animationSpeed: "normal" | "fast";
}

export interface ActionOption {
  id: string;
  label: string;
  meta?: string;
}

export interface PendingView {
  id: string;
  kind: "select-player" | "select-card" | "rotate" | "no-effect" | "waiting";
  prompt: string;
  options: ActionOption[];
  selectedCount?: number;
  totalCount?: number;
  cancellable?: boolean;
  card?: CardType;
  expiresAt?: number;
}

export interface ResultPlayer {
  id: string;
  name: string;
}

export interface GameResultRoles {
  secretHolder: ResultPlayer;
  allies: ResultPlayer[];
  detectives: ResultPlayer[];
}

export interface CardEffectEvent {
  id: string;
  actorId: string;
  actorName: string;
  card: CardType;
  targetId?: string;
  targetName?: string;
  targetPublic: boolean;
  outcome?: "deduce-failed";
}

export interface GameResult {
  winningSide: "detective" | "secret";
  winners: ResultPlayer[];
  roles: GameResultRoles;
  winnerId: string;
  winnerName: string;
  secretHolderId: string;
  secretHolderName: string;
  reason: "deduced" | "escaped";
  durationSeconds: number;
}

export interface RoomView {
  code: string;
  status: "lobby" | "incident" | "playing" | "finished";
  viewerId: string;
  hostId: string;
  settings: GameSettings;
  players: PlayerView[];
  hand: CardView[];
  discard: CardType[];
  logs: { id: string; text: string; at: number }[];
  turnNumber: number;
  turnEndsAt: number | null;
  turnDirection: "clockwise";
  nextPlayerId: string | null;
  firstRoundComplete: boolean;
  firstFinderId: string | null;
  incidentTitle: string | null;
  pending: PendingView | null;
  result: GameResult | null;
}

export interface Ack<T = undefined> {
  ok: boolean;
  data?: T;
  error?: string;
}
