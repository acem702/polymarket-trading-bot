import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import net from "node:net";
import type { CollectorFrame } from "@pmt/shared";

export class IpcServer {
  private lastFrame: Buffer | null = null;
  private clients = new Set<net.Socket>();

  static bind(path: string): IpcServer {
    if (!path.startsWith("\\\\.\\pipe\\") && existsSync(path)) unlinkSync(path);
    const parent = dirname(path);
    if (parent && parent !== "." && !existsSync(parent)) {
      mkdirSync(parent, { recursive: true });
    }

    const server = new IpcServer();
    const listener = net.createServer((socket) => {
      server.clients.add(socket);
      if (server.lastFrame) socket.write(server.lastFrame);
      socket.on("close", () => server.clients.delete(socket));
      socket.on("error", () => server.clients.delete(socket));
    });
    listener.on("error", (err) => {
      console.error(`ipc server failed on ${path}:`, err.message);
      process.exit(1);
    });
    listener.listen(path);
    console.log(`ipc server listening on ${path}`);
    return server;
  }

  broadcast(frame: CollectorFrame): void {
    const bytes = Buffer.from(`${JSON.stringify(frame)}\n`);
    this.lastFrame = bytes;
    for (const client of this.clients) {
      if (!client.destroyed) client.write(bytes);
    }
  }
}
