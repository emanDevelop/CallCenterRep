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
| `pipecat/`         | Pipecat checkout, installed into the Python env (not tracked). |

## Run

1. Put your key in `pipecat/.env`: `OPENAI_API_KEY=sk-...`
2. Double-click `run-company-bot.cmd` (uses the env at `%USERPROFILE%\.venvs\pipecat`).
3. Open http://localhost:7860/ in Chrome or Edge and press the call button.

Routes: `/client/` is this UI, `/classic/` is the stock Pipecat playground, and `/` redirects
to `/client/`.

## Change the UI

```bash
cd web
npm install
npm run build   # writes server/ui
```

`npm run dev` serves the UI with hot reload and forwards API calls to a bot on port 7860.
