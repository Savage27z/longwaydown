/**
 * Yield to the event loop. Uses a timer while the page is visible; in hidden tabs, where browsers
 * throttle timers to one per second (or per minute), it uses a MessageChannel task instead so
 * loading and automation keep moving.
 */
export function yieldTask(ms = 0): Promise<void> {
  if (typeof document !== 'undefined' && document.hidden) {
    return new Promise((resolve) => {
      const c = new MessageChannel();
      c.port1.onmessage = () => resolve();
      c.port2.postMessage(0);
    });
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}
