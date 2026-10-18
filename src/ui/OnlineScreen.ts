import { DIFFICULTIES, DIFFICULTY } from '../config/race';
import { MAP_ORDER, MAPS } from '../config/maps';
import type { Save } from '../core/Save';
import type { NetSession } from '../net/NetSession';
import { NET } from '../net/protocol';

export interface OnlineActions {
  host(name: string): Promise<void>;
  join(code: string, name: string): Promise<void>;
  leave(): void;
  start(): void;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * Online: host a room (share the code) or join one; the lobby shows who's in, and the host picks
 * the mountain, the bots' difficulty and whether bots fill the empty grid spots, then starts.
 */
export function onlineScreen(save: Save, net: NetSession | null, actions: OnlineActions, onBack: () => void, status = ''): HTMLElement {
  const p = document.createElement('div');
  p.className = 'menu-panel wide card online';
  if (!net) {
    const name = save.data.name || `Rider${Math.floor(100 + Math.random() * 900)}`;
    p.innerHTML = `<h2 class="menu-heading">Ride online</h2>
      <div class="menu-tag">Race friends over the internet: one hosts a room and shares the code.</div>
      <div class="online-form">
        <label>Your name<input class="text-input" data-name maxlength="16" value="${esc(name)}"></label>
        <button class="btn primary" data-host><span>Host a room</span></button>
        <label>Room code<input class="text-input code" data-code maxlength="${NET.codeLength}" placeholder="ABCDE" autocomplete="off"></label>
        <button class="btn" data-join><span>Join</span></button>
      </div>
      <div class="online-status">${esc(status)}</div>
      <div class="row"><button class="btn small" data-back><span>Back</span></button></div>`;
    const nameIn = p.querySelector('[data-name]') as HTMLInputElement;
    const codeIn = p.querySelector('[data-code]') as HTMLInputElement;
    const statusEl = p.querySelector('.online-status') as HTMLElement;
    const busy = (msg: string) => {
      statusEl.textContent = msg;
      p.querySelectorAll('button').forEach((b) => (b.disabled = true));
    };
    const keepName = () => {
      save.data.name = nameIn.value.trim().slice(0, 16) || name;
      save.write();
      return save.data.name;
    };
    codeIn.addEventListener('input', () => (codeIn.value = codeIn.value.toUpperCase().replace(/[^A-Z0-9]/g, '')));
    p.querySelector('[data-host]')!.addEventListener('click', () => {
      busy('Opening a room…');
      void actions.host(keepName());
    });
    const join = () => {
      if (codeIn.value.length < NET.codeLength) {
        statusEl.textContent = `Enter the ${NET.codeLength}-letter room code.`;
        codeIn.focus();
        return;
      }
      busy('Joining…');
      void actions.join(codeIn.value, keepName());
    };
    p.querySelector('[data-join]')!.addEventListener('click', join);
    codeIn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') join();
    });
    p.querySelector('[data-back]')!.addEventListener('click', onBack);
    return p;
  }

  const host = net.isHost;
  const players = net.players
    .map((pl) => `<div class="online-player"><i style="background:${pl.color}"></i>${esc(pl.name)}${pl.id === net.selfId ? ' <span>(you)</span>' : ''}${pl.id === net.players[0]?.id ? ' <span>host</span>' : ''}</div>`)
    .join('');
  const bots = net.bots ? Math.max(0, NET.gridSize - net.players.length) : 0;
  p.innerHTML = `<h2 class="menu-heading">Room <span class="room-code">${net.code}</span></h2>
    <div class="menu-tag">${host ? 'Share this code so friends can join.' : 'Waiting for the host to start…'}</div>
    <div class="online-lobby">
      <div><div class="section-label">Riders (${net.players.length}/${NET.maxPlayers})</div>${players}${bots ? `<div class="online-player bots">+ ${bots} bot${bots > 1 ? 's' : ''}</div>` : ''}</div>
      <div class="online-settings">
        <div class="section-label">Mountain</div><div class="opts" data-maps></div>
        <div class="section-label">Bots</div><div class="opts" data-bots></div>
        <div class="opts" data-diff></div>
      </div>
    </div>
    <div class="online-status">${esc(status)}</div>
    <div class="row">${host ? '<button class="btn primary" data-start><span>Start race</span></button>' : ''}<button class="btn small" data-leave><span>Leave room</span></button></div>`;
  const seg = (sel: string, items: { label: string; on: boolean; pick: () => void; disabled?: boolean }[]) => {
    const box = p.querySelector(sel)!;
    for (const it of items) {
      const b = document.createElement('button');
      b.className = `btn small${it.on ? ' primary' : ''}`;
      b.innerHTML = `<span>${it.label}</span>`;
      b.disabled = !host || !!it.disabled;
      b.addEventListener('click', () => {
        it.pick();
        net.pushLobby();
      });
      box.appendChild(b);
    }
  };
  seg(
    '[data-maps]',
    MAP_ORDER.map((id) => ({ label: MAPS[id].name, on: net.map === id, pick: () => (net.map = id), disabled: !save.isMapUnlocked(id) })),
  );
  seg('[data-bots]', [
    { label: 'Fill with bots', on: net.bots, pick: () => (net.bots = true) },
    { label: 'Humans only', on: !net.bots, pick: () => (net.bots = false) },
  ]);
  if (net.bots) seg('[data-diff]', DIFFICULTIES.map((d) => ({ label: DIFFICULTY[d].label, on: net.difficulty === d, pick: () => (net.difficulty = d) })));
  p.querySelector('[data-start]')?.addEventListener('click', () => actions.start());
  p.querySelector('[data-leave]')!.addEventListener('click', () => actions.leave());
  return p;
}
