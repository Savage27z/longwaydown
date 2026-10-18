import Peer, { type DataConnection } from 'peerjs';
import type { Difficulty } from '../config/race';
import type { MapId } from '../config/maps';
import { NET, PLAYER_COLORS, type LobbyPlayer, type NetMsg, type RiderState, type StartInfo } from './protocol';
import { Relay } from './Relay';

type Me = Omit<LobbyPlayer, 'id' | 'color'>;

/** Room codes avoid look-alike characters (0/O, 1/I). */
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeCode(): string {
  let s = '';
  for (let i = 0; i < NET.codeLength; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

function randomId(prefix: string): string {
  return prefix + Math.random().toString(36).slice(2, 10);
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

/** Relay topics for a room. */
const topics = (code: string) => {
  const base = `longwaydown/v1/${code}`;
  return { up: (id: string) => `${base}/up/${id}`, upAll: `${base}/up/+`, down: (id: string) => `${base}/down/${id}`, all: `${base}/all` };
};

/** One client as the host sees it: a direct WebRTC channel, or a relay mailbox. */
interface Link {
  id: string;
  kind: 'peer' | 'relay';
  send(m: NetMsg): void;
  close(): void;
  /** Relay links: last time we heard from them (ms). */
  seen: number;
}

/** Seconds between relay pings, and silence after which a relay link counts as gone. */
const PING_EVERY = 3;
const SILENT_LIMIT = 15;
/** How long a join tries a direct link before using the relay (ms). */
const DIRECT_WAIT = 6000;

/**
 * An online room. The host is the hub: clients talk only to the host, which relays states,
 * finishes and knockouts, runs the bots, and says when to start. Clients connect directly over
 * WebRTC (PeerJS; its broker only does the handshake) when the networks allow it, otherwise
 * through a public MQTT relay over secure WebSockets, which works on any network.
 * Room code = the host's peer id minus a prefix (also names the relay topics).
 */
export class NetSession {
  players: LobbyPlayer[] = [];
  map: MapId = 'snowPeak';
  difficulty: Difficulty = 'normal';
  bots = true;
  /** In a race right now (lobby otherwise). */
  racing = false;
  /** This race's go has happened (kept so a machine that finishes loading late still starts). */
  started = false;
  /** Client: connected through the relay (not a direct link). */
  viaRelay = false;
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
  private conns = new Map<string, Link>();
  private toHost: ((m: NetMsg) => void) | null = null;
  private hostConn: DataConnection | null = null;
  private relayNet: Relay | null = null;
  private ready = new Set<string>();
  private readyTimer = 0;
  private pingTimer = 0;
  private hostSeen = performance.now();
  private closed = false;

  private constructor(
    private readonly peer: Peer | null,
    readonly role: 'host' | 'client',
    readonly code: string,
    private readonly id: string,
  ) {
    peer?.on('disconnected', () => {
      // Lost the broker (not the players): try to stay reachable.
      if (!this.closed) peer.reconnect();
    });
  }

  get selfId(): string {
    return this.id;
  }

  get isHost(): boolean {
    return this.role === 'host';
  }

  /** Open a room (direct links + the relay). */
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
    const s = new NetSession(peer, 'host', code, peer.id);
    s.players = [{ ...me, id: peer.id, color: PLAYER_COLORS[0]! }];
    peer.on('connection', (c) => s.accept(c));
    // The relay is best effort: direct links still work if no broker answers.
    try {
      await s.hostRelay();
    } catch {
      // keep going on direct links only
    }
    s.pingTimer = window.setInterval(() => s.hostTick(), PING_EVERY * 1000);
    return s;
  }

  private async hostRelay(): Promise<void> {
    const t = topics(this.code);
    const relay = await Relay.connect(randomId('lwdh-'));
    this.relayNet = relay;
    relay.subscribe(t.upAll);
    relay.onMessage = (topic, data) => {
      const id = topic.slice(topic.lastIndexOf('/') + 1);
      let m: NetMsg;
      try {
        m = JSON.parse(data) as NetMsg;
      } catch {
        return;
      }
      let link = this.conns.get(id);
      if (!link) {
        if (m.t !== 'hello') return;
        link = { id, kind: 'relay', seen: 0, send: (x) => relay.publish(t.down(id), JSON.stringify(x)), close: () => relay.publish(t.down(id), JSON.stringify({ t: 'bye' } satisfies NetMsg)) };
      }
      link.seen = performance.now();
      if (m.t === 'bye') this.dropClient(id);
      else this.fromClient(link, m);
    };
  }

  /** Host: keep relay clients alive, drop the silent ones. */
  private hostTick(): void {
    if (!this.relayNet) return;
    this.relayNet.publish(topics(this.code).all, JSON.stringify({ t: 'ping' } satisfies NetMsg));
    const now = performance.now();
    for (const l of [...this.conns.values()]) if (l.kind === 'relay' && now - l.seen > SILENT_LIMIT * 1000) this.dropClient(l.id);
  }

  /** Join a room by code: direct link first, the relay if that doesn't open in time. */
  static async join(code: string, me: Me): Promise<NetSession> {
    code = code.trim().toUpperCase();
    let peer: Peer | null = null;
    // `?relay` in the URL skips the direct attempt (testing, or networks known to block WebRTC).
    const forceRelay = new URLSearchParams(location.search).has('relay');
    try {
      if (!forceRelay) peer = await openPeer();
    } catch {
      // PeerJS broker unreachable: straight to the relay.
    }
    if (peer) {
      const direct = await NetSession.joinDirect(peer, code, me);
      if (direct instanceof NetSession) return direct;
      if (direct === 'no-room') throw new Error('No room with that code.');
      if (direct === 'full') throw new Error('That room is full.');
    }
    return NetSession.joinRelay(code, me);
  }

  private static joinDirect(peer: Peer, code: string, me: Me): Promise<NetSession | 'no-room' | 'full' | 'timeout'> {
    const s = new NetSession(peer, 'client', code, peer.id);
    return new Promise((resolve) => {
      const conn = peer.connect(NET.prefix + code, { reliable: true });
      let settled = false;
      const finish = (r: NetSession | 'no-room' | 'full' | 'timeout') => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        if (!(r instanceof NetSession)) peer.destroy();
        resolve(r);
      };
      const timer = window.setTimeout(() => finish('timeout'), DIRECT_WAIT);
      peer.on('error', (e) => {
        if ((e as { type?: string }).type === 'peer-unavailable') finish('no-room');
      });
      conn.on('open', () => conn.send({ t: 'hello', player: me } satisfies NetMsg));
      conn.on('data', (d) => {
        const m = d as NetMsg;
        if (m.t === 'welcome') {
          s.hostConn = conn;
          s.toHost = (x) => {
            if (conn.open) conn.send(x);
          };
          finish(s);
        } else if (m.t === 'full') {
          finish('full');
          return;
        }
        if (settled && s.hostConn) s.fromHost(m);
      });
      conn.on('close', () => {
        if (s.hostConn) s.lost('The host closed the room.');
      });
    });
  }

  private static async joinRelay(code: string, me: Me): Promise<NetSession> {
    const id = randomId('r-');
    const t = topics(code);
    let relay: Relay;
    try {
      relay = await Relay.connect(id);
    } catch {
      throw new Error('Could not reach the room (network blocked?).');
    }
    const s = new NetSession(null, 'client', code, id);
    s.relayNet = relay;
    s.viaRelay = true;
    s.toHost = (x) => relay.publish(t.up(id), JSON.stringify(x));
    relay.subscribe(t.down(id));
    relay.subscribe(t.all);
    relay.onClose = () => s.lost('Lost the connection to the room.');
    return new Promise((resolve, reject) => {
      let welcomed = false;
      const timer = window.setTimeout(() => {
        relay.close();
        reject(new Error('No room with that code (or it is not answering).'));
      }, 10000);
      relay.onMessage = (_topic, data) => {
        let m: NetMsg;
        try {
          m = JSON.parse(data) as NetMsg;
        } catch {
          return;
        }
        s.hostSeen = performance.now();
        if (!welcomed) {
          if (m.t === 'welcome') {
            welcomed = true;
            window.clearTimeout(timer);
            resolve(s);
          } else if (m.t === 'full') {
            window.clearTimeout(timer);
            relay.close();
            reject(new Error('That room is full.'));
          }
          return;
        }
        if (m.t === 'bye') s.lost('The host closed the room.');
        else s.fromHost(m);
      };
      // Relay clients ping the host and watch for the host's pings.
      s.pingTimer = window.setInterval(() => {
        if (!welcomed) return;
        s.toHost?.({ t: 'ping' });
        if (performance.now() - s.hostSeen > SILENT_LIMIT * 1000) s.lost('The host stopped answering.');
      }, PING_EVERY * 1000);
      // Retry the hello until the host answers (it may subscribe a moment after us).
      const hello = () => {
        if (welcomed || s.closed) return;
        s.toHost?.({ t: 'hello', player: me });
        window.setTimeout(hello, 2000);
      };
      hello();
    });
  }

  // ---- Host side ----

  private accept(c: DataConnection): void {
    const link: Link = {
      id: c.peer,
      kind: 'peer',
      seen: 0,
      send: (m) => {
        if (c.open) c.send(m);
      },
      close: () => c.close(),
    };
    c.on('data', (d) => this.fromClient(link, d as NetMsg));
    c.on('close', () => this.dropClient(c.peer));
    c.on('error', () => this.dropClient(c.peer));
  }

  private fromClient(link: Link, m: NetMsg): void {
    switch (m.t) {
      case 'hello': {
        if (this.conns.has(link.id)) {
          // A repeated hello (relay retry): just welcome again.
          link.send({ t: 'welcome', you: link.id });
          return;
        }
        if (this.players.length >= NET.maxPlayers || this.racing) {
          link.send({ t: 'full' });
          return;
        }
        this.conns.set(link.id, link);
        const used = new Set(this.players.map((p) => p.color));
        const color = PLAYER_COLORS.find((x) => !used.has(x)) ?? PLAYER_COLORS[0]!;
        this.players.push({ ...m.player, id: link.id, color });
        link.send({ t: 'welcome', you: link.id });
        this.pushLobby();
        break;
      }
      case 'ready':
        this.ready.add(link.id);
        this.checkReady();
        break;
      case 'states':
        this.onStates?.(m.list);
        this.relay(m, link.id);
        break;
      case 'fin':
        this.onFin?.(m.id, m.time);
        this.relay(m, link.id);
        break;
      case 'ko':
        this.onKo?.(m.target, m.from);
        this.relay(m, link.id);
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
    this.started = false;
    this.ready.clear();
    this.broadcast({ t: 'start', info });
    this.onStart?.(info);
    window.clearTimeout(this.readyTimer);
    this.readyTimer = window.setTimeout(() => this.go(), NET.readyTimeout * 1000);
  }

  /** Mark this machine loaded and on the grid (host counts itself too). */
  markReady(): void {
    // Loaded after the go (slow machine, background tab): start straight away.
    if (this.started) this.onGo?.();
    if (this.isHost) {
      this.ready.add(this.selfId);
      this.checkReady();
    } else this.toHost?.({ t: 'ready' });
  }

  private checkReady(): void {
    if (!this.isHost || !this.racing || this.ready.size === 0) return;
    if (this.players.every((p) => this.ready.has(p.id))) this.go();
  }

  private go(): void {
    window.clearTimeout(this.readyTimer);
    if (!this.racing || this.started) return;
    this.started = true;
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

  /** To every client: direct links one by one, relay clients with one publish to the room topic. */
  private broadcast(m: NetMsg): void {
    let relayed = false;
    for (const c of this.conns.values()) {
      if (c.kind === 'peer') c.send(m);
      else relayed = true;
    }
    if (relayed) this.relayNet?.publish(topics(this.code).all, JSON.stringify(m));
  }

  /** Like broadcast but not back to the sender's direct link (relay clients skip their own riders). */
  private relay(m: NetMsg, except: string): void {
    let relayed = false;
    for (const c of this.conns.values()) {
      if (c.kind === 'relay') relayed = true;
      else if (c.id !== except) c.send(m);
    }
    if (relayed) this.relayNet?.publish(topics(this.code).all, JSON.stringify(m));
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
        this.started = false;
        this.onStart?.(m.info);
        break;
      case 'go':
        this.started = true;
        this.onGo?.();
        break;
      case 'states':
        this.onStates?.(m.list.filter((st) => st.id !== this.id));
        break;
      case 'fin':
        if (m.id !== this.id) this.onFin?.(m.id, m.time);
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
    else this.toHost?.(m);
  }

  sendFin(id: string, time: number): void {
    const m: NetMsg = { t: 'fin', id, time };
    if (this.isHost) this.broadcast(m);
    else this.toHost?.(m);
  }

  sendKo(target: string, from: string): void {
    const m: NetMsg = { t: 'ko', target, from };
    if (this.isHost) this.broadcast(m);
    else this.toHost?.(m);
  }

  private lost(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    window.clearInterval(this.pingTimer);
    this.onClosed?.(reason);
    this.peer?.destroy();
    this.relayNet?.close();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    window.clearTimeout(this.readyTimer);
    window.clearInterval(this.pingTimer);
    if (this.isHost) {
      // Relay clients learn the room closed from a bye on the room topic.
      this.relayNet?.publish(topics(this.code).all, JSON.stringify({ t: 'bye' } satisfies NetMsg));
      for (const c of this.conns.values()) if (c.kind === 'peer') c.close();
    } else {
      this.toHost?.({ t: 'bye' });
      this.hostConn?.close();
    }
    this.peer?.destroy();
    window.setTimeout(() => this.relayNet?.close(), 200);
  }
}
