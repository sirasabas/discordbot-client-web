// server/wsHub.js
// ブラウザ側とのWebSocket接続を管理し、Discordから受け取ったイベントを配信する。

const WebSocket = require("ws");

class WsHub {
  constructor(server, path = "/ws") {
    this.wss = new WebSocket.Server({ server, path });
    this.clients = new Set();

    this.wss.on("connection", (socket) => {
      this.clients.add(socket);
      socket.on("close", () => this.clients.delete(socket));
    });
  }

  broadcast(type, data) {
    const msg = JSON.stringify({ type, data });
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  }
}

module.exports = { WsHub };
