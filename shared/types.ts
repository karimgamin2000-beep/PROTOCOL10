export type GamePhase = 'LOBBY' | 'EXTRACTION' | 'STORM' | 'VOTE' | 'GAME_OVER';
export type PlayerRole = 'INNOCENT' | 'INFILTRATOR' | 'UNKNOWN';

export interface Player {
  id: string;
  name: string;
  role: PlayerRole;
  x: number;
  y: number;
  z: number;
  ry: number;
  alive: boolean;
  lootCount: number;
  inBunker: boolean;
  votesReceived: number;
  hasVoted: boolean;
  isSprinting: boolean;
  isReady: boolean;
}

export interface Loot {
  id: string;
  x: number;
  z: number;
  collected: boolean;
}

export interface GameState {
  phase: GamePhase;
  round: number;
  timer: number;
  players: Record<string, Player>;
  loot: Loot[];
  lootQuota: number;
  totalLootCollected: number;
  winner: 'INNOCENTS' | 'INFILTRATORS' | null;
}

export interface ClientInput {
  x: number;
  z: number;
  ry: number;
  isSprinting: boolean;
}

// Server to Client event structures
export interface ServerToClientEvents {
  initClient: (payload: { playerId: string }) => void;
  gameStart: (payload: { role: PlayerRole }) => void;
  stateUpdate: (state: GameState) => void;
  chatMessage: (payload: { sender: string; role: PlayerRole; message: string }) => void;
  killNotification: (payload: { killerName: string; victimName: string }) => void;
  voteReveal: (payload: { name: string; role: PlayerRole; votes: number }) => void;
  gameReset: () => void;
}

// Client to Server event structures
export interface ClientToServerEvents {
  joinLobby: (payload: { name: string }) => void;
  playerReady: (payload: { ready: boolean }) => void;
  updateInput: (input: ClientInput) => void;
  interactLoot: (payload: { lootId: string }) => void;
  stealthKill: (payload: { targetPlayerId: string }) => void;
  castVote: (payload: { targetPlayerId: string | null }) => void;
  sendChat: (payload: { message: string }) => void;
  adminReset: () => void;
}
