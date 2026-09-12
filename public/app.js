// public/app.js
// バックエンド(MWSにデプロイしたNode.jsサーバー)とやり取りするフロントエンド本体。

const el = (id) => document.getElementById(id);

let backendUrl = localStorage.getItem("backendUrl") || "";
let appSecret = localStorage.getItem("appSecret") || "";
let ws = null;

let state = {
  me: null,
  guilds: [],
  currentGuildId: null,
  channels: [],
  members: [],
  roles: [],
  currentChannelId: null,
  currentChannelName: "",
};

// --- API ヘルパー ---
async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (appSecret) headers["x-app-secret"] = appSecret;
  const res = await fetch(`${backendUrl}${path}`, { ...opts, headers });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.detail ? JSON.stringify(json.detail) : json.error || `HTTP ${res.status}`);
  }
  return json;
}

// --- Discord CDN画像URLヘルパー ---
function guildIconUrl(guild) {
  if (!guild || !guild.icon) return null;
  return `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=64`;
}

function avatarUrl(user) {
  if (!user) return null;
  if (user.avatar) {
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`;
  }
  return null; // フォールバック(頭文字アイコン)を使う
}

function initials(name) {
  return (name || "?").trim().slice(0, 2).toUpperCase();
}

// 画像 or 頭文字フォールバックのHTMLを作る
function avatarHtml(imgUrl, name, className = "avatar") {
  if (imgUrl) {
    return `<img class="${className}" src="${imgUrl}" alt="" onerror="this.outerHTML='${avatarFallbackHtml(name, className)}'" />`;
  }
  return avatarFallbackHtml(name, className);
}
function avatarFallbackHtml(name, className) {
  const cls = className === "avatar" ? "avatar-fallback" : className + "-fallback";
  return `<div class="${cls}">${escapeHtml(initials(name))}</div>`;
}

// メンバーの一番上にある「色付きロール」の色コードを取得
function roleColorForUser(userId) {
  const member = state.members.find((m) => m.user?.id === userId);
  if (!member) return null;
  const colored = state.roles
    .filter((r) => (member.roles || []).includes(r.id) && r.color)
    .sort((a, b) => (b.position ?? 0) - (a.position ?? 0));
  if (!colored.length) return null;
  return "#" + colored[0].color.toString(16).padStart(6, "0");
}

// --- 汎用ダイアログ ---
function showDialog(title, bodyHtml) {
  return new Promise((resolve) => {
    el("dialog-title").textContent = title;
    el("dialog-body").innerHTML = bodyHtml;
    el("dialog-overlay").classList.remove("hidden");

    const cleanup = () => {
      el("dialog-overlay").classList.add("hidden");
      el("dialog-ok").onclick = null;
      el("dialog-cancel").onclick = null;
    };
    el("dialog-ok").onclick = () => { cleanup(); resolve(true); };
    el("dialog-cancel").onclick = () => { cleanup(); resolve(false); };
  });
}

// --- ログイン ---
el("login-btn").onclick = async () => {
  backendUrl = el("backend-url").value.trim().replace(/\/$/, "");
  appSecret = el("app-secret").value.trim();
  const token = el("bot-token").value.trim();
  el("login-error").textContent = "";

  if (!backendUrl || !token) {
    el("login-error").textContent = "URLとトークンを入力してください";
    return;
  }

  localStorage.setItem("backendUrl", backendUrl);
  localStorage.setItem("appSecret", appSecret);

  try {
    const { me } = await api("/api/login", { method: "POST", body: JSON.stringify({ token }) });
    state.me = me;
    el("me-name").textContent = me.username;
    el("login-screen").classList.add("hidden");
    el("main-screen").classList.remove("hidden");
    connectWs();
    await loadGuilds();
  } catch (e) {
    el("login-error").textContent = "ログイン失敗: " + e.message;
  }
};

el("logout-btn").onclick = async () => {
  try { await api("/api/logout", { method: "POST" }); } catch {}
  location.reload();
};

// --- WebSocket(リアルタイム受信) ---
function connectWs() {
  const wsUrl = backendUrl.replace(/^http/, "ws") + "/ws";
  ws = new WebSocket(wsUrl);
  ws.onmessage = (evt) => {
    let msg;
    try { msg = JSON.parse(evt.data); } catch { return; }
    handleGatewayEvent(msg.type, msg.data);
  };
  ws.onclose = () => {
    setTimeout(connectWs, 3000);
  };
}

function handleGatewayEvent(type, data) {
  switch (type) {
    case "MESSAGE_CREATE":
      if (data.channel_id === state.currentChannelId) {
        appendChatMessage(data);
      }
      break;
    case "CHANNEL_CREATE":
    case "CHANNEL_UPDATE":
    case "CHANNEL_DELETE":
      if (data.guild_id === state.currentGuildId) loadChannels();
      break;
    case "GUILD_ROLE_CREATE":
    case "GUILD_ROLE_UPDATE":
    case "GUILD_ROLE_DELETE":
      if (data.guild_id === state.currentGuildId) loadRoles();
      break;
    case "GUILD_MEMBER_ADD":
    case "GUILD_MEMBER_REMOVE":
    case "GUILD_MEMBER_UPDATE":
      if (data.guild_id === state.currentGuildId) loadMembers();
      break;
    default:
      break;
  }
}

// --- サーバー(ギルド)一覧 ---
async function loadGuilds() {
  const { guilds } = await api("/api/guilds");
  state.guilds = guilds;
  const listEl = el("guild-list");
  listEl.innerHTML = "";
  guilds.forEach((g) => {
    const wrap = document.createElement("div");
    wrap.className = "guild-icon-wrap" + (g.id === state.currentGuildId ? " active" : "");
    wrap.title = g.name;
    wrap.innerHTML = avatarHtml(guildIconUrl(g), g.name, "guild-icon");
    wrap.onclick = () => selectGuild(g.id);
    listEl.appendChild(wrap);
  });
  if (guilds.length && !state.currentGuildId) {
    selectGuild(guilds[0].id);
  }
}

async function selectGuild(guildId) {
  state.currentGuildId = guildId;
  document.querySelectorAll(".guild-icon-wrap").forEach((d, i) => {
    d.classList.toggle("active", state.guilds[i].id === guildId);
  });

  const guild = state.guilds.find((g) => g.id === guildId);
  el("current-guild-name").textContent = guild ? guild.name : "サーバーを選択";
  const iconUrl = guildIconUrl(guild);
  const imgEl = el("current-guild-icon");
  const fallbackEl = el("current-guild-icon-fallback");
  if (iconUrl) {
    imgEl.src = iconUrl;
    imgEl.classList.remove("hidden");
    fallbackEl.classList.add("hidden");
  } else {
    fallbackEl.textContent = initials(guild?.name);
    fallbackEl.classList.remove("hidden");
    imgEl.classList.add("hidden");
  }

  await Promise.all([loadChannels(), loadMembers(), loadRoles()]);
}

// --- チャンネル ---
async function loadChannels() {
  if (!state.currentGuildId) return;
  const { channels } = await api(`/api/guilds/${state.currentGuildId}/channels`);
  state.channels = channels
    .filter((c) => c.type === 0) // テキストチャンネルのみ表示
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  renderChannels();
}

function renderChannels() {
  const listEl = el("channel-list");
  listEl.innerHTML = "";
  state.channels.forEach((c) => {
    const div = document.createElement("div");
    div.className = "list-item";
    div.innerHTML = `
      <span class="primary">
        <span class="channel-hash">#</span>
        <span class="name-block"><span class="name">${escapeHtml(c.name)}</span></span>
      </span>
      <span class="actions">
        <button data-act="edit" title="編集">✎</button>
        <button data-act="del" class="danger" title="削除">🗑</button>
      </span>`;
    div.querySelector('[data-act="edit"]').onclick = async (e) => {
      e.stopPropagation();
      await renameChannel(c);
    };
    div.querySelector('[data-act="del"]').onclick = async (e) => {
      e.stopPropagation();
      if (confirm(`#${c.name} を削除しますか？`)) {
        await api(`/api/channels/${c.id}`, { method: "DELETE" });
        loadChannels();
      }
    };
    div.onclick = () => openChat(c);
    listEl.appendChild(div);
  });
}

el("new-channel-btn").onclick = async () => {
  const ok = await showDialog("新規チャンネル", `<input id="dlg-channel-name" placeholder="チャンネル名" />`);
  if (!ok) return;
  const name = el("dlg-channel-name").value.trim();
  if (!name) return;
  await api(`/api/guilds/${state.currentGuildId}/channels`, {
    method: "POST",
    body: JSON.stringify({ name, type: 0 }),
  });
  loadChannels();
};

async function renameChannel(channel) {
  const ok = await showDialog("チャンネル名を編集", `<input id="dlg-channel-name" value="${escapeAttr(channel.name)}" />`);
  if (!ok) return;
  const name = el("dlg-channel-name").value.trim();
  if (!name) return;
  await api(`/api/channels/${channel.id}`, { method: "PATCH", body: JSON.stringify({ name }) });
  loadChannels();
}

// --- チャット ---
async function openChat(channel) {
  state.currentChannelId = channel.id;
  state.currentChannelName = channel.name;
  el("chat-channel-name").textContent = "#" + channel.name;
  el("chat-messages").innerHTML = "";
  el("chat-screen").classList.remove("hidden");

  const { messages } = await api(`/api/channels/${channel.id}/messages?limit=50`);
  messages.reverse().forEach(appendChatMessage);
  scrollChatToBottom();
}

el("chat-back-btn").onclick = () => {
  state.currentChannelId = null;
  el("chat-screen").classList.add("hidden");
};

// --- カスタム絵文字を含む本文をレンダリング ---
function renderContentWithEmoji(text) {
  if (!text) return "";
  const regex = /<(a?):(\w+):(\d+)>/g;
  let result = "";
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    result += escapeHtml(text.slice(lastIndex, match.index));
    const animated = match[1] === "a";
    const name = match[2];
    const id = match[3];
    const ext = animated ? "gif" : "png";
    result += `<img class="emoji" src="https://cdn.discordapp.com/emojis/${id}.${ext}" alt=":${escapeAttr(name)}:" title=":${escapeAttr(name)}:" />`;
    lastIndex = regex.lastIndex;
  }
  result += escapeHtml(text.slice(lastIndex));
  return result;
}

// --- 添付ファイル(画像・動画・ボイスメッセージ・その他)をレンダリング ---
function renderAttachments(attachments) {
  if (!attachments || !attachments.length) return "";
  return attachments
    .map((a) => {
      const type = a.content_type || "";
      const isVoiceMessage = (typeof a.duration_secs === "number") || ((a.flags || 0) & 8192);
      if (type.startsWith("image/")) {
        return `<div class="attachment"><img class="chat-attachment-image" src="${a.url}" alt="${escapeAttr(a.filename || "")}" /></div>`;
      }
      if (type.startsWith("video/")) {
        return `<div class="attachment"><video class="chat-attachment-video" controls src="${a.url}"></video></div>`;
      }
      if (type.startsWith("audio/") || isVoiceMessage) {
        const label = isVoiceMessage ? "🎙 ボイスメッセージ" : "🎵 " + escapeHtml(a.filename || "音声");
        return `<div class="attachment voice"><span class="voice-label">${label}</span><audio controls src="${a.url}"></audio></div>`;
      }
      return `<div class="attachment file"><a href="${a.url}" target="_blank" rel="noopener noreferrer">📎 ${escapeHtml(a.filename || "ファイル")}</a></div>`;
    })
    .join("");
}

// --- スタンプ(ステッカー)をレンダリング ---
function renderStickers(stickers) {
  if (!stickers || !stickers.length) return "";
  return stickers
    .map((s) => {
      if (s.format_type === 3) {
        // Lottieアニメーション形式は画像化できないため名前だけ表示
        return `<div class="sticker-fallback">🏷 ${escapeHtml(s.name)}</div>`;
      }
      const ext = s.format_type === 4 ? "gif" : "png";
      return `<img class="chat-sticker" src="https://cdn.discordapp.com/stickers/${s.id}.${ext}" alt="${escapeAttr(s.name)}" />`;
    })
    .join("");
}

// --- 埋め込み(embed)の画像・タイトルなど簡易レンダリング ---
function renderEmbeds(embeds) {
  if (!embeds || !embeds.length) return "";
  return embeds
    .map((e) => {
      const img = e.image?.url || e.thumbnail?.url;
      const borderColor = e.color ? `#${e.color.toString(16).padStart(6, "0")}` : "#5865f2";
      let html = `<div class="embed" style="border-left-color:${borderColor}">`;
      if (e.title) html += `<div class="embed-title">${escapeHtml(e.title)}</div>`;
      if (e.description) html += `<div class="embed-desc">${escapeHtml(e.description)}</div>`;
      if (img) html += `<img class="embed-image" src="${img}" />`;
      html += `</div>`;
      return html;
    })
    .join("");
}

function appendChatMessage(msg) {
  const div = document.createElement("div");
  div.className = "chat-msg";
  const time = msg.timestamp ? new Date(msg.timestamp).toLocaleString() : "";
  const color = msg.author ? roleColorForUser(msg.author.id) : null;
  const contentHtml = [
    msg.content ? `<div class="content">${renderContentWithEmoji(msg.content)}</div>` : "",
    renderStickers(msg.sticker_items),
    renderAttachments(msg.attachments),
    renderEmbeds(msg.embeds),
  ].join("");
  div.innerHTML = `
    ${avatarHtml(avatarUrl(msg.author), msg.author?.username)}
    <div class="body">
      <div class="head">
        <span class="author" style="${color ? `color:${color}` : ""}">${escapeHtml(msg.author?.username || "unknown")}</span>
        <span class="time">${time}</span>
      </div>
      ${contentHtml}
    </div>`;
  el("chat-messages").appendChild(div);
  scrollChatToBottom();
}

function scrollChatToBottom() {
  const box = el("chat-messages");
  box.scrollTop = box.scrollHeight;
}

async function sendChatMessage() {
  const input = el("chat-input-box");
  const content = input.value.trim();
  if (!content || !state.currentChannelId) return;
  input.value = "";
  await api(`/api/channels/${state.currentChannelId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
  // 実際の表示はGatewayのMESSAGE_CREATEイベント経由で行われる
}

el("chat-send-btn").onclick = sendChatMessage;
el("chat-input-box").addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendChatMessage();
});

// --- メンバー ---
async function loadMembers() {
  if (!state.currentGuildId) return;
  const { members } = await api(`/api/guilds/${state.currentGuildId}/members?limit=100`);
  state.members = members;
  renderMembers();
}

function renderMembers() {
  const listEl = el("member-list");
  listEl.innerHTML = "";
  state.members.forEach((m) => {
    const rolesOfMember = state.roles
      .filter((r) => (m.roles || []).includes(r.id) && r.name !== "@everyone")
      .sort((a, b) => (b.position ?? 0) - (a.position ?? 0));
    const roleChipsHtml = rolesOfMember
      .map((r) => {
        const color = r.color ? `#${r.color.toString(16).padStart(6, "0")}` : "#80848e";
        return `<span class="role-chip"><span class="dot" style="background:${color}"></span>${escapeHtml(r.name)}</span>`;
      })
      .join("");
    const displayName = m.user?.username || m.nick || "unknown";
    const nameColor = rolesOfMember.find((r) => r.color) ? `#${rolesOfMember.find((r) => r.color).color.toString(16).padStart(6, "0")}` : null;

    const div = document.createElement("div");
    div.className = "list-item";
    div.innerHTML = `
      <span class="primary">
        ${avatarHtml(avatarUrl(m.user), displayName)}
        <span class="name-block">
          <span class="name" style="${nameColor ? `color:${nameColor}` : ""}">${escapeHtml(displayName)}</span>
          <div class="roles">${roleChipsHtml}</div>
        </span>
      </span>
      <span class="actions">
        <button data-act="roles" title="ロール編集">🏷</button>
        <button data-act="kick" class="danger" title="キック">👢</button>
        <button data-act="ban" class="danger" title="BAN">⛔</button>
      </span>`;
    div.querySelector('[data-act="roles"]').onclick = () => editMemberRoles(m);
    div.querySelector('[data-act="kick"]').onclick = async () => {
      if (confirm(`${displayName} をキックしますか？`)) {
        await api(`/api/guilds/${state.currentGuildId}/members/${m.user.id}`, { method: "DELETE" });
        loadMembers();
      }
    };
    div.querySelector('[data-act="ban"]').onclick = async () => {
      if (confirm(`${displayName} をBANしますか？`)) {
        await api(`/api/guilds/${state.currentGuildId}/bans/${m.user.id}`, { method: "PUT", body: JSON.stringify({}) });
        loadMembers();
      }
    };
    listEl.appendChild(div);
  });
}

el("refresh-members-btn").onclick = loadMembers;

async function editMemberRoles(member) {
  const checkboxes = state.roles
    .filter((r) => r.name !== "@everyone")
    .map((r) => {
      const checked = (member.roles || []).includes(r.id) ? "checked" : "";
      return `<label style="display:block;text-align:left;margin-bottom:4px;">
        <input type="checkbox" data-role-id="${r.id}" ${checked}/> ${escapeHtml(r.name)}
      </label>`;
    })
    .join("");
  const ok = await showDialog(`${member.user?.username} のロール`, checkboxes || "<p>ロールがありません</p>");
  if (!ok) return;

  const boxes = document.querySelectorAll("#dialog-body input[type=checkbox]");
  for (const box of boxes) {
    const roleId = box.dataset.roleId;
    const currentlyHas = (member.roles || []).includes(roleId);
    if (box.checked && !currentlyHas) {
      await api(`/api/guilds/${state.currentGuildId}/members/${member.user.id}/roles/${roleId}`, { method: "PUT" });
    } else if (!box.checked && currentlyHas) {
      await api(`/api/guilds/${state.currentGuildId}/members/${member.user.id}/roles/${roleId}`, { method: "DELETE" });
    }
  }
  loadMembers();
}

// --- ロール ---
async function loadRoles() {
  if (!state.currentGuildId) return;
  const { roles } = await api(`/api/guilds/${state.currentGuildId}/roles`);
  state.roles = roles;
  renderRoles();
}

function renderRoles() {
  const listEl = el("role-list");
  listEl.innerHTML = "";
  state.roles
    .filter((r) => r.name !== "@everyone")
    .forEach((r) => {
      const color = r.color ? `#${r.color.toString(16).padStart(6, "0")}` : "#80848e";
      const div = document.createElement("div");
      div.className = "list-item";
      div.innerHTML = `
        <span class="primary">
          <span class="role-chip"><span class="dot" style="background:${color}"></span>${escapeHtml(r.name)}</span>
        </span>
        <span class="actions"><button data-act="del" class="danger" title="削除">🗑</button></span>`;
      div.querySelector('[data-act="del"]').onclick = async () => {
        if (confirm(`ロール「${r.name}」を削除しますか？`)) {
          await api(`/api/guilds/${state.currentGuildId}/roles/${r.id}`, { method: "DELETE" });
          loadRoles();
        }
      };
      listEl.appendChild(div);
    });
}

el("new-role-btn").onclick = async () => {
  const ok = await showDialog(
    "新規ロール",
    `<input id="dlg-role-name" placeholder="ロール名" />
     <input id="dlg-role-color" type="color" value="#99aab5" />`
  );
  if (!ok) return;
  const name = el("dlg-role-name").value.trim();
  const colorHex = el("dlg-role-color").value;
  if (!name) return;
  const color = parseInt(colorHex.replace("#", ""), 16);
  await api(`/api/guilds/${state.currentGuildId}/roles`, {
    method: "POST",
    body: JSON.stringify({ name, color }),
  });
  loadRoles();
};

// --- タブ切り替え ---
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
    btn.classList.add("active");
    el("tab-" + btn.dataset.tab).classList.remove("hidden");
  };
});

// --- ユーティリティ ---
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, "&quot;");
}

// --- 初期表示: 前回のバックエンドURLを復元(トークンは保存しない) ---
if (backendUrl) el("backend-url").value = backendUrl;
