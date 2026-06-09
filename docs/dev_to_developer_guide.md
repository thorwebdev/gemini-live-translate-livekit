# 🌐 Build a Realtime Translation App with Gemini Live API, LiveKit, & Google Cloud Run

Imagine speaking in English, and having listeners from all over the world hear you translated into Spanish, Japanese, or French — in real-time, with low latency, and natural vocal delivery. 

In this guide, we’ll build and deploy a **Real-Time Multilingual Translation Broadcast** web application. We'll leverage **Next.js** for the frontend, **LiveKit Cloud** for ultra-low latency WebRTC audio delivery, and the **Gemini Live API** to translate audio streams on the fly. 

Finally, we’ll containerize the entire application and deploy it as a production-ready, auto-scaling service on **Google Cloud Run**.

---

## Architecture

Our application runs entirely within a single LiveKit Room to keep signaling fast and simple:

```
Organizer (Speaking)
      │ (Vocal audio via WebRTC)
      ▼
LiveKit Room
  ├── TranslationBridge Bot ES (Gemini) ──► Spanish Audio Published
  ├── TranslationBridge Bot JA (Gemini) ──► Japanese Audio Published
  └── TranslationBridge Bot FR (Gemini) ──► French Audio Published
       │
       ▼ (Selected translation stream)
Attendees (Watch Page)
```

1. **The Ingest**: The host starts a broadcast. Their vocal audio is streamed to a LiveKit Room.
2. **On-Demand Spin-up**: When a listener joins and selects a language (e.g., Spanish), the Next.js backend spins up a dedicated background worker thread called the **Translation Bridge**.
3. **The WebRTC to WebSocket Pipe**: The worker connects to the LiveKit Room as a bot, subscribes to the host's audio track, and forwards the raw PCM audio frames over a WebSocket connection to the **Gemini Live API**.
4. **Vocal Translation**: Gemini processes the vocal stream and responds with real-time translated audio.
5. **Playback**: The bot publishes the translated audio track back to the LiveKit Room, and the listener renders that specific bot track.

---

## 🛠️ Prerequisites

Before we start, make sure you have:
* **Node.js 18+** installed locally.
* A [LiveKit Cloud Account](https://livekit.io/) (the free tier is perfect).
* A Google Cloud Project with the [gcloud CLI](https://cloud.google.com/sdk/gcloud) installed and authenticated.
* A [Gemini API Key](https://aistudio.google.com/) with access to the Live API models.

---

## 💻 Step-by-Step Setup Guide

### Step 1: Install Dependencies
Navigate to the root of the project and install the NPM packages:
```bash
npm install
```

### Step 2: Start a Local LiveKit Server
If you want to test the setup locally, you can easily spin up a local LiveKit development server using Docker:

```bash
docker run --rm -p 7880:7880 -p 7881:7881 -p 7882:7882/udp \
  -e LIVEKIT_KEYS="devkey: secret" \
  livekit/livekit:latest \
  --dev
```

### Step 3: Configure Environment Variables
Create a `.env.local` file in the root of the project. This will be used for your local environment:

```env
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
NEXT_PUBLIC_LIVEKIT_URL=ws://localhost:7880
LIVEKIT_URL=ws://localhost:7880
GEMINI_API_KEY=your-gemini-api-key-here
```

### Step 4: Run the Application Locally
Launch the Next.js development server:
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to view the application. Open one tab as the **Broadcast** (host) and another tab to **Watch** (attendee) to test translation.

---

## ⚡ Latency & Performance Optimization: 100ms Chunks

When dealing with real-time WebRTC streams, standard packet delivery operates on a **20ms** interval. Delivering audio chunks to the Gemini Live API at 50 Hz (50 times per second) results in high network overhead and CPU cycles.

To optimize performance, we configure LiveKit's native FFI audio stream to capture **100ms chunks** instead.

In [translation-bridge.ts](file:///Users/schaeff/Documents/code/gemini-live/gemini-live-translate-livekit/src/lib/translation-bridge.ts), we initialize the `AudioStream` with an `AudioStreamOptions` object:

```typescript
const audioStream = new AudioStream(track, {
  sampleRate: this.inputSampleRate,
  numChannels: this.channels,
  frameSizeMs: 100, // Deliver 100ms frames to optimize transmission frequency
});
```

### Why do this?
* **Frequency Drop:** This drops the transmission frequency to Gemini from **50 Hz to 10 Hz** (10 times per second).
* **The Trade-Off:** This dramatically reduces network/CPU serialization overhead on the server, with only a minor latency increase (~80ms).

---

## 🐳 Step 5: Containerizing with Docker

Next.js's standalone output builds yield highly optimized production bundles containing only the exact files needed for deployment.

The `@livekit/rtc-node` SDK uses a native compiled WebRTC core. During initialization, this core makes HTTPS requests to verify Cloud settings. Bare-minimum Linux images like `node:slim` do not ship with SSL certificates, which can cause the secure connection to fail silently. We explicitly install `ca-certificates` in our multi-stage `Dockerfile`:

```dockerfile
# --- Build stage ---
FROM node:22-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- Production stage ---
FROM node:22-slim AS runner
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 8080
CMD ["node", "server.js"]
```

---

## 🚀 Step 6: Deploying to Google Cloud Run

We recommend deploying to Google Cloud Run since the translation bridges are long-running processes (WebSocket connections to Gemini and LiveKit) that require persistent containers and support for long-running requests.

### 1. Store Secrets in Google Secret Manager
Instead of exposing credentials in env vars, store them in Google Secret Manager:

```bash
source <(grep -v '^#' .env.local | sed 's/^/export /')

echo -n "$GEMINI_API_KEY" | gcloud secrets create gemini-api-key --data-file=-
echo -n "$LIVEKIT_API_KEY" | gcloud secrets create livekit-api-key --data-file=-
echo -n "$LIVEKIT_API_SECRET" | gcloud secrets create livekit-api-secret --data-file=-
```

### 2. Grant Secret Access Permissions to Cloud Run
Grant the Default Compute Engine Service Account access to read these secrets:

```bash
PROJECT_NUMBER=$(gcloud projects describe $(gcloud config get-value project) --format="value(projectNumber)")

gcloud secrets add-iam-policy-binding gemini-api-key \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding livekit-api-key \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding livekit-api-secret \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

### 3. Deploy the Service
Run the deployment command. Note the specific Cloud Run production scaling configurations required:
* `--min-instances 1`: Keeps the container warm so active sessions aren't killed.
* `--max-instances 1`: The `TranslationSessionManager` singleton requires a single instance.
* `--timeout 3600`: Allows translation sessions up to 1 hour.
* `--no-cpu-throttling`: Keeps CPU allocated between requests to ensure zero audio processing lag.

```bash
gcloud run deploy live-translate \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --min-instances 1 \
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

### 4. Deploying Future Code Updates (Without Changing Env Vars)
Once your service configuration and secrets are set, you can deploy code updates without repeating or redefining the environment variables:

```bash
gcloud run deploy live-translate --source . --region us-central1
```
Google Cloud Run automatically preserves all environment variables, secrets, scaling limits, and CPU allocations from the previous revision.

---

## 🎉 Conclusion

You now have a fully functional, production-ready Real-Time Multilingual Translation Broadcast app deployed on Google Cloud Run!

### What we learned:
* How to bridge **LiveKit WebRTC audio** with the **Gemini Live API** to translate spoken streams in real-time.
* How to tweak native FFI stream options (`frameSizeMs: 100`) to optimize network packet overhead.
* How to set up Google Secret Manager and deploy robust multi-stage docker setups to Google Cloud Run.

Happy broadcasting! 🌐🎙️
