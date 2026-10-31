import { PipecatClient, RTVIEvent } from "@pipecat-ai/client-js";
import { ProtobufFrameSerializer, WebSocketTransport } from "@pipecat-ai/websocket-transport";
import { STRINGS } from "./i18n.js";
import { audioContext, LevelMeter } from "./meter.js";
import { addFlowers } from "./flowers.js";
import { Orb } from "./orb.js";

const $ = (id) => document.getElementById(id);
const root = document.documentElement;

const el = {
  langBtn: $("langBtn"),
  themeBtn: $("themeBtn"),
  muteBtn: $("muteBtn"),
  callBtn: $("callBtn"),
  callLabel: $("callLabel"),
  settingsBtn: $("settingsBtn"),
  settingsMenu: $("settingsMenu"),
  micSelect: $("micSelect"),
  status: $("status"),
  toast: $("toast"),
  transcript: $("transcript"),
  emptyHint: $("emptyHint"),
  liveDot: $("liveDot"),
  composer: $("composer"),
  textInput: $("textInput"),
  sendBtn: $("sendBtn"),
};

// ---------- Preferences (localStorage may be unavailable) ----------
function load(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode or blocked storage: keep the in-memory value only */
  }
}

let lang = root.lang === "en" ? "en" : "ar";
const t = (key) => STRINGS[lang][key] ?? STRINGS.ar[key] ?? key;

// ---------- State ----------
const state = {
  call: "idle", // idle | connecting | connected
  muted: false,
  micBlocked: false,
  botSpeaking: false,
  preferredMic: load("yd-mic") || "",
};

let client = null;
let ending = false;
const orb = new Orb($("orb"));
const botAudio = new Audio();
botAudio.autoplay = true;

// Levels are measured in the page where a track is available (the mic), and otherwise
// taken from the transport's level events (the bot, whose audio the transport plays
// itself). Event levels fade out so a missed "silent" event can't freeze the orb.
const micMeter = new LevelMeter();
const botMeter = new LevelMeter();
const eventLevel = { mic: 0, bot: 0 };
setInterval(() => {
  const mic = Math.max(micMeter.level(), eventLevel.mic);
  orb.setMicLevel(state.muted || state.micBlocked ? 0 : mic);
  orb.setBotLevel(Math.max(botMeter.level(), eventLevel.bot));
  eventLevel.mic *= 0.8;
  eventLevel.bot *= 0.8;
}, 50);

// ---------- i18n ----------
function applyLanguage() {
  root.lang = lang;
  root.dir = lang === "ar" ? "rtl" : "ltr";
  document.title = t("title");
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((node) => {
    node.placeholder = t(node.dataset.i18nPlaceholder);
  });
  document.querySelectorAll("[data-i18n-aria]").forEach((node) => {
    node.setAttribute("aria-label", t(node.dataset.i18nAria));
    node.title = t(node.dataset.i18nAria);
  });
  el.langBtn.textContent = t("langBtn");
  document.querySelectorAll(".msg").forEach((msg) => {
    msg.querySelector(".msg-who").textContent = t(msg.classList.contains("user") ? "you" : "assistant");
  });
  if (el.toast.dataset.key) el.toast.textContent = t(el.toast.dataset.key);
  refreshMicOptions();
  render();
}

el.langBtn.addEventListener("click", () => {
  lang = lang === "ar" ? "en" : "ar";
  save("yd-lang", lang);
  applyLanguage();
});

// ---------- Theme ----------
el.themeBtn.addEventListener("click", () => {
  const next = root.dataset.theme === "dark" ? "light" : "dark";
  root.dataset.theme = next;
  save("yd-theme", next);
  orb.readColors();
});

// ---------- Rendering ----------
function mode() {
  if (state.call === "connecting") return "connecting";
  if (state.call !== "connected") return "idle";
  if (state.botSpeaking) return "speaking";
  if (state.muted || state.micBlocked) return "muted";
  return "listening";
}

function render() {
  const m = mode();
  orb.setMode(m);
  el.status.dataset.mode = m;
  el.status.textContent = t(`status_${m}`);

  el.callBtn.dataset.state = state.call;
  el.callBtn.disabled = state.call === "connecting";
  el.callLabel.textContent =
    state.call === "connecting" ? t("callConnecting") : state.call === "connected" ? t("callEnd") : t("callStart");
  el.callBtn.setAttribute("aria-label", el.callLabel.textContent);

  const connected = state.call === "connected";
  el.muteBtn.disabled = !connected || state.micBlocked;
  el.muteBtn.setAttribute("aria-pressed", String(connected && (state.muted || state.micBlocked)));
  const muteKey = state.muted ? "unmute" : "mute";
  el.muteBtn.setAttribute("aria-label", t(muteKey));
  el.muteBtn.title = t(muteKey);

  el.textInput.disabled = !connected;
  el.sendBtn.disabled = !connected || !el.textInput.value.trim();
  el.liveDot.hidden = !connected;
  el.emptyHint.hidden = el.transcript.children.length > 0;
}

function showError(key) {
  el.toast.dataset.key = key;
  el.toast.textContent = t(key);
  el.toast.hidden = false;
}

function clearError() {
  delete el.toast.dataset.key;
  el.toast.hidden = true;
}

// ---------- Transcript ----------
let botMsg = null; // current bot bubble
let botSegments = new Map(); // segment_id -> span in the current bot bubble
let userPending = null; // user bubble waiting for its transcript

function nearBottom() {
  const list = el.transcript;
  return list.scrollHeight - list.scrollTop - list.clientHeight < 80;
}

function scrollDown(force) {
  if (force || nearBottom()) el.transcript.scrollTop = el.transcript.scrollHeight;
}

function addMessage(role) {
  const stick = nearBottom();
  const li = document.createElement("li");
  li.className = `msg ${role}`;
  const who = document.createElement("span");
  who.className = "msg-who";
  who.textContent = t(role === "user" ? "you" : "assistant");
  const body = document.createElement("div");
  body.className = "msg-body";
  body.dir = "auto";
  li.append(who, body);
  el.transcript.append(li);
  el.emptyHint.hidden = true;
  scrollDown(stick);
  return li;
}

function typingDots() {
  const span = document.createElement("span");
  span.className = "typing";
  span.append(document.createElement("i"), document.createElement("i"), document.createElement("i"));
  return span;
}

function startUserTurn() {
  if (userPending && !userPending.dataset.text) userPending.remove();
  userPending = addMessage("user");
  userPending.querySelector(".msg-body").append(typingDots());
  botMsg = null;
  botSegments = new Map();
}

function setUserText(li, text) {
  li.dataset.text = text;
  li.querySelector(".msg-body").textContent = text;
}

function onUserTranscript(data) {
  const text = (data?.text ?? "").trim();
  if (!text) return;
  if (!userPending) startUserTurn();
  const target = userPending;
  setUserText(target, text);
  if (data.final) userPending = null;
  scrollDown();
}

// Segment text doesn't always carry the space at its edge, so a boundary between
// different kinds of characters (e.g. an Arabic word and a number) gets one.
function charKind(ch) {
  if (!ch || /\s/.test(ch)) return "space";
  if (/[0-9٠-٩]/.test(ch)) return "digit";
  if (/[؀-ۿݐ-ݿ]/.test(ch)) return "arabic";
  if (/[A-Za-z]/.test(ch)) return "latin";
  return "other";
}

function leadingSpace(span, text) {
  const prevText = span.previousElementSibling?.textContent ?? "";
  const a = charKind(prevText.slice(-1));
  const b = charKind(text.charAt(0));
  const words = ["digit", "arabic", "latin"];
  return words.includes(a) && words.includes(b) && a !== b ? " " : "";
}

function onBotOutput(data) {
  if (!data || typeof data.text !== "string") return;
  // Word-level events repeat text that the sentence events already carry.
  if (data.aggregated_by === "word") return;

  if (!botMsg) {
    botMsg = addMessage("bot");
    botSegments = new Map();
  }
  const body = botMsg.querySelector(".msg-body");
  const id = data.segment_id ?? `n${botSegments.size}`;
  let span = botSegments.get(id);
  if (!span) {
    span = document.createElement("span");
    botSegments.set(id, span);
    body.append(span);
  }

  const status = data.spoken_status;
  const notSpokenYet =
    data.will_be_spoken !== false &&
    (status ? status !== "completed" : data.spoken === false);

  span.replaceChildren();
  const lead = leadingSpace(span, data.text);
  if (status === "in-progress" && data.spoken_progress) {
    const done = document.createElement("span");
    done.textContent = lead + (data.spoken_progress.accumulated_text ?? "");
    const rest = document.createElement("span");
    rest.className = "pending";
    rest.textContent = data.spoken_progress.remaining_text ?? "";
    span.className = "";
    span.append(done, rest);
  } else {
    span.textContent = lead + data.text;
    span.className = notSpokenYet ? "pending" : "";
  }
  scrollDown();
}

function resetTranscriptTurns() {
  if (userPending && !userPending.dataset.text) userPending.remove();
  userPending = null;
  botMsg = null;
  botSegments = new Map();
  render();
}

// ---------- Microphones ----------
let knownMics = [];

function refreshMicOptions() {
  const select = el.micSelect;
  select.replaceChildren();
  const def = new Option(t("micDefault"), "");
  select.append(def);
  knownMics
    .filter((d) => d.deviceId && d.deviceId !== "default")
    .forEach((d, i) => select.append(new Option(d.label || `${t("microphone")} ${i + 1}`, d.deviceId)));
  select.value = knownMics.some((d) => d.deviceId === state.preferredMic) ? state.preferredMic : "";
  if (knownMics.length === 0 && state.micBlocked) {
    select.replaceChildren(new Option(t("micNone"), ""));
  }
}

async function loadMics() {
  try {
    if (client && state.call === "connected") {
      knownMics = await client.getAllMics();
    } else if (navigator.mediaDevices?.enumerateDevices) {
      knownMics = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");
    }
  } catch {
    knownMics = [];
  }
  refreshMicOptions();
}

el.micSelect.addEventListener("change", () => {
  state.preferredMic = el.micSelect.value;
  save("yd-mic", state.preferredMic);
  if (client && state.call === "connected" && state.preferredMic) {
    try {
      client.updateMic(state.preferredMic);
    } catch {
      /* keep the current mic */
    }
  }
});

// ---------- Settings menu ----------
function setMenu(open) {
  el.settingsMenu.hidden = !open;
  el.settingsBtn.setAttribute("aria-expanded", String(open));
  if (open) {
    loadMics();
    el.micSelect.focus();
  }
}

el.settingsBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  setMenu(el.settingsMenu.hidden);
});

document.addEventListener("click", (e) => {
  if (!el.settingsMenu.hidden && !el.settingsMenu.contains(e.target)) setMenu(false);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !el.settingsMenu.hidden) {
    setMenu(false);
    el.settingsBtn.focus();
  }
});

// ---------- Call ----------
function createClient() {
  const transport = new WebSocketTransport({ serializer: new ProtobufFrameSerializer() });
  const c = new PipecatClient({
    transport,
    enableMic: true,
    enableCam: false,
    callbacks: {},
  });

  c.on(RTVIEvent.BotReady, () => {
    state.call = "connected";
    if (state.preferredMic) {
      try {
        c.updateMic(state.preferredMic);
      } catch {
        /* fall back to the default mic */
      }
    }
    try {
      const tracks = c.tracks();
      micMeter.attach(tracks?.local?.audio);
      botMeter.attach(tracks?.bot?.audio);
    } catch {
      /* TrackStarted attaches them instead */
    }
    loadMics();
    render();
  });

  c.on(RTVIEvent.MicUpdated, () => {
    try {
      micMeter.attach(c.tracks()?.local?.audio);
    } catch {
      /* keep the current meter */
    }
  });

  c.on(RTVIEvent.Disconnected, () => {
    const unexpected = !ending && state.call === "connected";
    finishCall();
    if (unexpected) showError("errDropped");
  });

  c.on(RTVIEvent.TrackStarted, (track, participant) => {
    if (track?.kind !== "audio") return;
    if (participant?.local) {
      micMeter.attach(track);
    } else {
      botAudio.srcObject = new MediaStream([track]);
      botAudio.play().catch(() => {});
      botMeter.attach(track);
    }
  });

  c.on(RTVIEvent.LocalAudioLevel, (level) => {
    if (Number.isFinite(level)) eventLevel.mic = Math.max(eventLevel.mic, level);
  });
  c.on(RTVIEvent.RemoteAudioLevel, (level) => {
    if (Number.isFinite(level)) eventLevel.bot = Math.max(eventLevel.bot, level);
  });

  c.on(RTVIEvent.DeviceError, (err) => {
    const type = err?.type;
    if (type === "permissions" || type === "not-found" || type === "undefined-mediadevices") {
      state.micBlocked = true;
      showError(type === "not-found" ? "errNoMic" : "errMicDenied");
      render();
    }
  });

  c.on(RTVIEvent.BotStartedSpeaking, () => {
    state.botSpeaking = true;
    render();
  });
  c.on(RTVIEvent.BotStoppedSpeaking, () => {
    state.botSpeaking = false;
    orb.setBotLevel(0);
    render();
  });

  c.on(RTVIEvent.UserStartedSpeaking, startUserTurn);
  c.on(RTVIEvent.UserTranscript, onUserTranscript);
  c.on(RTVIEvent.BotOutput, onBotOutput);

  return { client: c, transport };
}

// A failed WebSocket doesn't say why, so ask the server directly: a request that can't
// connect, or a gateway error from the host's proxy, means the bot isn't running.
async function isServerDown() {
  try {
    const res = await fetch("/status", { cache: "no-store" });
    return [502, 503, 504].includes(res.status);
  } catch {
    return true;
  }
}

// The call runs over a WebSocket on the same host that served this page, so the
// address is built from the page's own URL (wss:// behind HTTPS, e.g. on Render).
function callUrl() {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${location.host}/ws-client?lang=${encodeURIComponent(lang)}`;
}

async function startCall() {
  if (state.call !== "idle") return;
  clearError();
  setMenu(false);
  ending = false;
  state.call = "connecting";
  state.muted = false;
  state.micBlocked = false;
  state.botSpeaking = false;
  render();
  audioContext(); // created inside the click so the browser allows audio

  const { client: c } = createClient();
  client = c;

  try {
    await c.connect({ wsUrl: callUrl() });
  } catch (err) {
    console.error("connect failed", err);
    const denied = err?.name === "NotAllowedError" || err?.type === "permissions";
    await endCall();
    if (denied) showError("errMicDenied");
    else showError((await isServerDown()) ? "errServerDown" : "errConnect");
  }
}

function finishCall() {
  state.call = "idle";
  state.botSpeaking = false;
  state.muted = false;
  micMeter.detach();
  botMeter.detach();
  botAudio.srcObject = null;
  client = null;
  resetTranscriptTurns();
}

async function endCall() {
  ending = true;
  const c = client;
  finishCall();
  if (c) {
    try {
      await c.disconnect();
    } catch {
      /* already gone */
    }
  }
}

el.callBtn.addEventListener("click", () => {
  if (state.call === "idle") startCall();
  else if (state.call === "connected") endCall();
});

el.muteBtn.addEventListener("click", () => {
  if (!client || state.call !== "connected" || state.micBlocked) return;
  state.muted = !state.muted;
  try {
    client.enableMic(!state.muted);
  } catch {
    state.muted = !state.muted;
  }
  if (state.muted) orb.setMicLevel(0);
  render();
});

// ---------- Typed messages ----------
el.textInput.addEventListener("input", render);

el.composer.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = el.textInput.value.trim();
  if (!text || !client || state.call !== "connected") return;
  el.textInput.value = "";
  if (userPending && !userPending.dataset.text) userPending.remove();
  userPending = null;
  setUserText(addMessage("user"), text);
  botMsg = null;
  botSegments = new Map();
  scrollDown(true);
  render();
  try {
    await client.sendText(text);
  } catch (err) {
    console.error("sendText failed", err);
    showError("errConnect");
  }
});

// ---------- Leaving the page ----------
window.addEventListener("pagehide", () => {
  if (client) {
    ending = true;
    try {
      client.disconnect();
    } catch {
      /* page is going away */
    }
  }
});

addFlowers(document.querySelector(".backdrop"));
applyLanguage();
loadMics();
