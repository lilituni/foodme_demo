# FoodMe — deploy it yourself, step by step

You will put a small food-ordering app on the internet, plus a monitoring
dashboard for it. Everything uses **free** accounts. No coding needed.

You need about 30–40 minutes. Most of it is waiting for servers to start.

---

## Step 1 — Make your own copy of this project

1. Sign up / log in at [github.com](https://github.com).
2. On this repository page, click **Fork** (top right). Now you have your own copy.
3. In **your fork**, open the file `render.yaml`, click the **pencil icon** to edit,
   and change this line:

   ```yaml
   name: foodme-armanayvazyan
   ```

   to your own GitHub username, for example:

   ```yaml
   name: foodme-mariapetrova
   ```

4. Click **Commit changes**.

---

## Step 2 — Create error tracking (GlitchTip)

GlitchTip collects the app's errors so you can see them later.

1. Sign up free at [glitchtip.com](https://glitchtip.com/).
2. Create **three** projects. Name them: `backend`, `web`, `admin`.
3. Each project gives you a **DSN** — a long address starting with `https://…`.
   Open each project's settings and copy its DSN somewhere handy. You now have
   **3 DSNs**.

---

## Step 3 — Put the app online (Render)

1. Sign up at [render.com](https://render.com) — choose **"Sign up with GitHub"**.
2. In the Render dashboard click **New +** → **Blueprint**.
3. Pick **your fork** of this repository. Render finds `render.yaml` by itself.
4. Render asks you to fill in a few values. Paste your DSNs from Step 2:

   | Field | What to paste |
   |---|---|
   | `SENTRY_DSN` | DSN of the `backend` project |
   | `VITE_SENTRY_DSN_WEB` | DSN of the `web` project |
   | `VITE_SENTRY_DSN_ADMIN` | DSN of the `admin` project |
   | `LOKI_PUSH_URL` | **leave empty** (used in Step 4) |

5. Click **Apply** / **Deploy** and wait. ⏳ **10–15 minutes is normal** — the
   free server is small and slow to start. "In progress" for a long time does
   not mean it is broken.
6. When it turns **Live**, click the service `foodme-<yourname>` and open its
   URL (looks like `https://foodme-<yourname>-xxxx.onrender.com`).
   - The food store is at `/`
   - The admin panel is at `/backoffice`

**If the deploy says "failed":** open the **Logs** tab and look for a red
error. If there is none (it just timed out), click **Manual Deploy →
Deploy latest commit** — the second try is faster and usually succeeds.

---

## Step 4 — Put the monitoring online (Grafana)

This adds one more service with dashboards, metrics and logs.

1. In Render click **New +** → **Blueprint** → your fork again, but this time
   choose the file **`render-monitoring.yaml`**.
2. Deploy it and wait until `foodme-monitoring` is **Live**. Copy its URL
   (looks like `https://foodme-monitoring-xxxx.onrender.com`).
3. Connect the two services — two settings:

   **A.** On `foodme-monitoring` → **Environment** → set:
   - `BACKEND_HOST` = your app's address **without** `https://`,
     for example: `foodme-mariapetrova-xxxx.onrender.com`

   **B.** On your app service (`foodme-<yourname>`) → **Environment** → set:
   - `LOKI_PUSH_URL` = `https://foodme-monitoring-xxxx.onrender.com/loki/api/v1/push`
     (your monitoring URL + `/loki/api/v1/push`)

   Saving each one restarts that service automatically. Wait for both to be
   **Live** again.
4. Open the monitoring URL. This is **Grafana**. Log in with `admin` / `admin`
   (it will ask you to set a new password — do it).

---

## Step 5 — Check everything works

1. Open your food store URL and click around (browse dishes, add to cart).
2. In Grafana, go to **Explore**:
   - choose **Prometheus**, run the query `up{app="foodme-backend"}` — you
     should see the value `1`.
   - choose **Loki**, run the query `{app="foodme-backend"}` — you should see
     the app's log lines.

Done. 🎉

---

## Good to know (read when something looks wrong)

- **Free servers fall asleep** after ~15 minutes without visitors. The first
  visit after that takes 1–3 minutes to answer. This is normal.
- **Monitoring data is wiped** every time the monitoring service restarts or
  falls asleep (free plan has no storage disk). Old graphs disappearing is
  normal, not your mistake.
- **"No data" in Grafana right after waking up** — wait 30 seconds and run the
  query again.
- Metrics and logs are kept for a maximum of **2 days**.

## Connecting AI tools to Grafana (MCP)

The stack exposes a built-in Grafana MCP endpoint at `/mcp` so AI tools can query
your metrics and logs. **There is nothing to configure** — the MCP authenticates
to Grafana as the admin user automatically, and the endpoint needs no token.

Just point your client at `https://foodme-monitoring-<hash>.onrender.com/mcp`.
Note the endpoint is currently **open** to anyone with the URL (full admin-level
Grafana access) — fine for a workshop, but don't treat the URL as a secret.

More technical detail, including ready-to-paste Claude Code and Claude Desktop
configs, lives in `infra/monitoring/README.md`.
