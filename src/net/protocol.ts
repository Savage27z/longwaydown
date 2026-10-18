import type { Difficulty } from '../config/race';
import type { MapId } from '../config/maps';
import type { RiderLook } from '../config/riders';
import type { VehicleId } from '../config/vehicles';

/** Online multiplayer messages (JSON over WebRTC data channels; the host relays). */

export const NET = {
  /** Peer ids are this prefix + the room code. */
  prefix: 'longwaydown-room-',
  codeLength: 5,
  /** State updates per second per rider. */
  sendRate: 15,
  /** Riders on the grid (humans first, bots fill the rest when enabled). */
  gridSize: 8,
  /** Host starts anyway if someone hasn't loaded after this long (s). */
  readyTimeout: 25,
  maxPlayers: 8,
};

export interface Paint {
  primary?: string;
  secondary?: string;
}

export interface LobbyPlayer {
  id: string;
  name: string;
  look: RiderLook;
  paint: Partial<Record<VehicleId, Paint>>;
  color: string;
}

/** One rider on the grid: a human (owned by `id`'s machine) or a host-driven bot. */
export interface RosterEntry {
  id: string;
  name: string;
  kind: 'human' | 'bot';
  look: RiderLook;
  /** Bots: one paint for everything; humans: their per-vehicle paint. */
  paint: Paint | Partial<Record<VehicleId, Paint>>;
  color: string;
  /** Bots: index into the bot tuning tables. */
  bot?: number;
}

export interface StartInfo {
  map: MapId;
  difficulty: Difficulty;
  roster: RosterEntry[];
}

/** A rider's state: global position, body rotation, velocity, vehicle, finished time. */
export interface RiderState {
  id: string;
  p: number[];
  q: number[];
  v: number[];
  veh: VehicleId;
}

export type NetMsg =
  | { t: 'hello'; player: Omit<LobbyPlayer, 'id' | 'color'> }
  | { t: 'welcome'; you: string }
  | { t: 'lobby'; players: LobbyPlayer[]; map: MapId; difficulty: Difficulty; bots: boolean }
  | { t: 'start'; info: StartInfo }
  | { t: 'ready' }
  | { t: 'go' }
  | { t: 'states'; list: RiderState[] }
  | { t: 'fin'; id: string; time: number }
  | { t: 'ko'; target: string; from: string }
  | { t: 'lobbyReturn' }
  | { t: 'full' };

export const PLAYER_COLORS = ['#ff5a1f', '#3ec8ff', '#4ade80', '#ffd23f', '#b06cff', '#ff4d6d', '#f4f8ff', '#c9a24a'];
