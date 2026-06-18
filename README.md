# Live Translate

Real-time broadcast translation powered by the Gemini Live API and LiveKit.

An organizer speaks into their mic — attendees pick a language and hear a live AI translation. Each language spins up exactly one Gemini Live API session, shared across all listeners requesting that language.

## How it works

```
Organizer → publishes audio → LiveKit room
                                  ↓
              TranslationBridge (per language)
              joins room as bot, subscribes to organizer audio
                                  ↓
              Gemini Live API (translationConfig)
              directionalTranslation → targetLanguageCode
                                  ↓
              Translated audio published back to LiveKit
                                  ↓
Attendee → subscribes to translator-{lang} audio track
```

## Prerequisites

- Node.js 18+
- A [Gemini API key](https://aistudio.google.com/apikey)
- A running LiveKit server (local or cloud)

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Start a local LiveKit server

The easiest way is with Docker:

```bash
docker run -d \
  --name livekit \
  -p 7880:7880 \
  -p 7881:7881 \
  -p 7882:7882/udp \
  -e LIVEKIT_KEYS="devkey: secret" \
  livekit/livekit-server \
  --dev
```

Or install the LiveKit CLI and run locally:

```bash
# Install (macOS)
brew update && brew install livekit

# Run
livekit-server --dev --bind 0.0.0.0
```

The default dev keys are `devkey` / `secret`, matching `.env.local`.

### 3. Configure environment

Edit `.env.local`:

```env
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
LIVEKIT_URL=ws://localhost:7880
GEMINI_API_KEY=your-gemini-api-key-here
BROADCAST_PASSWORD=optional-secure-password
```

### 4. Run the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploy to Cloud Run

We recommend deploying to Google Cloud Run since the translation bridges are long-running processes (WebSocket connections to Gemini and LiveKit) that require persistent containers and support for long-running requests.

### Prerequisites

- [Google Cloud CLI](https://cloud.google.com/sdk/docs/install) (`gcloud`)
- A [LiveKit Cloud](https://cloud.livekit.io) account (free tier: 50 participant-hours/month)

### Deploy

First, create secrets in Google Secret Manager (reads values from your `.env.local`):

```bash
source <(grep -v '^#' .env.local | sed 's/^/export /')

echo -n "$GEMINI_API_KEY" | gcloud secrets create gemini-api-key --data-file=-
echo -n "$LIVEKIT_API_KEY" | gcloud secrets create livekit-api-key --data-file=-
echo -n "$LIVEKIT_API_SECRET" | gcloud secrets create livekit-api-secret --data-file=-
```

Then deploy:

```bash
gcloud run deploy live-translate \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --min-instances 0 \
  --max-instances 1 \
  --timeout 3600 \
  --no-cpu-throttling \
  --set-secrets "\
GEMINI_API_KEY=gemini-api-key:latest,\
LIVEKIT_API_KEY=livekit-api-key:latest,\
LIVEKIT_API_SECRET=livekit-api-secret:latest" \
  --set-env-vars "\
LIVEKIT_URL=wss://your-project.livekit.cloud"
```

For subsequent deployments (code changes only, retaining existing secrets and environment variables):

```bash
gcloud run deploy live-translate --source . --region us-central1
```

Key settings:
- `--set-secrets` — injects secrets from Secret Manager at runtime (never stored in the image or Cloud Run config)
- `--min-instances 0` — allows the service to scale completely to zero when inactive to save costs
- `--max-instances 1` — the `TranslationSessionManager` singleton requires a single instance
- `--timeout 3600` — allows sessions up to 1 hour
- `--no-cpu-throttling` — keeps CPU allocated between requests (needed for audio processing, only billed when instances are active)

### Scaling & Resource Limits (Learnings from Live Events)

When running live events with high listener counts (e.g., 1k+ concurrent users) and multiple active translated languages (e.g., 20+ languages), pay close attention to the following resource and quota limits:

#### 1. Cloud Run CPU & Memory (OOM Protection)
* **The issue:** The `@livekit/rtc-node` SDK runs native C++ WebRTC client routines. Every active translation bridge opens a new PeerConnection and manages real-time audio encoding/decoding. This consumes ~20–30 MiB of RAM and ~10% of a vCPU core per language. 
* **The symptom:** If memory exceeds the default 512 MiB limit, the container will instantly crash with an Out-of-Memory (OOM) error, dropping all active listeners.
* **The fix:** For 15–20 active languages, allocate at least **4 vCPUs and 4 GiB of memory** (and up to 8 vCPUs / 32 GiB for larger scales):
  ```bash
  gcloud run services update live-translate --cpu 4 --memory 4Gi --region us-central1
  ```

#### 2. Concurrency Limit (Preventing "Rate exceeded")
* **The issue:** Cloud Run has a default concurrency limit of 80 requests. If 1,000 users try to join/refresh the page at the exact same instant (e.g., right when a link is shared), the excess requests will overflow the queue, and Google Front End (GFE) will reject them with a plain text `Rate exceeded.` error.
* **The fix:** Increase request concurrency on the container to the maximum of **1000**:
  ```bash
  gcloud run services update live-translate --concurrency 1000 --region us-central1
  ```
  *(Note: A 4 vCPU container is highly capable of generating thousands of JWT keys concurrently as it is a quick CPU cryptographic operation).*

#### 3. Provider Quota Settings (Gemini & LiveKit)
* **Gemini API Key:** You must use a **Paid Tier (Tiers 1–3)** Google AI Studio API key. The Free Tier enforces strict limits on concurrent active WebSocket connections (usually 3–5), which will cause bridges to disconnect or fail to start when translating multiple languages simultaneously.
* **LiveKit Cloud:** The Free Tier of LiveKit Cloud has a cap of **100 concurrent connections**. For large audiences, make sure your LiveKit Cloud account is upgraded to the metered paid plan (such as **Ship** or **Scale** tier) which unlocks unlimited concurrent participants.

#### 4. The Autoscaling Constraint
Because this demo architecture maintains active translation sessions via an in-memory singleton manager (`TranslationSessionManager`), **horizontal autoscaling must be locked to 1 instance** (`--max-instances 1`). Scaling out to multiple containers without database coordination (e.g., Redis) will result in multiple duplicate translation bot instances joining the same room.

#### 5. Dynamic "Scale to Zero" & Keep-Alive
* **The issue:** Since listeners connect directly to LiveKit and the bots stream audio over outbound connections, a container with `--min-instances 0` receives exactly 0 inbound HTTP requests during a broadcast. By default, Cloud Run would think the container is idle and shut it down mid-event.
* **The solution:** The broadcaster client page naturally queries the active translation status endpoint (`/api/translate/status`) every 3 seconds to monitor listeners. This continuous inbound polling traffic naturally keeps the Cloud Run container warm for the entire broadcast. 
* **The result:** You can safely deploy with `--min-instances 0` to pay absolutely nothing when the app is idle. The container automatically boots on the first request, stays alive during active broadcasts, and shuts down automatically 15 minutes after the broadcaster leaves.





## Security & Authentication (optional)

### 1. Simple Password Protection (Broadcasters Only)
To protect broadcast/session creation without restricting the public watch pages, you can set the `BROADCAST_PASSWORD` environment variable.

- **Local Dev**: Add `BROADCAST_PASSWORD=your-secret-password` to `.env.local`.
- **Cloud Run**: Create a secret in Google Secret Manager and bind it to your service using `--update-secrets`:
  ```bash
  # 1. Create the secret in Secret Manager
  echo -n "your-secret-password" | gcloud secrets create broadcast-password --data-file=-

  # 2. Update your Cloud Run service to mount the secret as an environment variable
  gcloud run services update live-translate \
    --region=us-central1 \
    --update-secrets="BROADCAST_PASSWORD=broadcast-password:latest"
  ```

When configured, the application will automatically prompt organizers for the password before creating a session or accessing the broadcast page. The password is cached in the host's `sessionStorage` to allow page reloads.

### 2. Full Access Control (Identity-Aware Proxy)
To restrict access to specific Google accounts, enable Identity-Aware Proxy (IAP). This adds a Google Sign-In page — only authorized users can access the app.

```bash
gcloud run services update live-translate --region us-central1 --iap
```

> **Note:** IAP locks down the entire app, including the attendee watch page. See [docs/authentication.md](docs/authentication.md) for full setup instructions.

## Usage

1. Click **Create session** — you'll be taken to the broadcast page
2. Allow microphone access and start speaking
3. Share the QR code (or URL) with attendees
4. Attendees open the link, pick a language from the dropdown
5. The server spins up a Gemini Live API translation bridge for that language
6. Subsequent attendees requesting the same language share the existing bridge

## Project structure

```
src/
├── app/
│   ├── api/
│   │   ├── sessions/          # Create/list/delete sessions
│   │   ├── token/             # LiveKit token generation
│   │   └── translate/         # Request translations, check status
│   ├── session/[id]/
│   │   ├── broadcast/         # Organizer view
│   │   └── watch/             # Attendee view + language selector
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx               # Landing page
├── components/
│   └── SessionQRCode.tsx
└── lib/
    ├── languages.ts                    # Supported languages
    ├── translation-bridge.ts           # LiveKit ↔ Gemini bridge
    └── translation-session-manager.ts  # Singleton: max 1 session/lang
```

## Key design decisions

- **Audio only** — no video, keeps things simple and bandwidth-light
- **`translationConfig`** — uses Gemini's native directional translation, not prompt-based
- **`@livekit/rtc-node`** — server-side bot joins the room programmatically (not a browser)
- **Singleton per language** — `TranslationSessionManager` ensures at most one Gemini session per language per room
- **Attendee audio switching** — client uses `setSubscribed()` to subscribe only to the selected translator bot's audio track
- **Reliable transcription delivery** — transcriptions are sent via `publishData` (reliable data channel), not tied to audio track subscription state
- **Tab close cleanup** — `navigator.sendBeacon()` fires on `beforeunload` to decrement subscriber counts and tear down idle Gemini sessions
- **Serial audio frame queue** — `captureFrame` calls are chained via a promise chain to avoid frame pile-up in the AudioSource FFI layer

## Architecture & scaling

### Current design (demo)

All participants — organizer, translator bots, and attendees — share a **single LiveKit room**. Attendees use `setSubscribed()` to hear only their selected language.

```
                    ┌─────────────────────┐
                    │    LiveKit Room      │
                    │                     │
  Organizer ──────▶ │  translator-fr ─┐   │ ◀── Attendee (FR)
                    │  translator-de ─┤   │ ◀── Attendee (DE)
                    │  translator-zh ─┘   │ ◀── Attendee (ZH)
                    └─────────────────────┘
```

**This works well for:**
- Up to ~15-20 simultaneous languages
- Up to ~50 attendees on a dev server, or ~200-300 on LiveKit Cloud

**Limitations:**
- **Signaling fan-out is O(n)**: every participant join/leave notifies all others. With 1000 attendees, each join sends ~1000 signaling messages.
- **Track publication overhead**: each attendee receives metadata for all published tracks (even the ones they don't subscribe to).
- **Single Node.js process**: all Gemini WebSocket connections and audio pipelines run in one process.

### Recommended production architecture

For large-scale deployments (100+ attendees, 20+ languages), use a **3-tier design** with per-language delivery rooms:

```
Tier 1 — Ingestion            Tier 2 — Translation         Tier 3 — Delivery
┌──────────────┐             ┌──────────────────┐         ┌─────────────────┐
│  Main Room   │             │  Worker (FR)     │         │  Room: sess-fr  │
│              │  subscribe  │  Gemini Live API │ publish │                 │
│  Organizer ──┼────────────▶│  FR translation  ├────────▶│  67 attendees   │
│  (publishes  │             └──────────────────┘         └─────────────────┘
│   audio)     │             ┌──────────────────┐         ┌─────────────────┐
│              │  subscribe  │  Worker (DE)     │ publish │  Room: sess-de  │
│              ├────────────▶│  Gemini Live API ├────────▶│  67 attendees   │
│              │             └──────────────────┘         └─────────────────┘
│              │             ┌──────────────────┐         ┌─────────────────┐
│              │  subscribe  │  Worker (ZH)     │ publish │  Room: sess-zh  │
│              ├────────────▶│  Gemini Live API ├────────▶│  67 attendees   │
└──────────────┘             └──────────────────┘         └─────────────────┘
```

**Benefits:**
- **Isolated failure domains** — a worker crash only affects one language
- **Horizontal scaling** — workers are stateless, deploy via Kubernetes/Cloud Run
- **No signaling storm** — each delivery room has 1 publisher + N attendees (no N² problem)
- **Unlimited languages** — each language is a separate, independently scaled room
- **CDN-ready** — for 10K+ viewers, use LiveKit Egress → HLS → CDN on the delivery rooms

**Tradeoff:** switching languages requires a room reconnection (~200ms audio gap), vs. instant subscription toggle in the single-room design.
