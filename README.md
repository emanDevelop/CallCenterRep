# Yasmeen Cloud voice assistant (demo)

A voice customer-support bot for a **fictional** company, built on
[Pipecat](https://github.com/pipecat-ai/pipecat) and OpenAI Realtime. It answers only from
`company-info.txt`. For learning purposes only.

## Layout

| Path               | What it is                                                   |
| ------------------ | ------------------------------------------------------------ |
| `company-info.txt` | What the bot knows. Edit it, then restart the bot.           |
| `server/bot.py`    | The bot and its routes.                                      |
| `server/ui/`       | The built web UI, committed so the bot runs without Node.    |
| `web/`             | Source of the web UI (Vite, plain JavaScript).               |
| `brand/`           | Brand guide, logo and generated marketing images.            |
| `requirements.txt` | Python dependencies (Pipecat pinned to a tested commit).     |
| `render.yaml`      | Render Blueprint for deploying the bot.                      |
| `pipecat/`         | Pipecat checkout, installed into the Python env (not tracked). |

## Run

1. Put your key in `pipecat/.env`: `OPENAI_API_KEY=sk-...`
2. Double-click `run-company-bot.cmd` (uses the env at `%USERPROFILE%\.venvs\pipecat`).
3. Open http://localhost:7860/ in Chrome or Edge and press the call button.

Routes: `/client/` is this UI, `/ws-client` carries the call (audio over a WebSocket),
`/classic/` is the stock Pipecat playground (WebRTC, local only), and `/` redirects to
`/client/`.

## Deploy to Render

`render.yaml` describes one Python web service on Render's free plan.

1. On [render.com](https://render.com), choose **New → Blueprint** and connect this GitHub repo.
2. When asked, paste your OpenAI key as `OPENAI_API_KEY`. It is stored only on Render.
3. Wait for the build (a few minutes the first time), then open the service's
   `https://….onrender.com` address.

The free plan sleeps after about 15 minutes without visitors; the first visit afterwards
takes 30–60 seconds. Each call also uses OpenAI Realtime credit.

## Unanswered questions (n8n)

When a caller asks something that isn't in `company-info.txt`, the bot calls its
`log_unanswered_question` tool, which POSTs the question to the n8n workflow
**Unanswered Questions — Voice Bot→Data Table**. n8n saves it to the data table
**Yasmeen Cloud — Unanswered Questions** (question, missing_info, language, session_id,
source, asked_at), and the bot tells the caller the team will follow up.

Set both variables (in `pipecat/.env` locally, and in Render's Environment):

| Variable             | Value                                                       |
| -------------------- | ----------------------------------------------------------- |
| `N8N_UNANSWERED_URL` | The workflow's production webhook URL                       |
| `N8N_UNANSWERED_KEY` | The `x-yasmeen-key` secret the workflow checks for          |

Without them the bot works as before and simply doesn't report questions.

## Change the UI

```bash
cd web
npm install
npm run build   # writes server/ui
```

`npm run dev` serves the UI with hot reload and forwards calls to a bot on port 7860.
