# Contributors guide

Thanks for wanting to improve NonStop Router.

## Setup

```bash
git clone https://github.com/skr-electronics-lab/nonstop-router.git
cd nonstop-router
npm install
npm run dev        # server (tsx watch) + Vite dev client
```

- Gateway API: http://127.0.0.1:4000
- Dashboard (dev): http://localhost:5173

## Before opening a pull request

```bash
npm run typecheck   # TypeScript checks for server + client
npm run build       # must succeed with no errors
```

- Keep changes focused and consistent with the surrounding code style.
- Never commit secrets, `~/.nonstop`, or database files.
- If you change behavior, update the README.

## Project layout

```
src/server/   Hono gateway, router engine, providers, cache, MCP, crypto
src/client/   React + Vite dashboard
src/shared/   Types shared by server and client
```

## Reporting issues

Please include your OS, Node version, the command you ran, and the full error output.