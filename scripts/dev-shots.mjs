// Dev server only: POST /__shot?name=x with an image data URL body saves it to .shots/x.jpg,
// so automated visual checks can read frames even when the browser pane is hidden.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function devShots() {
  return {
    name: 'dev-shots',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__shot', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        const name = (new URL(req.url ?? '', 'http://x').searchParams.get('name') ?? 'shot').replace(/[^\w-]/g, '');
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          const body = Buffer.concat(chunks).toString();
          const dir = resolve(process.cwd(), '.shots');
          mkdirSync(dir, { recursive: true });
          writeFileSync(resolve(dir, `${name}.jpg`), Buffer.from(body.slice(body.indexOf(',') + 1), 'base64'));
          res.end('ok');
        });
      });
    },
  };
}
