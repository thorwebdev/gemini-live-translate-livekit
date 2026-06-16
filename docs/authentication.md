# Authentication with Identity-Aware Proxy (IAP)

Restrict access to your Live Translate deployment so only authorized Google accounts can use it. IAP intercepts requests and redirects users to Google Sign-In — only authorized users can access the app.

## How it works

```
User → Cloud Run URL → Google Sign-In → IAP check → App (if authorized)
                                              ↓
                                         403 Forbidden (if not)
```

> **Note:** IAP locks down the entire app, including the attendee watch page. Every user (organizers and attendees) needs a Google account with access.

---

## ⚠️ Essential One-time Setup: OAuth Consent Screen

If your Google Cloud project is a standalone developer/personal project (i.e., **not inside a Google Cloud Organization**), enabling IAP via CLI or console will fail with:
> **"Empty Google Account OAuth client ID(s)/secret(s)"**

This happens because Google cannot auto-generate a managed OAuth client ID without a configured **OAuth Consent Screen** (a "brand"). You must set this up once manually in the Cloud Console:

1. Go to the [Google Cloud Console OAuth Consent Screen](https://console.cloud.google.com/apis/credentials/consent).
2. Select **External** (Internal is only available for Organization projects) and click **Create**.
3. Fill in the required fields:
   - **App name**: `Live Translate` (or any name you choose)
   - **User support email**: Your email address
   - **Developer contact information**: Your email address
4. Click **Save and Continue** (you don't need to add scopes or test users for this simple setup).
5. Once the consent screen is created, go to the [Cloud Run Console](https://console.cloud.google.com/run).
6. Click on your `live-translate` service, go to the **Security** tab, and toggle **Identity-Aware Proxy (IAP)** off and then back on. This forces Google Cloud to automatically provision the managed OAuth client using your newly configured consent screen!

---

## Setup

### 1. Deploy with IAP enabled

```bash
gcloud run deploy live-translate \
  --source . \
  --region us-central1 \
  --no-allow-unauthenticated \
  --iap \
  --min-instances 1 \
  --max-instances 1 \
  --timeout 3600 \
  --no-cpu-throttling \
  --set-secrets "\
GEMINI_API_KEY=gemini-api-key:latest,\
LIVEKIT_API_KEY=livekit-api-key:latest,\
LIVEKIT_API_SECRET=livekit-api-secret:latest" \
  --set-env-vars "\
LIVEKIT_URL=$LIVEKIT_URL"
```

To enable IAP on an existing deployment:

```bash
gcloud run services update live-translate --region us-central1 --iap
```

### 2. Grant access to specific users

When IAP is enabled, users must have the **IAP-secured Web App User** role (`roles/iap.httpsResourceAccessor`) to gain access. Use `gcloud iap web` to grant this:

#### Individual Google accounts

```bash
gcloud iap web add-iam-policy-binding \
  --member="user:alice@gmail.com" \
  --role="roles/iap.httpsResourceAccessor" \
  --region=us-central1 \
  --resource-type=cloud-run \
  --service=live-translate
```

#### An entire Google Workspace domain

```bash
gcloud iap web add-iam-policy-binding \
  --member="domain:your-company.com" \
  --role="roles/iap.httpsResourceAccessor" \
  --region=us-central1 \
  --resource-type=cloud-run \
  --service=live-translate
```

#### A Google Group

```bash
gcloud iap web add-iam-policy-binding \
  --member="group:team@your-company.com" \
  --role="roles/iap.httpsResourceAccessor" \
  --region=us-central1 \
  --resource-type=cloud-run \
  --service=live-translate
```

### 3. Verify access

To see who has access to the IAP policy for your service:

```bash
gcloud iap web get-iam-policy \
  --region=us-central1 \
  --resource-type=cloud-run \
  --service=live-translate
```

---

## Managing access

### Add a user

```bash
gcloud iap web add-iam-policy-binding \
  --member="user:newuser@gmail.com" \
  --role="roles/iap.httpsResourceAccessor" \
  --region=us-central1 \
  --resource-type=cloud-run \
  --service=live-translate
```

### Remove a user

```bash
gcloud iap web remove-iam-policy-binding \
  --member="user:olduser@gmail.com" \
  --role="roles/iap.httpsResourceAccessor" \
  --region=us-central1 \
  --resource-type=cloud-run \
  --service=live-translate
```

### Disable IAP (re-enable public access)

1. Turn off IAP on the Cloud Run service:
   ```bash
   gcloud run services update live-translate --region us-central1 --no-iap
   ```

2. Re-enable public access on the Cloud Run IAM policy:
   ```bash
   gcloud run services add-iam-policy-binding live-translate \
     --region us-central1 \
     --member="allUsers" \
     --role="roles/run.invoker"
   ```
