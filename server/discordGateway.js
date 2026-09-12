// server/discordGateway.js
// Discord Gateway (WebSocket) への接続を管理する。
// READY / MESSAGE_CREATE / GUILD_CREATE などのイベントを EventEmitter で流す。

const WebSocket = require("ws");
const EventEmitter = require("events");

const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";

// intents: GUILDS(1) + GUILD_MEMBERS(2, privileged) + GUILD_MESSAGES(512) + MESSAGE_CONTENT(32768, privileged)
const INTENTS = 1 + 2 + 512 + 32768;

const OP = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  RECONNECT: 7,
  INVALID_SESSION: 9,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
};

class DiscordGateway extends EventEmitter {
  constructor(token) {
    super();
    this.token = token;
    this.ws = null;
    this.heartbeatTimer = null;
    this.seq = null;
    this.sessionId = null;
    this.resumeUrl = null;
    this.shouldReconnect = true;
  }

  connect(url = GATEWAY_URL) {
    this.shouldReconnect = true;
    this.ws = new WebSocket(url);

    this.ws.on("open", () => {
      this.emit("debug", "gateway socket open");
    });

    this.ws.on("message", (raw) => {
      let payload;
      try {
        payload = JSON.parse(raw.toString());
      } catch {
        return;
      }
      this.handlePayload(payload);
    });

    this.ws.on("close", (code) => {
      clearInterval(this.heartbeatTimer);
      this.emit("close", code);
      if (this.shouldReconnect) {
        setTimeout(() => this.connect(this.resumeUrl ? `${this.resumeUrl}/?v=10&encoding=json` : GATEWAY_URL), 2000);
      }
    });

    this.ws.on("error", (err) => {
      this.emit("debug", `gateway socket error: ${err.message}`);
    });
  }

  disconnect() {
    this.shouldReconnect = false;
    clearInterval(this.heartbeatTimer);
    if (this.ws) this.ws.close();
  }

  send(op, d) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ op, d }));
    }
  }

  handlePayload(payload) {
    const { op, d, s, t } = payload;
    if (s !== null && s !== undefined) this.seq = s;

    switch (op) {
      case OP.HELLO: {
        const interval = d.heartbeat_interval;
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = setInterval(() => this.send(OP.HEARTBEAT, this.seq), interval);

        if (this.sessionId) {
          this.send(6, {
            token: this.token,
            session_id: this.sessionId,
            seq: this.seq,
          });
        } else {
          this.identify();
        }
        break;
      }
      case OP.HEARTBEAT_ACK:
        break;
      case OP.RECONNECT:
        this.ws.close();
        break;
      case OP.INVALID_SESSION:
        this.sessionId = null;
        setTimeout(() => this.identify(), 1500);
        break;
      case OP.DISPATCH:
        if (t === "READY") {
          this.sessionId = d.session_id;
          this.resumeUrl = d.resume_gateway_url;
        }
        this.emit("dispatch", { type: t, data: d });
        break;
      default:
        break;
    }
  }

  identify() {
    this.send(OP.IDENTIFY, {
      token: this.token,
      intents: INTENTS,
      properties: {
        os: "linux",
        browser: "discord-bot-web",
        device: "discord-bot-web",
      },
    });
  }
}

module.exports = { DiscordGateway };
