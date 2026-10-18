/** Short tips shown while loading (rotated). */
const TIPS = [
  'Hold Q (LB on a pad) mid-run to open the vehicle wheel and switch rides.',
  'Hit the lip and press jump right at the top for extra pop.',
  'Land your flips straight: a clean landing banks the trick combo.',
  'Brush past trees and rivals at speed for near-miss boost.',
  'Bottle pickups give 3 throws: F or Y auto-aims at the nearest rider.',
  'Vehicle stations lend you their ride for the rest of the run.',
  'Hidden gold tokens sit well off the trail: follow the light beams.',
  'Shields block one knockout. Time Freeze stops your clock.',
  'Ride online: host a room and share the 5-letter code with friends.',
];

/** Drives the loading overlay defined in index.html (progress trail, map line, rotating tips). */
export class Loading {
  private root = document.getElementById('loading') as HTMLDivElement;
  private fill = this.root.querySelector('.loading-fill') as HTMLDivElement;
  private text = this.root.querySelector('.loading-text') as HTMLDivElement;
  private pct = this.root.querySelector('.loading-pct') as HTMLDivElement;
  private meta = this.root.querySelector('.loading-meta') as HTMLDivElement;
  private tip = this.root.querySelector('.loading-tip') as HTMLDivElement;
  private tipTimer = 0;
  private tipIndex = Math.floor(Math.random() * TIPS.length);

  constructor() {
    this.nextTip();
  }

  private nextTip(): void {
    if (!this.tip) return;
    this.tipIndex = (this.tipIndex + 1) % TIPS.length;
    this.tip.classList.remove('in');
    void this.tip.offsetWidth;
    this.tip.innerHTML = `<b>Tip</b>${TIPS[this.tipIndex]}`;
    this.tip.classList.add('in');
    window.clearTimeout(this.tipTimer);
    this.tipTimer = window.setTimeout(() => this.nextTip(), 4500);
  }

  set(progress: number, message: string): void {
    const p = Math.max(0, Math.min(1, progress));
    this.fill.style.width = `${Math.max(2, Math.round(p * 100))}%`;
    if (this.pct) this.pct.textContent = `${Math.round(p * 100)}%`;
    this.text.textContent = message;
  }

  /** `title` names what's loading (e.g. a mountain); omitted = the game itself. */
  show(message = 'Loading…', title = ''): void {
    this.root.classList.remove('hidden');
    if (this.meta) this.meta.innerHTML = title;
    this.set(0, message);
    this.nextTip();
  }

  hide(): void {
    this.root.classList.add('hidden');
    window.clearTimeout(this.tipTimer);
  }

  error(err: unknown): void {
    this.root.classList.remove('hidden');
    this.text.textContent = 'Something went wrong while loading.';
    const pre = document.createElement('div');
    pre.className = 'loading-error';
    pre.textContent = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
    this.root.querySelector('.loading-inner')?.appendChild(pre);
  }
}
