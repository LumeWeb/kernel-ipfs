import { symbol } from "@libp2p/interface-transport";
// @ts-ignore
import { TCP, TCPComponents, TCPDialOptions, TCPOptions } from "@libp2p/tcp";
import PeerManager from "../peerManager.js";
import { Multiaddr } from "@multiformats/multiaddr";
import { IpcSocketConnectOpts, TcpSocketConnectOpts } from "net";
import { logger } from "@libp2p/logger";
import { AbortError, CodeError } from "@libp2p/interfaces/errors";
// @ts-ignore
import { multiaddrToNetConfig } from "@libp2p/tcp/utils";
import { Socket } from "../socket.js";
import { Connection } from "@libp2p/interface-connection";
// @ts-ignore
import { toMultiaddrConnection } from "@libp2p/tcp/socket-to-conn";
import * as mafmt from "@multiformats/mafmt";

const log = logger("libp2p:hypercore");

import isPrivateIp from "private-ip";

const CODE_P2P = 421;
const CODE_CIRCUIT = 290;
const CODE_UNIX = 400;

export interface HypercoreOptions extends TCPOptions {
  peerManager?: PeerManager;
}
class HypercoreTransport extends TCP {
  private readonly opts?: HypercoreOptions;
  private metrics: any;
  constructor(components: TCPComponents, options: HypercoreOptions = {}) {
    super(components, options);
    this.opts = options;
    if (!options.peerManager) {
      throw new Error("options.peerManager is required");
    }
    this.opts?.peerManager;
  }

  get [symbol](): true {
    return true;
  }

  get [Symbol.toStringTag](): string {
    return "@libp2p/hypercore";
  }

  async dial(ma: Multiaddr, options: TCPDialOptions): Promise<Connection> {
    options.keepAlive = options.keepAlive ?? true;

    // options.signal destroys the socket before 'connect' event
    const socket = await this._connect(ma, options);

    // Avoid uncaught errors caused by unstable connections
    socket.on("error", (err) => {
      log("socket error", err);
    });

    const maConn = toMultiaddrConnection(socket as any, {
      remoteAddr: ma,
      socketInactivityTimeout: this.opts?.outboundSocketInactivityTimeout,
      socketCloseTimeout: this.opts?.socketCloseTimeout,
      metrics: this.metrics?.dialerEvents,
    });

    const onAbort = (): void => {
      maConn.close().catch((err: any) => {
        log.error("Error closing maConn after abort", err);
      });
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });

    log("new outbound connection %s", maConn.remoteAddr);
    const conn = await options.upgrader.upgradeOutbound(maConn);
    log("outbound connection %s upgraded", maConn.remoteAddr);

    options.signal?.removeEventListener("abort", onAbort);

    if (options.signal?.aborted === true) {
      conn.close().catch((err) => {
        log.error("Error closing conn after abort", err);
      });

      throw new AbortError();
    }

    return conn;
  }

  async _connect(ma: Multiaddr, options: TCPDialOptions): Promise<Socket> {
    if (options.signal?.aborted === true) {
      throw new AbortError();
    }

    return await new Promise<Socket>(async (resolve, reject) => {
      const start = Date.now();
      const cOpts = multiaddrToNetConfig(ma) as IpcSocketConnectOpts &
        TcpSocketConnectOpts;
      const cOptsStr = cOpts.path ?? `${cOpts.host ?? ""}:${cOpts.port}`;

      log("dialing %j", cOpts);

      let rawSocket: Socket;

      const onError = (err: Error): void => {
        err.message = `connection error ${cOptsStr}: ${err.message}`;
        this.metrics?.dialerEvents.increment({ error: true });

        done(err);
      };

      const onTimeout = (): void => {
        log("connection timeout %s", cOptsStr);
        this.metrics?.dialerEvents.increment({ timeout: true });

        const err = new CodeError(
          `connection timeout after ${Date.now() - start}ms`,
          "ERR_CONNECT_TIMEOUT"
        );
        // Note: this will result in onError() being called
        rawSocket?.emit("error", err);
      };

      const onConnect = (): void => {
        log("connection opened %j", cOpts);
        this.metrics?.dialerEvents.increment({ connect: true });
        done();
      };

      const onAbort = (): void => {
        log("connection aborted %j", cOpts);
        this.metrics?.dialerEvents.increment({ abort: true });
        rawSocket?.destroy();
        done(new AbortError());
      };

      const done = (err?: any): void => {
        rawSocket?.removeListener("error", onError);
        // @ts-ignore
        rawSocket?.removeListener("timeout", onTimeout);
        // @ts-ignore
        rawSocket?.removeListener("connect", onConnect);

        if (options.signal != null) {
          options.signal.removeEventListener("abort", onAbort);
        }

        if (err != null) {
          reject(err);
          return;
        }

        resolve(rawSocket as Socket);
      };

      try {
        rawSocket = (await this.opts?.peerManager?.createSocket(
          cOpts
        )) as Socket;
      } catch (e: any) {
        onError(e);
      }

      // @ts-ignore
      rawSocket = rawSocket as Socket;

      // @ts-ignore
      rawSocket?.on("error", onError);
      // @ts-ignore
      rawSocket?.on("timeout", onTimeout);
      // @ts-ignore
      rawSocket?.on("connect", onConnect);

      if (options.signal != null) {
        options.signal.addEventListener("abort", onAbort);
      }

      rawSocket?.connect();
    });
  }

  filter(multiaddrs: Multiaddr[]): Multiaddr[] {
    multiaddrs = Array.isArray(multiaddrs) ? multiaddrs : [multiaddrs];

    return multiaddrs.filter((ma) => {
      if (ma.protoCodes().includes(CODE_CIRCUIT)) {
        return false;
      }

      if (ma.protoCodes().includes(CODE_UNIX)) {
        return true;
      }

      const addr = ma.nodeAddress();

      if (isPrivateIp(addr.address)) {
        return false;
      }

      return mafmt.TCP.matches(ma.decapsulateCode(CODE_P2P));
    });
  }
}

export function hypercoreTransport(
  init: HypercoreOptions = {}
): (components?: TCPComponents) => HypercoreTransport {
  return (components: TCPComponents = {}) => {
    return new HypercoreTransport(components, init);
  };
}
