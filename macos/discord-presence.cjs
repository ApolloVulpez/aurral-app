const { randomUUID } = require("node:crypto");
const { existsSync } = require("node:fs");
const { createConnection } = require("node:net");
const path = require("node:path");

const maxFrameSize = 64 * 1024;

function packet(opcode, data) {
  const frame = Buffer.alloc(8 + data.length);
  frame.writeUInt32LE(opcode, 0);
  frame.writeUInt32LE(data.length, 4);
  data.copy(frame, 8);
  return frame;
}

function activityPacket(activity) {
  return packet(1, Buffer.from(JSON.stringify({
    cmd: "SET_ACTIVITY", args: { pid: process.pid, activity }, nonce: randomUUID(),
  })));
}

function discordSockets() {
  const { XDG_RUNTIME_DIR, TMPDIR, TMP, TEMP } = process.env;
  const dirs = [XDG_RUNTIME_DIR, TMPDIR, TMP, TEMP, "/tmp"];
  if (process.platform === "linux" && XDG_RUNTIME_DIR) {
    dirs.push(path.join(XDG_RUNTIME_DIR, "app", "com.discordapp.Discord"));
  }
  return [...new Set(dirs.filter(Boolean))].flatMap(dir =>
    Array.from({ length: 10 }, (_, index) => path.join(dir, `discord-ipc-${index}`))).filter(existsSync);
}

class DiscordPresence {
  #clientId;
  #socket;
  #activity;
  #nextAttempt = 0;
  #revision = 0;

  constructor(clientId) {
    this.#clientId = clientId;
  }

  get connected() { return Boolean(this.#socket?.ready); }

  async update(activity) {
    if (!this.connected) {
      if (!activity || Date.now() < this.#nextAttempt) return;
      this.#nextAttempt = Date.now() + 10_000;
      const revision = this.#revision;
      for (const address of discordSockets()) {
        if (await this.#connect(address) || revision !== this.#revision) break;
      }
    }
    if (!this.connected) return;
    const serialized = JSON.stringify(activity);
    if (serialized === this.#activity) return;
    this.#socket.write(activityPacket(activity));
    this.#activity = serialized;
  }

  disconnect() {
    this.#revision++;
    this.#nextAttempt = 0;
    const socket = this.#socket;
    if (socket?.ready && this.#activity && this.#activity !== "null") {
      socket.end(activityPacket(null));
      socket.setTimeout(1_000);
    } else {
      socket?.destroy();
    }
    this.#socket = undefined;
    this.#activity = undefined;
  }

  #connect(address) {
    return new Promise(resolve => {
      const socket = createConnection(address);
      this.#socket = socket;
      let buffer = Buffer.alloc(0);
      socket.setTimeout(2_000, () => socket.destroy());
      socket.on("error", () => socket.destroy());
      socket.once("close", () => {
        if (this.#socket === socket) {
          this.#socket = undefined;
          this.#activity = undefined;
        }
        resolve(false);
      });
      socket.once("connect", () => {
        socket.write(packet(0, Buffer.from(JSON.stringify({ v: 1, client_id: this.#clientId }))));
      });
      socket.on("data", bytes => {
        buffer = Buffer.concat([buffer, bytes]);
        while (buffer.length >= 8) {
          const opcode = buffer.readUInt32LE(0);
          const length = buffer.readUInt32LE(4);
          if (length > maxFrameSize || opcode === 2) return socket.destroy();
          if (buffer.length < 8 + length) return;
          const data = buffer.subarray(8, 8 + length);
          buffer = buffer.subarray(8 + length);
          if (opcode === 3) socket.write(packet(4, data));
          if (opcode !== 1) continue;
          let message;
          try { message = JSON.parse(data); } catch { return socket.destroy(); }
          if (message?.evt === "ERROR") return socket.destroy();
          if (!socket.ready && message?.cmd === "DISPATCH" && message.evt === "READY") {
            socket.ready = true;
            socket.setTimeout(0);
            resolve(true);
          }
        }
      });
    });
  }
}

module.exports = { DiscordPresence };
