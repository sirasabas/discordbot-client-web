// server/discordRest.js
// Discord REST API (v10) への薄いラッパー。Botトークンを使って各種操作を行う。

const API_BASE = "https://discord.com/api/v10";

class DiscordRestError extends Error {
  constructor(status, body) {
    super(`Discord API error ${status}: ${JSON.stringify(body)}`);
    this.status = status;
    this.body = body;
  }
}

class DiscordRest {
  constructor(token) {
    this.token = token;
  }

  async request(method, path, body) {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bot ${this.token}`,
        "Content-Type": "application/json",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (res.status === 204) return null;

    const text = await res.text();
    const json = text ? JSON.parse(text) : null;

    if (!res.ok) {
      throw new DiscordRestError(res.status, json);
    }
    return json;
  }

  // --- 認証確認 ---
  getMe() {
    return this.request("GET", "/users/@me");
  }

  // --- サーバー(ギルド) ---
  getGuilds() {
    return this.request("GET", "/users/@me/guilds");
  }

  // --- チャンネル ---
  getGuildChannels(guildId) {
    return this.request("GET", `/guilds/${guildId}/channels`);
  }

  createChannel(guildId, { name, type = 0, topic }) {
    return this.request("POST", `/guilds/${guildId}/channels`, { name, type, topic });
  }

  editChannel(channelId, patch) {
    return this.request("PATCH", `/channels/${channelId}`, patch);
  }

  deleteChannel(channelId) {
    return this.request("DELETE", `/channels/${channelId}`);
  }

  // --- メッセージ ---
  getMessages(channelId, limit = 50, before) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (before) params.set("before", before);
    return this.request("GET", `/channels/${channelId}/messages?${params}`);
  }

  sendMessage(channelId, content) {
    return this.request("POST", `/channels/${channelId}/messages`, { content });
  }

  // --- ロール ---
  getGuildRoles(guildId) {
    return this.request("GET", `/guilds/${guildId}/roles`);
  }

  createRole(guildId, { name, color = 0, permissions }) {
    return this.request("POST", `/guilds/${guildId}/roles`, { name, color, permissions });
  }

  deleteRole(guildId, roleId) {
    return this.request("DELETE", `/guilds/${guildId}/roles/${roleId}`);
  }

  addMemberRole(guildId, userId, roleId) {
    return this.request("PUT", `/guilds/${guildId}/members/${userId}/roles/${roleId}`);
  }

  removeMemberRole(guildId, userId, roleId) {
    return this.request("DELETE", `/guilds/${guildId}/members/${userId}/roles/${roleId}`);
  }

  // --- メンバー ---
  getGuildMembers(guildId, limit = 100) {
    return this.request("GET", `/guilds/${guildId}/members?limit=${limit}`);
  }

  kickMember(guildId, userId) {
    return this.request("DELETE", `/guilds/${guildId}/members/${userId}`);
  }

  banMember(guildId, userId, reason) {
    return this.request(
      "PUT",
      `/guilds/${guildId}/bans/${userId}`,
      reason ? { delete_message_seconds: 0, reason } : {}
    );
  }
}

module.exports = { DiscordRest, DiscordRestError };
