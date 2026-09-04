# Deploying BotRunner Hub to Render Web Service

Follow this guide to deploy BotRunner Hub on [Render](https://render.com) as a 24/7 Web Service with persistent bot storage.

---

## Option 1: Fast Blueprint Deployment (Recommended)

1. Push your repository to **GitHub** or **GitLab**.
2. Log into your [Render Dashboard](https://dashboard.render.com).
3. Click **New +** in the top-right corner and select **Blueprint**.
4. Connect your repository.
5. Render will automatically read `render.yaml` and configure:
   - **Service Type**: Web Service (`node` or `docker`)
   - **Build Command**: `chmod +x render-build.sh && ./render-build.sh` (or Docker)
   - **Start Command**: `npm run start`
   - **Health Check Path**: `/api/health`
   - **Persistent Disk**: 1GB mounted at `./deployments` (preserves your bots across redeploys)
6. Click **Apply**. Render will build and launch your service!

---

## Option 2: Manual Web Service Setup

If you prefer setting up manually without Blueprint:

1. In Render Dashboard, click **New +** -> **Web Service**.
2. Connect your Git repository.
3. Configure the following fields:
   - **Name**: `botrunner-hub` (or your choice)
   - **Environment**: `Node` (or `Docker` using the included Dockerfile)
   - **Region**: Select closest to your users (e.g. `Oregon (US West)`, `Frankfurt (EU)`)
   - **Branch**: `main`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm run start`
4. **Environment Variables**:
   - `NODE_ENV`: `production`
   - `TELEGRAM_BOT_TOKEN`: *(Your master Telegram Bot Token)*
   - `GEMINI_API_KEY`: *(Optional AI Studio API Key)*
5. **Persistent Disk (Important for saving bot files)**:
   - Go to **Disks** section -> Click **Add Disk**.
   - **Name**: `botrunner-storage`
   - **Mount Path**: `/opt/render/project/src/deployments` (for Node runtime) or `/app/deployments` (for Docker runtime)
   - **Size**: 1 GB
6. **Health Check Path**:
   - Set to `/api/health` under **Advanced Settings**.
7. Click **Create Web Service**.

---

## Deploy Webhooks

To trigger automatic redeploys from external tools or webhooks:
1. Navigate to your Web Service settings in Render.
2. Copy the **Deploy Hook URL** (`https://api.render.com/deploy/srv-xxxx?key=yyyy`).
3. You can paste this webhook directly into the BotRunner Hub Dashboard to trigger instant live redeployments.
