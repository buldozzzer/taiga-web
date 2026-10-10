import {spawn, type ChildProcess} from 'node:child_process';
import net from 'node:net';
import type {Duplex, Readable, Writable} from 'node:stream';

/** The core asks for a passed Yandex check (MsgCookiesRequest). */
export interface IpcCookiesRequest {
  transport: string;
  url: string;
  reason?: string;
  remote?: boolean;
  proxy?: string;
}

/** Cookies for the core (MsgCookiesOffer); remote ones go on to the exit. */
export interface IpcCookiesOffer {
  transport: string;
  jar: Record<string, string>;
  domain?: string;
  remote?: boolean;
}

/** The core's once-a-second report (MsgStatus). */
export interface IpcStatus {
  running?: boolean;
  connected?: boolean;
  bytes_in?: number;
  bytes_out?: number;
  uptime_ms?: number;
  active?: string;
  active_all?: string[];
}

export type IpcMessage = {type: 'cookies'; request: IpcCookiesRequest} | {type: 'status'; status: IpcStatus};

const COOKIES_REQUEST = 1;
const COOKIES_OFFER = 2;
const STATUS = 3;
const MAX_FRAME_BYTES = 1 << 20;

/** Frames: a big-endian uint32 length (type byte included), one type byte, a JSON body. */
export function encodeFrame(type: number, payload: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  if (body.length + 1 > MAX_FRAME_BYTES) throw new Error('IPC frame too large');
  const head = Buffer.alloc(5);
  head.writeUInt32BE(body.length + 1, 0);
  head.writeUInt8(type, 4);
  return Buffer.concat([head, body]);
}

/** Splits a byte stream into the messages the app cares about. */
export class FrameReader {
  private buffer = Buffer.alloc(0);

  push(chunk: Buffer): IpcMessage[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const out: IpcMessage[] = [];
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32BE(0);
      if (length < 1 || length > MAX_FRAME_BYTES) throw new Error(`Invalid IPC frame length: ${length}`);
      if (this.buffer.length < 4 + length) break;
      const type = this.buffer.readUInt8(4);
      const body = this.buffer.subarray(5, 4 + length).toString('utf8');
      this.buffer = this.buffer.subarray(4 + length);
      if (type === COOKIES_REQUEST) out.push({type: 'cookies', request: JSON.parse(body)});
      else if (type === STATUS) out.push({type: 'status', status: JSON.parse(body)});
    }
    return out;
  }
}

export interface IpcConnection {
  offerCookies(offer: IpcCookiesOffer): void;
  close(): void;
}

export interface IpcHandlers {
  onMessage(message: IpcMessage): void;
  /** The socket answered. */
  onOpen(): void;
  /** The connection ended; `neverOpened` when the socket did not answer in time. */
  onClose(neverOpened: boolean, error?: Error): void;
}

/**
 * Connects to the core's IPC socket, retrying for `waitMs` while the core
 * starts. On Windows it goes through taiga-ipc-relay (see tools/ipc-relay).
 */
export function connectIpc(socketPath: string, waitMs: number, relay: string | null, h: IpcHandlers): IpcConnection {
  let input: Readable | null = null;
  let output: Writable | null = null;
  let closed = false;
  let opened = false;
  let child: ChildProcess | null = null;
  let socket: Duplex | null = null;
  let timer: NodeJS.Timeout | null = null;
  const reader = new FrameReader();

  const finish = (error?: Error) => {
    if (closed) return;
    closed = true;
    if (timer) clearTimeout(timer);
    socket?.destroy();
    child?.kill();
    h.onClose(!opened, error);
  };

  const onData = (chunk: Buffer) => {
    if (!opened) {
      opened = true;
      h.onOpen();
    }
    try {
      for (const m of reader.push(chunk)) h.onMessage(m);
    } catch (e) {
      finish(e as Error);
    }
  };

  if (relay) {
    child = spawn(relay, [socketPath, String(waitMs)], {windowsHide: true, stdio: ['pipe', 'pipe', 'ignore']});
    input = child.stdout!;
    output = child.stdin!;
    input.on('data', onData);
    child.on('error', e => finish(e));
    child.on('exit', () => finish());
    // The relay says nothing until the core does; the core's first status
    // comes within a second, so data is the sign the socket answered.
  } else {
    const deadline = Date.now() + waitMs;
    const attempt = () => {
      if (closed) return;
      const s = net.connect({path: socketPath});
      s.once('connect', () => {
        socket = s;
        output = s;
        opened = true;
        h.onOpen();
        s.on('data', onData);
        s.on('close', () => finish());
      });
      s.once('error', e => {
        if (socket === s) return finish(e);
        s.destroy();
        if (Date.now() > deadline) return finish(e);
        timer = setTimeout(attempt, 150);
      });
    };
    attempt();
  }

  return {
    offerCookies(offer) {
      if (!output || closed) throw new Error('Ядро не на связи');
      output.write(encodeFrame(COOKIES_OFFER, offer));
    },
    close: () => finish(),
  };
}
