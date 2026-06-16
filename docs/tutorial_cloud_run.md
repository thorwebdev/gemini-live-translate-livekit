# Build & Deploy a Real-Time Multilingual Broadcast App with Gemini Live & LiveKit on Google Cloud Run

Imagine giving a presentation in English, and having listeners from around the world instantly hear your voice translated into Spanish, Japanese, or French — in real-time, with sub-second latency, and natural vocal delivery. 

In this tutorial, we will build and deploy a **Real-Time Multilingual Translation Broadcast** web application. We'll leverage **Next.js** for the frontend, **LiveKit Cloud** for ultra-low latency WebRTC audio delivery, and the **Gemini Live API** to translate audio streams on the fly. 

Finally, we'll containerize the entire application and deploy it as a production-ready, auto-scaling service on **Google Cloud Run**.

---

## 🏗️ How it Works (The Architecture)

Our application runs entirely within a single LiveKit Room to keep signaling fast and simple:

```
[ Organizer (Speaking) ]
          │ (Vocal audio via WebRTC)
          ▼
   [ LiveKit Room ]
     ├── Translator Bot ES (Gemini) ──► Spanish Audio Published
     ├── Translator Bot JA (Gemini) ──► Japanese Audio Published
     └── Translator Bot FR (Gemini) ──► French Audio Published
          │
          ▼ (Selected translation stream)
   [ Listeners (Watch Page) ]
```

1. **The Ingest**: The host starts a broadcast. Their vocal audio is streamed to a LiveKit Room.
2. **On-Demand Spin-up**: When a listener joins and selects a language (e.g. Spanish), the Next.js backend spins up a dedicated background worker thread called the **Translation Bridge**.
3. **The WebRTC to WebSocket Pipe**: The worker connects to the LiveKit Room as a bot, subscribes to the host's audio track, and forwards the raw PCM audio frames over a WebSocket connection to the **Gemini Live API**.
4. **Vocal Translation**: Gemini processes the vocal stream and responds with real-time translated audio.
5. **Playback**: The bot publishes the translated audio track back to the LiveKit Room, and the listener renders that specific bot track.

---

## 🛠️ Tech Stack & Prerequisites

Before we start, make sure you have:
* **Node.js 22+** installed locally.
* A [LiveKit Cloud Account](https://livekit.io/) (the free tier is perfect).
* A Google Cloud Project with the [gcloud CLI](https://cloud.google.com/sdk/gcloud) installed and authenticated.
* A [Gemini API Key](https://aistudio.google.com/) with access to the Live API models.

---

## 💻 Step 1: Clone and Configure the Application

First, navigate to your codebase directory. If you are starting fresh, configure your Next.js application structure to look like this:

### Enabling Standalone Output

Next.js's standalone output yields highly optimized production builds containing only the exact files needed for node deployment — critical for lightning-fast container startups. 

Update your `next.config.ts` (or `next.config.js`):

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@livekit/rtc-node", "ws"],
};

export default nextConfig;
```

---

## 🛠️ Step 2: The Next.js Runtime Env Var Gotcha (And How to Fix It)

When deploying Next.js behind Docker/Cloud Run, developers often fall into a massive trap: **Build-time vs. Runtime Environment Variables**.

In standard Next.js, `NEXT_PUBLIC_` env vars are evaluated and baked into your Javascript bundle *at build time*. But when deploying to Cloud Run, your environment variables are only injected *at runtime*.

If you build your docker image on Cloud Build and try to read client-side variables like `process.env.NEXT_PUBLIC_LIVEKIT_URL` (which we have removed from this codebase), the browser will compile with `undefined` and fall back to `ws://localhost:7880`. The browser will crash trying to connect to localhost!

### The Solution: Server-Delivered Configuration

Instead of reading environment variables in client components, we fetch the LiveKit URL dynamically from our server-side token endpoint!

1. In `/api/token/route.ts` (which runs at runtime on the server and has access to raw env vars), we return both the JWT token and the correct LiveKit Server URL:
   ```typescript
   import { NextRequest, NextResponse } from "next/server";
   import { AccessToken } from "livekit-server-sdk";

   export async function GET(req: NextRequest) {
     const room = req.nextUrl.searchParams.get("room");
     const identity = req.nextUrl.searchParams.get("identity");
     const role = req.nextUrl.searchParams.get("role") || "attendee";

     if (!room || !identity) return NextResponse.json({ error: "Missing parameters" }, { status: 400 });

     const apiKey = process.env.LIVEKIT_API_KEY;
     const apiSecret = process.env.LIVEKIT_API_SECRET;
     const serverUrl = process.env.LIVEKIT_URL || "ws://localhost:7880";

     const at = new AccessToken(apiKey, apiSecret, { identity, ttl: "4h" });
     at.addGrant({ roomJoin: true, room, canPublish: role === "organizer", canSubscribe: true });

     const token = await at.toJwt();
     return NextResponse.json({ token, serverUrl });
   }
   ```

2. On the client side (`watch/page.tsx` and `broadcast/page.tsx`), we dynamically set the state:
   ```typescript
   const [token, setToken] = useState("");
   const [livekitUrl, setLivekitUrl] = useState("");

   useEffect(() => {
     async function fetchToken() {
       const res = await fetch(`/api/token?room=${sessionId}&identity=${identity}`);
       const data = await res.json();
       setToken(data.token);
       setLivekitUrl(data.serverUrl); // Injected dynamically!
     }
     fetchToken();
   }, [sessionId]);
   ```

Now, your container is **100% portable**. You can deploy it to any region or server without rebuilding the image when URLs change!

---

## 🐳 Step 3: Writing the Dockerfile & The Native CA Gotcha

The second big gotcha concerns minimal base images like `node:slim`. 

The `@livekit/rtc-node` SDK uses a native compiled WebRTC core. During initialization, this core makes an HTTPS request to verify Cloud Region settings. Bare-minimum Linux images like `node:22-slim` **do not ship with SSL certificates**, causing the secure connection to throw a cryptically silent handshake error!

To fix this, we explicitly install the standard root certificates (`ca-certificates`) in the production runner stage of our multi-stage `Dockerfile`:

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

## 🚀 Step 4: Deploying to Google Cloud Run

Now that our code is robust, we can deploy! We'll use **Google Secret Manager** to securely house our API keys so they are never hardcoded or leaked in container images.

### 1. Store Secrets in Secret Manager

Run these commands in your terminal to create and populate your secrets:

```bash
echo -n "YOUR_GEMINI_API_KEY" | gcloud secrets create gemini-api-key --data-file=-
echo -n "YOUR_LIVEKIT_API_KEY" | gcloud secrets create livekit-api-key --data-file=-
echo -n "YOUR_LIVEKIT_API_SECRET" | gcloud secrets create livekit-api-secret --data-file=-
```

### 2. Grant Secret Access Permissions to Cloud Run

By default, Cloud Run uses the Default Compute Engine Service Account. Grant it access to read the secrets:

```bash
# Get your Project Number
PROJECT_NUMBER=$(gcloud projects describe $(gcloud config get-value project) --format="value(projectNumber)")

# Grant Secret Accessor role to the default Cloud Run service account
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

### 3. Deploy the Service!

Run the deployment command. Note the specific Cloud Run production scaling configurations required:
* `--min-instances 0`: Allows the service to scale completely to zero when inactive to save costs. The broadcaster client page will dynamically ping the server to keep the container active during live events.
* `--max-instances 1`: Restricts the service to a single container to preserve the in-memory singleton state of active translation sessions (scale horizontally later by integrating Redis).
* `--no-cpu-throttling`: Keeps the CPU allocated between WebRTC packets to ensure zero latency translation audio (only billed while active).

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
LIVEKIT_URL=wss://your-livekit-url.cloud"
```

Once deployment completes, the CLI will output your live public URL!

---

## 🎉 Conclusion & Next Steps

You now have a fully functional, production-ready Real-Time Multilingual Translation Broadcast app deployed on Google Cloud Run!

### What we learned:
* How to bridge **LiveKit WebRTC audio** with **Gemini Live API WebSockets** to translate spoken streams in real-time.
* How to decouple Next.js runtime configurations using server-side configuration endpoints.
* How to correctly configure `slim` Docker containers with `ca-certificates` for native libraries.
* How to leverage Google Secret Manager to safely inject sensitive credentials.

Happy broadcasting! 🌐🎙️
