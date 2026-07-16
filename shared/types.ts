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
  protected: boolean;
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
  kind: "select-player" | "select-card" | "rotate" | "waiting";
  prompt: string;
  options: ActionOption[];
  selectedCount?: number;
  totalCount?: number;
  cancellable?: boolean;
  card?: CardType;
  expiresAt?: number;
}

export interface CardEffectEvent {
  id: string;
  actorId: string;
  actorName: string;
  card: CardType;
  targetId?: string;
  targetName?: string;
  targetPublic: boolean;
}

export interface GameResult {
  winnerId: string;
  winnerName: string;
  secretHolderId: string;
  secretHolderName: string;
  reason: "deduced" | "escaped";
  durationSeconds: number;
}

export interface RoomView {
  code: string;
  status: "lobby" | "playing" | "finished";
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
  pending: PendingView | null;
  result: GameResult | null;
}

export interface Ack<T = undefined> {
  ok: boolean;
  data?: T;
  error?: string;
}
