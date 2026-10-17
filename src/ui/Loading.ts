/** Drives the static loading overlay defined in index.html. */
export class Loading {
  private root = document.getElementById('loading') as HTMLDivElement;
  private fill = this.root.querySelector('.loading-fill') as HTMLDivElement;
  private text = this.root.querySelector('.loading-text') as HTMLDivElement;

  set(progress: number, message: string): void {
    this.fill.style.width = `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`;
    this.text.textContent = message;
  }

  show(message = 'Loading…'): void {
    this.root.classList.remove('hidden');
    this.set(0, message);
  }

  hide(): void {
    this.root.classList.add('hidden');
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
