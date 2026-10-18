import Peer, { type DataConnection } from 'peerjs';
import type { Difficulty } from '../config/race';
import type { MapId } from '../config/maps';
import { NET, PLAYER_COLORS, type LobbyPlayer, type NetMsg, type RiderState, type StartInfo } from './protocol';

type Me = Omit<LobbyPlayer, 'id' | 'color'>;

/** Room codes avoid look-alike characters (0/O, 1/I). */
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeCode(): string {
  let s = '';
  for (let i = 0; i < NET.codeLength; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

function openPeer(id?: string): Promise<Peer> {
  return new Promise((resolve, reject) => {
    const peer = id ? new Peer(id) : new Peer();
    const fail = (e: Error) => {
      peer.destroy();
      reject(e);
    };
    peer.once('open', () => {
      peer.off('error', fail);
      resolve(peer);
    });
    peer.once('error', fail);
  });
}

/**
 * An online room over WebRTC (PeerJS; its free public broker only does the handshake). The host
 * is the hub: clients talk only to the host, which relays states, finishes and knockouts, runs
 * the bots, and says when to start. Room code = the host's peer id minus a prefix.
 */
export class NetSession {
  players: LobbyPlayer[] = [];
  map: MapId = 'snowPeak';
  difficulty: Difficulty = 'normal';
  bots = true;
  /** In a race right now (lobby otherwise). */
  racing = false;
  onLobby: (() => void) | null = null;
  onStart: ((info: StartInfo) => void) | null = null;
  onGo: (() => void) | null = null;
  onStates: ((list: RiderState[]) => void) | null = null;
  onFin: ((id: string, time: number) => void) | null = null;
  onKo: ((target: string, from: string) => void) | null = null;
  onLobbyReturn: (() => void) | null = null;
  /** Someone left (host: a client; client: the host closed the room -> id = host id). */
  onLeft: ((id: string) => void) | null = null;
  onClosed: ((reason: string) => void) | null = null;
  private conns = new Map<string, DataConnection>();
  private hostConn: DataConnection | null = null;
  private ready = new Set<string>();
  private readyTimer = 0;
  private closed = false;

  private constructor(
    private readonly peer: Peer,
    readonly role: 'host' | 'client',
    readonly code: string,
  ) {
    peer.on('disconnected', () => {
      // Lost the broker (not the players): try to stay reachable.
      if (!this.closed) peer.reconnect();
    });
  }

  get selfId(): string {
    return this.peer.id;
  }

  get isHost(): boolean {
    return this.role === 'host';
  }

  /** Open a room. */
  static async host(me: Me): Promise<NetSession> {
    let peer: Peer | null = null;
    let code = '';
    for (let tries = 0; !peer && tries < 4; tries++) {
      code = makeCode();
      try {
        peer = await openPeer(NET.prefix + code);
      } catch (e) {
        if ((e as { type?: string }).type !== 'unavailable-id') throw e;
      }
    }
    if (!peer) throw new Error('Could not open a room, try again.');
    const s = new NetSession(peer, 'host', code);
    s.players = [{ ...me, id: peer.id, color: PLAYER_COLORS[0]! }];
    peer.on('connection', (c) => s.accept(c));
    return s;
  }

  /** Join a room by code. Resolves once the host has welcomed us. */
  static async join(code: string, me: Me): Promise<NetSession> {
    code = code.trim().toUpperCase();
    const peer = await openPeer();
    const s = new NetSession(peer, 'client', code);
    return new Promise((resolve, reject) => {
      const conn = peer.connect(NET.prefix + code, { reliable: true });
      const timer = window.setTimeout(() => {
        peer.destroy();
        reject(new Error('No room with that code (or it is not answering).'));
      }, 12000);
      peer.on('error', (e) => {
        if ((e as { type?: string }).type === 'peer-unavailable') {
          window.clearTimeout(timer);
          peer.destroy();
          reject(new Error('No room with that code.'));
        }
      });
      conn.on('open', () => conn.send({ t: 'hello', player: me } satisfies NetMsg));
      conn.on('data', (d) => {
        const m = d as NetMsg;
        if (m.t === 'welcome') {
          window.clearTimeout(timer);
          s.hostConn = conn;
          resolve(s);
        } else if (m.t === 'full') {
          window.clearTimeout(timer);
          peer.destroy();
          reject(new Error('That room is full.'));
          return;
        }
        s.fromHost(m);
      });
      conn.on('close', () => s.lost('The host closed the room.'));
    });
  }

  // ---- Host side ----

  private accept(c: DataConnection): void {
    c.on('data', (d) => this.fromClient(c, d as NetMsg));
    c.on('close', () => this.dropClient(c.peer));
    c.on('error', () => this.dropClient(c.peer));
  }

  private fromClient(c: DataConnection, m: NetMsg): void {
    switch (m.t) {
      case 'hello': {
        if (this.players.length >= NET.maxPlayers || this.racing) {
          c.send({ t: 'full' } satisfies NetMsg);
          return;
        }
        this.conns.set(c.peer, c);
        const used = new Set(this.players.map((p) => p.color));
        const color = PLAYER_COLORS.find((x) => !used.has(x)) ?? PLAYER_COLORS[0]!;
        this.players.push({ ...m.player, id: c.peer, color });
        c.send({ t: 'welcome', you: c.peer } satisfies NetMsg);
        this.pushLobby();
        break;
      }
      case 'ready':
        this.ready.add(c.peer);
        this.checkReady();
        break;
      case 'states':
        this.onStates?.(m.list);
        this.relay(m, c.peer);
        break;
      case 'fin':
        this.onFin?.(m.id, m.time);
        this.relay(m, c.peer);
        break;
      case 'ko':
        this.onKo?.(m.target, m.from);
        this.relay(m, c.peer);
        break;
      default:
        break;
    }
  }

  private dropClient(id: string): void {
    if (!this.conns.has(id)) return;
    this.conns.delete(id);
    this.players = this.players.filter((p) => p.id !== id);
    this.ready.delete(id);
    this.onLeft?.(id);
    this.pushLobby();
    this.checkReady();
  }

  /** Host: lobby settings changed (map, difficulty, bots) or players came / went. */
  pushLobby(): void {
    if (!this.isHost) return;
    this.broadcast({ t: 'lobby', players: this.players, map: this.map, difficulty: this.difficulty, bots: this.bots });
    this.onLobby?.();
  }

  /** Host: start a race with this grid. Everyone loads, then `go` once all are on the grid. */
  start(info: StartInfo): void {
    this.racing = true;
    this.ready.clear();
    this.broadcast({ t: 'start', info });
    this.onStart?.(info);
    window.clearTimeout(this.readyTimer);
    this.readyTimer = window.setTimeout(() => this.go(), NET.readyTimeout * 1000);
  }

  /** Mark this machine loaded and on the grid (host counts itself too). */
  markReady(): void {
    if (this.isHost) {
      this.ready.add(this.selfId);
      this.checkReady();
    } else this.hostConn?.send({ t: 'ready' } satisfies NetMsg);
  }

  private checkReady(): void {
    if (!this.isHost || !this.racing || this.ready.size === 0) return;
    if (this.players.every((p) => this.ready.has(p.id))) this.go();
  }

  private go(): void {
    window.clearTimeout(this.readyTimer);
    if (!this.racing) return;
    this.ready.clear();
    this.readyTimer = 0;
    this.broadcast({ t: 'go' });
    this.onGo?.();
  }

  /** Host: everyone back to the lobby. */
  backToLobby(): void {
    this.racing = false;
    this.broadcast({ t: 'lobbyReturn' });
    this.pushLobby();
  }

  private broadcast(m: NetMsg): void {
    for (const c of this.conns.values()) if (c.open) c.send(m);
  }

  private relay(m: NetMsg, except: string): void {
    for (const [id, c] of this.conns) if (id !== except && c.open) c.send(m);
  }

  // ---- Client side ----

  private fromHost(m: NetMsg): void {
    switch (m.t) {
      case 'lobby':
        this.players = m.players;
        this.map = m.map;
        this.difficulty = m.difficulty;
        this.bots = m.bots;
        this.onLobby?.();
        break;
      case 'start':
        this.racing = true;
        this.onStart?.(m.info);
        break;
      case 'go':
        this.onGo?.();
        break;
      case 'states':
        this.onStates?.(m.list);
        break;
      case 'fin':
        this.onFin?.(m.id, m.time);
        break;
      case 'ko':
        this.onKo?.(m.target, m.from);
        break;
      case 'lobbyReturn':
        this.racing = false;
        this.onLobbyReturn?.();
        break;
      default:
        break;
    }
  }

  // ---- Both ----

  /** This machine's riders' states (host: its own rider and the bots). */
  sendStates(list: RiderState[]): void {
    const m: NetMsg = { t: 'states', list };
    if (this.isHost) this.broadcast(m);
    else if (this.hostConn?.open) this.hostConn.send(m);
  }

  sendFin(id: string, time: number): void {
    const m: NetMsg = { t: 'fin', id, time };
    if (this.isHost) this.broadcast(m);
    else this.hostConn?.send(m);
  }

  sendKo(target: string, from: string): void {
    const m: NetMsg = { t: 'ko', target, from };
    if (this.isHost) this.broadcast(m);
    else this.hostConn?.send(m);
  }

  private lost(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.onClosed?.(reason);
    this.peer.destroy();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    window.clearTimeout(this.readyTimer);
    for (const c of this.conns.values()) c.close();
    this.hostConn?.close();
    this.peer.destroy();
  }
}
