import './style.css';
import { loadRapier } from './physics/rapier';
import { Loading } from './ui/Loading';

async function boot(): Promise<void> {
  const loading = new Loading();
  loading.set(0.05, 'Loading physics engine…');
  await loadRapier();
  loading.set(0.4, 'Starting engine…');

  const { Game } = await import('./core/Game');
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const ui = document.getElementById('ui') as HTMLDivElement;
  const game = new Game(canvas, ui);

  const dev = import.meta.env.DEV ? (await import('./dev/DevTools')).installDevTools(game) : null;

  if (dev) game.onModeCreated = (m) => dev.attachMode(m);
  await game.init((p, msg) => loading.set(0.4 + p * 0.6, msg));
  if (dev && game.mode && !game.play) dev.attachMode(game.mode);
  loading.hide();
  game.start();
}

boot().catch((err: unknown) => {
  console.error(err);
  new Loading().error(err);
});
