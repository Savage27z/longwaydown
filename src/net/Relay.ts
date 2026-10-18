/**
 * Fallback transport when a direct WebRTC link can't be made (different networks, strict NAT):
 * a minimal MQTT 3.1.1 client (QoS 0 publish / subscribe) over a secure WebSocket to a free
 * public broker. Works anywhere the web works. Messages are small JSON strings.
 */

/** Public brokers, tried in order. */
export const RELAY_BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081/mqtt'];
const KEEPALIVE = 30;

const enc = new TextEncoder();
const dec = new TextDecoder();

function str(s: string): number[] {
  const b = enc.encode(s);
  return [b.length >> 8, b.length & 255, ...b];
}

function packet(type: number, body: number[] | Uint8Array): Uint8Array<ArrayBuffer> {
  const len: number[] = [];
  let n = body.length;
  do {
    let byte = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) byte |= 128;
    len.push(byte);
  } while (n > 0);
  const out = new Uint8Array(1 + len.length + body.length);
  out[0] = type;
  out.set(len, 1);
  out.set(body, 1 + len.length);
  return out;
}

export class Relay {
  onMessage: ((topic: string, data: string) => void) | null = null;
  onClose: (() => void) | null = null;
  private ws: WebSocket | null = null;
  private packetId = 1;
  private ping = 0;
  private buf = new Uint8Array(0);
  private closed = false;

  /** Connect to the first broker that answers. */
  static async connect(clientId: string): Promise<Relay> {
    let last: unknown = null;
    for (const url of RELAY_BROKERS) {
      const r = new Relay();
      try {
        await r.open(url, clientId);
        return r;
      } catch (e) {
        last = e;
        r.close();
      }
    }
    throw last instanceof Error ? last : new Error('No relay reachable.');
  }

  private open(url: string, clientId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, 'mqtt');
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      const timer = window.setTimeout(() => reject(new Error('Relay timeout')), 8000);
      ws.onopen = () => {
        // CONNECT: protocol "MQTT" level 4, clean session, keepalive.
        ws.send(packet(0x10, [...str('MQTT'), 4, 2, 0, KEEPALIVE, ...str(clientId)]));
      };
      ws.onerror = () => {
        window.clearTimeout(timer);
        reject(new Error('Relay error'));
      };
      ws.onclose = () => {
        window.clearTimeout(timer);
        window.clearInterval(this.ping);
        if (!this.closed) {
          this.closed = true;
          this.onClose?.();
        }
        reject(new Error('Relay closed'));
      };
      ws.onmessage = (e) => {
        const first = this.buf.length === 0 && (new Uint8Array(e.data as ArrayBuffer)[0] ?? 0) >> 4 === 2;
        this.feed(new Uint8Array(e.data as ArrayBuffer));
        if (first) {
          window.clearTimeout(timer);
          this.ping = window.setInterval(() => this.send(packet(0xc0, [])), (KEEPALIVE * 1000) / 2);
          resolve();
        }
      };
    });
  }

  /** Parse whole packets out of the stream (WebSocket frames may split or join them). */
  private feed(chunk: Uint8Array): void {
    const b = new Uint8Array(this.buf.length + chunk.length);
    b.set(this.buf);
    b.set(chunk, this.buf.length);
    let i = 0;
    while (i < b.length) {
      let mul = 1;
      let len = 0;
      let j = i + 1;
      let byte = 0;
      do {
        if (j >= b.length) {
          this.buf = b.slice(i);
          return;
        }
        byte = b[j++]!;
        len += (byte & 127) * mul;
        mul *= 128;
      } while (byte & 128);
      if (j + len > b.length) break;
      const type = b[i]! >> 4;
      if (type === 3) {
        // PUBLISH (QoS 0): topic, then payload.
        const tl = (b[j]! << 8) | b[j + 1]!;
        const topic = dec.decode(b.subarray(j + 2, j + 2 + tl));
        const data = dec.decode(b.subarray(j + 2 + tl, j + len));
        this.onMessage?.(topic, data);
      }
      i = j + len;
    }
    this.buf = b.slice(i);
  }

  private send(p: Uint8Array<ArrayBuffer>): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(p);
  }

  subscribe(topic: string): void {
    const id = this.packetId++ & 0xffff || 1;
    this.send(packet(0x82, [id >> 8, id & 255, ...str(topic), 0]));
  }

  publish(topic: string, data: string): void {
    const t = str(topic);
    const payload = enc.encode(data);
    const body = new Uint8Array(t.length + payload.length);
    body.set(t);
    body.set(payload, t.length);
    this.send(packet(0x30, body));
  }

  close(): void {
    this.closed = true;
    window.clearInterval(this.ping);
    try {
      this.send(packet(0xe0, []));
      this.ws?.close();
    } catch {
      // already gone
    }
  }
}
