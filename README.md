<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/assets/logo-stacked.svg">
    <source media="(prefers-color-scheme: light)" srcset="public/assets/logo-stacked-on-light.svg">
    <img alt="NonStop Router" src="public/assets/logo-stacked.svg" width="360">
  </picture>
</p>

<h1 align="center">NonStop Router</h1>

<p align="center">
  <strong>A local-first LLM gateway that keeps your AI coding tools running when a provider rate-limits, breaks, or goes dark.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/nonstop-router"><img alt="npm version" src="https://img.shields.io/npm/v/nonstop-router?color=E8590C&label=npm"></a>
  <a href="https://www.npmjs.com/package/nonstop-router"><img alt="npm downloads" src="https://img.shields.io/npm/dm/nonstop-router?color=E8590C"></a>
  <a href="https://github.com/skr-electronics-lab/nonstop-router/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/skr-electronics-lab/nonstop-router/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="License: AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-blue"></a>
  <img alt="Node" src="https://img.shields.io/badge/node-%3E%3D20-brightgreen">
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey">
</p>

<p align="center">
  <strong>English</strong> &bull; <a href="README_RU.md">Русский</a>
</p>

<p align="center">
  <a href="#-quickstart">Quickstart</a> &bull;
  <a href="#-how-it-works">How It Works</a> &bull;
  <a href="#-supported-tools">Supported Tools</a> &bull;
  <a href="#-features">Features</a> &bull;
  <a href="#-api-reference">API Reference</a> &bull;
  <a href="#-security">Security</a> &bull;
  <a href="#-faq">FAQ</a>
</p>

---

## What is NonStop Router?

NonStop Router is a **local proxy** that sits between your AI coding agents (OpenCode, Claude Code, Codex CLI, Cline, Aider, Continue, Zed, …) and the model providers you use. You point every tool at one local URL, and the router handles:

- **Failover** — if a key hits `429`, `5xx`, `401/403`, or times out, the request is retried on the next key or the next model automatically.
- **Key pooling** — pool multiple API keys per provider and spread load across them.
- **One endpoint, many providers** — OpenAI, Anthropic, Google Gemini, and any OpenAI-compatible API behind a single `http://127.0.0.1:4000/v1` URL.
- **Local dashboard** — inspect providers, models, chains, live request logs, and usage.

It runs entirely on your machine, stores everything in a local SQLite database, encrypts your provider keys at rest, and **never sends telemetry anywhere**.

> **Why?** Free tiers and shared keys run out of quota constantly. NonStop Router turns "rate limited, try again later" into "silently switched to a healthy model mid-session."

---

## ✨ Features

| | |
|---|---|
| 🔁 **Transparent failover** | Retries across keys and models on `429`, `5xx`, `401/403`, timeouts, and pre-token stream drops. |
| 🗝️ **Key pools** | Multiple keys per provider with `round-robin`, `fill-first`, and `least-used` strategies. |
| 🧩 **Multi-protocol** | OpenAI Chat Completions, Anthropic Messages, and OpenAI Responses APIs — with bidirectional translation. |
| 🎯 **Failover chains** | Ordered model chains in **Priority** mode (return to #1 on recovery) or **Sticky** mode (latch onto the working target). |
| 🧠 **Auto model discovery** | Pulls `/v1/models` from each provider and enriches entries with context window, tool, vision, and pricing metadata from [models.dev](https://models.dev). |
| 💸 **Free-tier chains** | One-click auto-build of a chain that prefers `:free` and local models; optional paid fallback with a hard cap. |
| 🚦 **Rate governor** | Rolling per-key RPM tracking that rotates keys *before* the upstream returns `429`. |
| ⚡ **Response cache** | Exact-match cache on SQLite (keyed by messages, model, and all sampling params). Repeat prompts return in milliseconds at zero cost. |
| 🩺 **Health prober** | Background probing recovers cooling/down keys automatically. |
| 🔌 **MCP server** | Expose gateway status and model lists to MCP-capable agents at `/mcp`. |
| 🔐 **Encrypted keys** | Upstream keys encrypted at rest with AES-256-GCM; only masked values are ever returned by the API. |
| 🖥️ **Local dashboard** | React UI to manage providers, keys, models, chains, connect configs, and live logs. |
| 🧾 **One-click tool setup** | Generates and (optionally) writes config for OpenCode, Continue, and Aider with automatic backup + diff preview. |

---

## 🚀 Quickstart

### Prerequisites

- **Node.js 20 or newer** ([download](https://nodejs.org))
- At least one provider API key (OpenAI, Anthropic, Google, Groq, DeepSeek, OpenRouter, …) — or a local [Ollama](https://ollama.com) / [LM Studio](https://lmstudio.ai) install

### Install & run

```bash
npx nonstop-router
```

That's it. The gateway starts on `http://127.0.0.1:4000` and opens the dashboard in your browser.

### Global install (optional)

```bash
npm install -g nonstop-router
nonstop-router
```

### CLI options

```text
-p, --port <number>   Port to run on (default: 4000, or the PORT env var)
    --host <string>   Interface to bind (default: 127.0.0.1)
    --no-open         Do not open the dashboard in a browser
-v, --version         Print version
-h, --help            Show help
```

### From source

```bash
git clone https://github.com/skr-electronics-lab/nonstop-router.git
cd nonstop-router
npm install
npm run build
npm start
```

### Docker

```bash
docker build -t nonstop-router .
docker run -d --name nonstop-router \
  -p 4000:4000 \
  -v nonstop-data:/home/nonstop/.nonstop \
  nonstop-router
```

---

## 🔧 First-time setup

1. Start the router (`npx nonstop-router`).
2. Open the dashboard at **http://127.0.0.1:4000**.
3. Go to **Providers → Add Provider**, pick a preset (or paste a custom base URL), and enter an API key. Models are discovered automatically.
4. (Optional) Add more keys to a provider to enable key pooling, or add multiple providers.
5. Go to **Chains** and set your failover order — or click **Auto-Build Free Chain** to prefer free models.
6. Go to **Connect**, copy the snippet for your tool (or use one-click setup), and point it at `http://127.0.0.1:4000/v1` with your **gateway key**.

> The **gateway key** (starts with `nsk_live_`) is different from your provider keys. It authenticates *your tools* to the router and is generated on first run (see **Settings → Local Gateway API Keys**).

---

## 🧭 How It Works

```
   OpenCode / Claude Code / Codex / Cline / Aider
                        │
                        │  model = "auto"
                        ▼
        ┌───────────────────────────────────┐
        │   NonStop Router  :4000           │
        │   (localhost only)                │
        └───────────────────────────────────┘
                        │
             Chain resolution for "auto"
                        │
    ┌───────────────────┼────────────────────┐
    ▼                   ▼                    ▼
 Target 1            Target 2             Target 3
 Provider A          Provider B           Local (Ollama)
 ┌──────────┐        ┌──────────┐         ┌──────────┐
 │ Key 1 ✅ │        │ Key 1 ✅ │         │ llama3   │
 │ Key 2 ⏳ │        │          │         │          │
 └──────────┘        └──────────┘         └──────────┘
    │ 429 / 5xx / timeout
    └──────────► try Key 2 ──► try Target 2 ──► Target 3 ──► ✉ clean error
```

### Failure triggers

| Trigger | Action |
|---|---|
| `429 Too Many Requests` | Cooldown the key (honoring `Retry-After` when present), try the next key. |
| `500 / 502 / 503 / 504` | Cooldown the key with exponential backoff, try the next key. |
| `401 / 403` | Mark the key **down**, try the next key. |
| Connection timeout / socket drop | Cooldown the key, try the next key. |
| Stream dies before the first token | Retry the whole request on the next target. |

### Recovery

- Cooling keys return **automatically** when their cooldown expires.
- A background **health prober** actively tests down/cooling keys and restores them when healthy.
- `Retry-After` and `x-ratelimit-reset-*` headers are respected; otherwise exponential backoff (`30s → 60s → 120s → …`, capped at `300s`) is applied.

### Chain modes

- **Priority** (default): always returns to the highest-priority healthy target as soon as it recovers.
- **Sticky**: latches onto the first target that works and stays there until it fails, maximizing cache/session continuity.

### Key selection strategies

A *chain* decides **which provider** gets the request; a provider's *selection strategy*
decides **which key** inside that provider is used. Every strategy skips keys that are
disabled, `down`, or still `cooling_down`, and every strategy fails over to the next key
on error — the difference is only the order in which healthy keys are tried.

| Strategy | How it picks a key | Best for | Trade-off |
|---|---|---|---|
| **Round Robin** *(default)* | Rotates through the key list, one request each, wrapping around. | Spreading load evenly across many keys of the same provider. | Can hit a key that has little quota left when others have plenty. |
| **Fill First** | Always uses the first available key (in the order you added them) until it fails or cools down, then moves to the next. | Maximizing **prompt-cache** hits — one key keeps a warm context. | Concentrates load on one key; you hit its rate limit sooner. |
| **Least Used** | Picks the key with the **lowest total request count** so far, keeping the pool balanced over time. | Mixed pools where keys have different quotas/ages and you want even wear. | Ignores recency — a key that just recovered may look "unused" and get hammered. |

**Which is better?** There is no single winner — pick by what you value:

- **Throughput / avoiding 429s across many keys → Round Robin.** Deterministic, fair, and
  it exercises every key so a single hot key can't starve the pool. This is why it ships as
  the default.
- **Lowest latency & cost on cached prompts → Fill First.** Provider prompt caching is
  per-key, so pinning traffic to one secondary key keeps its cache warm and cuts both
  latency and input-token cost. Use it when one key has a large quota.
- **Even wear / mixed quotas → Least Used.** Good when keys were added at different times or
  have different tier limits and you want the long-run distribution to equalize.

In practice the differences matter far less than **failover** — that is the whole point of
NonStop Router. All three strategies cooldown a failing key and immediately retry the next
one, so a bad key never blocks a request regardless of strategy. Start with **Round Robin**;
switch to **Fill First** only if you specifically want prompt-cache locality on one key.

> The Live Flow page shows the active strategy on each provider node, and the key pool
> panel lists per-key token and request totals so you can see the distribution in real time.

---

## 🔌 Supported Tools

| Tool | How to connect |
|---|---|
| **OpenCode CLI** | One-click writer in the dashboard, or merge the generated provider block into `~/.config/opencode/opencode.jsonc`. |
| **Claude Code** | `ANTHROPIC_BASE_URL=http://127.0.0.1:4000`, `ANTHROPIC_AUTH_TOKEN=<gateway key>`, `ANTHROPIC_MODEL=auto`. |
| **Codex CLI** | `OPENAI_BASE_URL=http://127.0.0.1:4000/v1`, `OPENAI_API_KEY=<gateway key>`. |
| **Cline / Roo Code** | Provider: *OpenAI Compatible* · Base URL `http://127.0.0.1:4000/v1` · Model `auto`. |
| **Continue** | `provider: openai`, `apiBase: http://127.0.0.1:4000/v1`. |
| **Aider** | `OPENAI_API_BASE=http://127.0.0.1:4000/v1`, `OPENAI_API_KEY=<gateway key>`, `aider --model openai/auto`. |
| **Zed** | `language_models.openai.api_url = http://127.0.0.1:4000/v1`. |
| **Any OpenAI SDK** | Point `base_url` at `http://127.0.0.1:4000/v1`. |

The **Connect** page in the dashboard generates ready-to-paste snippets for all of the above and writes config files (with a backup and diff preview) for OpenCode, Continue, and Aider.

---

## 🌐 Supported Providers

Presets ship for **Token Harbor, OpenAI, Anthropic, DeepSeek, OpenRouter, Groq, Together AI, Mistral, xAI (Grok), Google Gemini, Ollama, and LM Studio**. Any OpenAI-compatible endpoint works too — just enter its base URL.

---

## 📚 API Reference

All gateway endpoints require your **gateway key** via `Authorization: Bearer <key>` or `x-api-key`.

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/v1/chat/completions` | OpenAI Chat Completions (streaming + non-streaming). |
| `POST` | `/v1/messages` | Anthropic Messages API (for Claude Code). |
| `POST` | `/v1/responses` | OpenAI Responses API (for Codex CLI). |
| `GET` | `/v1/models` | Lists chains, enabled models, and universal aliases. |
| `POST` | `/mcp` | Model Context Protocol (JSON-RPC) endpoint. |

Request `model: "auto"` to use the default failover chain, or the name of any specific chain or model.

```bash
curl http://127.0.0.1:4000/v1/chat/completions \
  -H "Authorization: Bearer $NONSTOP_GATEWAY_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"Hello!"}]}'
```

The management API under `/api/*` powers the dashboard and requires the admin token (injected into the dashboard page).

---

## 🔒 Security

- **Localhost by default.** The gateway binds to `127.0.0.1`. Enabling LAN access is an explicit, clearly-labelled opt-in in Settings.
- **Encrypted at rest.** Provider keys are encrypted with **AES-256-GCM**. The 256-bit master key lives in `~/.nonstop/master.key` with restrictive permissions.
- **Keys are masked.** Upstream and gateway keys are shown masked (`sk-…1234`) everywhere and are never returned by list/detail APIs.
- **Admin + gateway auth.** `/api/*` requires an admin token; `/v1/*` requires a gateway key. Tokens are compared in constant time.
- **No telemetry.** Nothing about your usage leaves your machine. The only outbound calls are the ones you configure, plus a metadata fetch from `models.dev` (cached locally, and skippable offline).

> **Never expose the gateway directly to the public internet.** It is designed for local/trusted-network use. If you enable LAN access, put it behind a reverse proxy with TLS and its own authentication.

---

## ⚙️ Configuration

Settings live in the dashboard (**Settings**) and in the SQLite DB at `~/.nonstop/router.sqlite`. Highlights:

| Setting | Default | Meaning |
|---|---|---|
| `defaultRequestTimeoutMs` | `60000` | Per-attempt upstream timeout before failing over. |
| `cooldownBaseMs` / `cooldownMaxMs` | `30000` / `300000` | Exponential backoff bounds for failing keys. |
| `healthProbeIntervalMs` | `30000` | How often down keys are re-probed. |
| `enableCache` / `cacheTtlMs` / `cacheMaxEntries` | `true` / `24h` / `2000` | Exact-match response cache. |
| `enableRateGovernor` / `rateGovernorRpm` | `true` / `25` | Rolling per-key RPM ceiling. |
| `enablePromptOptimizer` | `false` | Lossy prompt trimming (off by default). |
| `storePayloads` | `false` | Store request/response bodies in logs (privacy-sensitive). |
| `allowLan` | `false` | Bind to `0.0.0.0` instead of `127.0.0.1`. |
| `chainAutoPolicy` | `free_only` | Default policy for auto-built chains. |

### Data locations

| Path | Contents |
|---|---|
| `~/.nonstop/router.sqlite` | Providers, keys, models, chains, logs, settings. |
| `~/.nonstop/master.key` | AES-256 master key for encrypting provider keys. |

Back up `~/.nonstop/` to preserve your configuration.

---

## 🧑‍💻 Development

```bash
npm install
npm run dev        # server (tsx watch) + Vite dev client
npm run typecheck  # TypeScript checks for server + client
npm run build      # production build
npm start          # run the built server
```

Project layout:

```
src/
  server/   Hono gateway, router engine, providers, cache, MCP, crypto
  client/   React + Vite dashboard
  shared/   Types shared by server and client
```

---

## ❓ FAQ

<details>
<summary><strong>Is my data sent anywhere?</strong></summary>

No. The router runs locally and stores everything in `~/.nonstop`. Besides the providers you configure, the only outbound request is an optional model-metadata fetch from `models.dev` (cached for 24h, and it degrades gracefully offline).
</details>

<details>
<summary><strong>What's the difference between the gateway key and my provider keys?</strong></summary>

Your **provider keys** (OpenAI, Anthropic, …) are stored encrypted and used to call the upstreams. The **gateway key** (`nsk_live_…`) is what your local tools use to authenticate to the router. They never leave your machine.
</details>

<details>
<summary><strong>Can it fail over mid-stream?</strong></summary>

If the upstream dies **before the first token**, the router transparently retries on the next target. Once tokens have been delivered, failover can't happen without corrupting the client's output — enable **Restart on Mid-Stream Failure** in Settings if you want the request restarted from scratch on the fallback target (at the cost of discarding the partial response).
</details>

<details>
<summary><strong>Does it work offline / with local models?</strong></summary>

Yes. Point it at Ollama (`http://127.0.0.1:11434/v1`) or LM Studio (`http://127.0.0.1:1234/v1`). Local runners are automatically demoted to the end of every chain so they act as an always-available safety net.
</details>

<details>
<summary><strong>Why does npm install need a compiler?</strong></summary>

`better-sqlite3` is a native module. Prebuilt binaries exist for common platforms; otherwise a C++ toolchain is used. The Docker image installs the build deps for you.
</details>

---

## 🤝 Contributing

Issues and pull requests are welcome.

1. Fork the repo and create a feature branch.
2. Run `npm run typecheck` and `npm run build` before opening a PR.
3. Keep changes focused and consistent with the surrounding code.

---

## 📄 License

Licensed under the **GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)**.

You are free to use, study, modify, and self-host this software. If you distribute it — or run a modified version as a network service — you **must** release your source under the same license and **keep the original authorship and copyright notices intact**. You may not take this project, rebrand it, and present it as your own. See [LICENSE](LICENSE) for the full text.

<p align="center">
  <sub>Built for developers who are tired of <code>429 Too Many Requests</code>.</sub>
</p>