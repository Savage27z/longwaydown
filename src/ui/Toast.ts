/** Small transient message pill at the top of the screen. */
export class Toast {
  private el = document.createElement('div');
  private timer = 0;

  constructor(parent: HTMLElement) {
    this.el.className = 'toast';
    parent.appendChild(this.el);
  }

  show(text: string, ms = 1600): void {
    this.el.textContent = text;
    this.el.classList.add('show');
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.el.classList.remove('show'), ms);
  }

  dispose(): void {
    window.clearTimeout(this.timer);
    this.el.remove();
  }
}
