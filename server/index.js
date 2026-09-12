// server/index.js
// バックエンド本体。MWS(https://cloud.puratya.com/)にデプロイして常時稼働させる想定。
// フロントエンド(XREAに設置するHTML/JS)からは、ここのURLに向けて
// REST(fetch)とWebSocket(自前の /ws)でアクセスする。

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");

const { DiscordRest, DiscordRestError } = require("./discordRest");
const { DiscordGateway } = require("./discordGateway");
const { WsHub } = require("./wsHub");

const app = express();
app.use(cors()); // XREA側(別オリジン)からのfetchを許可する
app.use(express.json());
app.use(express.static("public")); // ローカル動作確認用。XREAに置く場合はpublic/の中身をそのままアップロードすればよい

// APP_SECRETを設定しておくと、これを知らない第三者がこのバックエンドURLを
// 見つけても操作できないようにする簡易的な保護になる(任意設定)。
const APP_SECRET = process.env.APP_SECRET || null;
app.use("/api", (req, res, next) => {
  if (!APP_SECRET) return next(); // 未設定なら保護なし(お試し用)
  if (req.get("x-app-secret") === APP_SECRET) return next();
  return res.status(401).json({ error: "invalid_app_secret" });
});

const server = http.createServer(app);
const wsHub = new WsHub(server, "/ws");

// --- アプリの状態(1ユーザー/1Bot前提のシンプルな実装) ---
const state = {
  token: process.env.DISCORD_BOT_TOKEN || null,
  rest: null,
  gateway: null,
  me: null,
};

function requireLogin(req, res, next) {
  if (!state.rest) {
    return res.status(401).json({ error: "not_logged_in" });
  }
  next();
}

function startGateway(token) {
  if (state.gateway) {
    state.gateway.disconnect();
  }
  const gw = new DiscordGateway(token);
  gw.on("dispatch", ({ type, data }) => {
    // フロントエンドへそのまま中継する
    wsHub.broadcast(type, data);
  });
  gw.on("close", (code) => {
    wsHub.broadcast("GATEWAY_CLOSED", { code });
  });
  gw.connect();
  state.gateway = gw;
}

async function loginWithToken(token) {
  const rest = new DiscordRest(token);
  const me = await rest.getMe(); // トークンが正しいか確認
  state.token = token;
  state.rest = rest;
  state.me = me;
  startGateway(token);
  return me;
}

// サーバー起動時、環境変数にトークンがあれば自動ログイン
(async () => {
  if (state.token) {
    try {
      await loginWithToken(state.token);
      console.log(`自動ログイン成功: ${state.me.username}`);
    } catch (e) {
      console.error("自動ログインに失敗しました:", e.message);
    }
  }
})();

// --- 認証 ---
app.post("/api/login", async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: "token_required" });
  try {
    const me = await loginWithToken(token);
    res.json({ me });
  } catch (e) {
    res.status(401).json({ error: "invalid_token", detail: e.message });
  }
});

app.post("/api/logout", requireLogin, (req, res) => {
  if (state.gateway) state.gateway.disconnect();
  state.token = null;
  state.rest = null;
  state.gateway = null;
  state.me = null;
  res.json({ ok: true });
});

app.get("/api/me", requireLogin, (req, res) => {
  res.json({ me: state.me });
});

// --- 共通エラーハンドラ ---
function handle(fn) {
  return async (req, res) => {
    try {
      const result = await fn(req, res);
      res.json(result);
    } catch (e) {
      if (e instanceof DiscordRestError) {
        res.status(e.status).json({ error: "discord_api_error", detail: e.body });
      } else {
        console.error(e);
        res.status(500).json({ error: "internal_error", detail: e.message });
      }
    }
  };
}

// --- サーバー(ギルド) ---
app.get("/api/guilds", requireLogin, handle(async () => {
  const guilds = await state.rest.getGuilds();
  return { guilds };
}));

// --- チャンネル ---
app.get("/api/guilds/:guildId/channels", requireLogin, handle(async (req) => {
  const channels = await state.rest.getGuildChannels(req.params.guildId);
  return { channels };
}));

app.post("/api/guilds/:guildId/channels", requireLogin, handle(async (req) => {
  const channel = await state.rest.createChannel(req.params.guildId, req.body);
  return { channel };
}));

app.patch("/api/channels/:channelId", requireLogin, handle(async (req) => {
  const channel = await state.rest.editChannel(req.params.channelId, req.body);
  return { channel };
}));

app.delete("/api/channels/:channelId", requireLogin, handle(async (req) => {
  await state.rest.deleteChannel(req.params.channelId);
  return { ok: true };
}));

// --- メッセージ ---
app.get("/api/channels/:channelId/messages", requireLogin, handle(async (req) => {
  const limit = Number(req.query.limit) || 50;
  const before = req.query.before;
  const messages = await state.rest.getMessages(req.params.channelId, limit, before);
  return { messages };
}));

app.post("/api/channels/:channelId/messages", requireLogin, handle(async (req) => {
  const message = await state.rest.sendMessage(req.params.channelId, req.body.content);
  return { message };
}));

// --- ロール ---
app.get("/api/guilds/:guildId/roles", requireLogin, handle(async (req) => {
  const roles = await state.rest.getGuildRoles(req.params.guildId);
  return { roles };
}));

app.post("/api/guilds/:guildId/roles", requireLogin, handle(async (req) => {
  const role = await state.rest.createRole(req.params.guildId, req.body);
  return { role };
}));

app.delete("/api/guilds/:guildId/roles/:roleId", requireLogin, handle(async (req) => {
  await state.rest.deleteRole(req.params.guildId, req.params.roleId);
  return { ok: true };
}));

app.put("/api/guilds/:guildId/members/:userId/roles/:roleId", requireLogin, handle(async (req) => {
  await state.rest.addMemberRole(req.params.guildId, req.params.userId, req.params.roleId);
  return { ok: true };
}));

app.delete("/api/guilds/:guildId/members/:userId/roles/:roleId", requireLogin, handle(async (req) => {
  await state.rest.removeMemberRole(req.params.guildId, req.params.userId, req.params.roleId);
  return { ok: true };
}));

// --- メンバー ---
app.get("/api/guilds/:guildId/members", requireLogin, handle(async (req) => {
  const limit = Number(req.query.limit) || 100;
  const members = await state.rest.getGuildMembers(req.params.guildId, limit);
  return { members };
}));

app.delete("/api/guilds/:guildId/members/:userId", requireLogin, handle(async (req) => {
  await state.rest.kickMember(req.params.guildId, req.params.userId);
  return { ok: true };
}));

app.put("/api/guilds/:guildId/bans/:userId", requireLogin, handle(async (req) => {
  await state.rest.banMember(req.params.guildId, req.params.userId, req.body?.reason);
  return { ok: true };
}));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`discord-bot-web backend listening on port ${PORT}`);
});
