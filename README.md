# Live Translate

Multi-language video calls. Everyone picks their language. Translation spins up on demand.

Powered by [LiveKit Agents](https://docs.livekit.io/agents/) (Python worker) and the [Gemini Live API](https://ai.google.dev/gemini-api/docs/live).

![architecture](https://img.shields.io/badge/architecture-peer--call-1A1917) ![agent](https://img.shields.io/badge/agent-python-3776AB) ![web](https://img.shields.io/badge/web-nextjs-000000)

---

## What it does

Anyone with the link joins as a peer. Each participant picks one language — that's what they speak **and** what they want to hear everyone else in. When someone speaks, a Gemini Live session translates their audio into every other distinct language present in the room, on demand. Same-language pairs hear each other natively, no Gemini cost.

- 8-person rooms by default (configurable)
- 16 supported languages plus "None — native passthrough"
- Camera + mic default off; toggle on when you're ready
- Captions sidebar (per listener, in their chosen language) with auto-scroll transcripts
- LiveKit Cloud Agents-ready: deploy the Python worker, the frontend dispatches it via room config on token mint

## How it works

```
                    ┌─────────────────────────────┐
                    │       LiveKit Room          │
                    │                             │
   Alice (EN) ─────▶│  mic + camera tracks        │◀──── Bob (ES)
                    │                             │
                    │  ┌───────────────────────┐  │
                    │  │ Translator agent      │  │
                    │  │ (Python worker)       │  │
                    │  │                       │  │
                    │  │ tx:alice:es  ─audio─┐ │  │
                    │  │ tx:bob:en    ─audio─┤ │  │
                    │  │                     │ │  │
                    │  │ TextStream("lk.translation",
                    │  │   target_lang=es, ...)  │
                    │  └───────────────────────┘  │
                    └─────────────────────────────┘
                                  │
                ▼                                    ▼
   Alice subscribes to                Bob subscribes to
   tx:bob:en  (en translation)        tx:alice:es  (es translation)
```

Each participant's chosen language lives in their LiveKit `attributes.lang`. The Python agent watches `participantAttributesChanged`, reconciles a `(speaker, target_lang)` session map, and publishes one translator track per pair (skipping pairs where source == target). The frontend subscribes to either the native mic or the matching translator track based on the same predicate.

## Quick start

You need:
- Node.js 20+, npm
- Python 3.11+, [uv](https://docs.astral.sh/uv/)
- A [LiveKit Cloud](https://cloud.livekit.io) project (free tier works)
- A [Gemini API key](https://aistudio.google.com/apikey)

```bash
# 1. Set up env — both the web app and the agent need credentials
cat > .env.local <<EOF
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
GEMINI_API_KEY=
EOF
cp .env.local translator/.env.local

# 2. Install
npm install
(cd translator && uv sync)

# 3. Run both processes in two terminals
npm run dev                                          # Next.js on :3000
(cd translator && uv run python src/agent.py dev)    # Agent worker
```

Open <http://localhost:3000>, click **Create session**, share the URL with another browser, pick different languages, unmute.

## Repo layout

```
gemini-live-translate-livekit/
├── src/                                # Next.js 16 frontend
│   ├── app/
│   │   ├── page.tsx                    # Landing
│   │   ├── api/token/route.ts          # Mints token + dispatches translator agent
│   │   └── session/[id]/
│   │       ├── page.tsx                # Pre-flight (name + language)
│   │       └── room/                   # In-call UI
│   │           ├── RoomClient.tsx
│   │           ├── InCall.tsx
│   │           ├── VideoGrid.tsx       + ParticipantTile, SelfView
│   │           ├── ControlBar.tsx      + LanguagePill
│   │           ├── CaptionsSidebar.tsx
│   │           └── useTranslationRouting.ts
│   └── lib/
│       ├── languages.ts                # 16 languages + "none" sentinel
│       └── config.ts                   # Caps, attribute keys
└── translator/                         # Python LiveKit Agents worker
    ├── src/
    │   ├── agent.py                    # @server.rtc_session(agent_name="translator")
    │   ├── router.py                   # TranslationRouter (reconcile loop)
    │   ├── session.py                  # GeminiSession (one per speaker→target pair)
    │   ├── audio.py                    # PCM glue
    │   └── config.py                   # Model id, debounce, grace, etc.
    ├── tests/test_router.py            # Demand-set computation
    ├── pyproject.toml
    ├── Dockerfile                      # For LiveKit Cloud Agents deploy
    └── livekit.toml
```

## Deploy

**Agent** — to LiveKit Cloud Agents:
```bash
cd translator
lk agent create --secrets-file .env.local .   # first time
lk agent deploy                               # subsequent deploys
```

**Frontend** — anywhere that runs Next.js. The repo includes a `Dockerfile` for container deploys (Cloud Run, Fly.io, Render, etc.). For Vercel, no special config needed since the only API route is `/api/token` and it's stateless.

Set on the frontend host:
- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`

Set on the agent host:
- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `GEMINI_API_KEY`

## Configuration

Caps in `src/lib/config.ts` and `translator/src/config.py` — adjust together:

| Setting | Default | Where |
|---|---|---|
| Max participants per room | 8 | `MAX_PARTICIPANTS` (token route) |
| Session TTL | 4h | token route `ttl` |
| Empty-room timeout | 60s | token route |
| Idle disconnect | 15min | client (TBD) |
| Session grace on mute | 10s | `SESSION_GRACE_SEC` (agent) |
| Reconcile debounce | 250ms | `RECONCILE_DEBOUNCE_SEC` (agent) |
| Gemini model | `gemini-3.1-flash-lite-live-translate` | `GEMINI_MODEL` (agent) |

## Tech stack

- **Frontend** — Next.js 16 (Turbopack), React 19, `@livekit/components-react`, `livekit-client`
- **Token mint** — `livekit-server-sdk` (`RoomAgentDispatch` + `RoomConfiguration`)
- **Agent runtime** — `livekit-agents` 1.5 with `AgentServer.rtc_session()`
- **Translation** — `google-genai` Live API (`client.aio.live.connect()` with `streamingTranslationConfig`)
- **Audio I/O** — `livekit.rtc.AudioStream` (16 kHz mono in) + `AudioSource` (24 kHz mono out)
- **Typography** — Instrument Serif (display), DM Sans (body), DM Mono (status)
- **Package management** — `npm` + `uv`

## License

MIT
