# Troubleshooting & API Diagnostics

If your session creation or connection gets stuck (e.g. infinite spinner or errors), follow this guide to inspect and verify that all API routes and credentials are functioning correctly.

---

## 1. Browser-based Diagnostics (Recommended)

The easiest way to see exactly what is failing is to use your browser's Developer Tools.

1. Open your web browser and navigate to your deployed Cloud Run URL.
2. Open **Developer Tools** (Press `F12` or `Cmd + Option + I` on macOS).
3. Switch to the **Network** tab and select **Fetch/XHR** to filter out static assets.
4. Click **Create session** on the home page.
5. You should see two critical API requests occur:

### Request 1: `POST /api/sessions`
- **Purpose**: Creates the session ID in the in-memory manager.
- **Status**: Should be `200 OK`.
- **Payload**: Should return a JSON body like:
  ```json
  {
    "sessionId": "c62f85dd",
    "organizerIdentity": "organizer-host",
    "joinUrl": "https://...",
    "broadcastUrl": "https://..."
  }
  ```

### Request 2: `GET /api/token?room=...&identity=...&role=organizer`
- **Purpose**: Generates the LiveKit JWT token using your secret key.
- **Status**: Should be `200 OK`.
- **Payload**: Should return a JSON body containing your JWT token:
  ```json
  {
    "token": "eyJhbGciOi..."
  }
  ```

> **Common browser failures**:
> - If either request returns a **500 Internal Server Error**, check the response body in the DevTools "Response" tab. It will often contain a helpful error message (e.g. `"LiveKit credentials not configured"`).
> - If a request is blocked or shows a **CORS error**, check if the request was intercepted or redirected (e.g. by IAP session expiration).

---

## 2. Local CLI Diagnostics

If you want to verify that the Next.js API logic works independently of Cloud Run, you can run the server locally.

1. Ensure your local `.env.local` contains all credentials:
   ```env
   GEMINI_API_KEY=your-gemini-key
   LIVEKIT_API_KEY=your-livekit-key
   LIVEKIT_API_SECRET=your-livekit-secret
   LIVEKIT_URL=wss://your-livekit.cloud
   ```

2. Start the development server:
   ```bash
   npm run dev
   ```

3. Open a new terminal and test the routes directly using `curl`:

   **Test 1: Create Session**
   ```bash
   curl -X POST http://localhost:3000/api/sessions \
     -H "Content-Type: application/json" \
     -d '{"organizerName":"host"}'
   ```
   *Expected output: A JSON object containing a 8-character `sessionId`.*

   **Test 2: Generate Token**
   *(Replace `<SESSION_ID>` with the ID returned by Test 1)*
   ```bash
   curl "http://localhost:3000/api/token?room=<SESSION_ID>&identity=organizer-host&role=organizer"
   ```
   *Expected output: A JSON object containing the `token` JWT string.*

---

## 3. Verifying Cloud Run Credentials & Settings

If the local tests pass but the Cloud Run tests fail, verify the Cloud Run configuration using `gcloud`:

### Check environment mapping
Verify that the environment variables and Secret Manager mappings are correctly assigned:
```bash
gcloud run services describe live-translate \
  --region us-central1 \
  --format="json(spec.template.spec.containers[0].env)"
```

### Verify secrets are accessible
Cloud Run uses its default Compute Engine service account to access Secret Manager. Make sure it has the **Secret Manager Secret Accessor** role (`roles/secretmanager.secretAccessor`) on each secret:
```bash
# Get your project number
PROJECT_NUMBER=$(gcloud projects describe $(gcloud config get-value project) --format="value(projectNumber)")

# Grant secret accessor permission to the default Cloud Run service account
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
