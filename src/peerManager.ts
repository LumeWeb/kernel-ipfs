import { Peer } from "@lumeweb/libhyperproxy";
import b4a from "b4a";
// @ts-ignore
import { fixed32, json, raw, uint } from "compact-encoding";
import { TcpSocketConnectOpts } from "net";
import { Helia } from "@helia/interface";
import { deserializeError } from "serialize-error";
import {
  CloseSocketRequest,
  ErrorSocketRequest,
  PeerEntity,
  PeerInfoResult,
  SocketRequest,
  WriteSocketRequest,
} from "./types.js";
import { Socket } from "./socket.js";

function idFactory(start: number, step = 1, limit = 2 ** 32) {
  let id = start;

  return function nextId() {
    const nextId = id;
    id += step;
    if (id >= limit) id = start;
    return nextId;
  };
}

const nextSocketId = idFactory(1);

function roundRobinFactory(list: Map<string, any>) {
  let index = 0;

  return (): PeerEntity => {
    const keys = [...list.keys()].sort();
    if (index >= keys.length) {
      index = 0;
    }

    return list.get(keys[index++]);
  };
}

const socketEncoding = {
  preencode(state: any, m: SocketRequest) {
    uint.preencode(state, m.id);
    uint.preencode(state, m.remoteId);
  },
  encode(state: any, m: SocketRequest) {
    uint.encode(state, m.id);
    uint.encode(state, m.remoteId);
  },
  decode(state: any, m: any): SocketRequest {
    return {
      remoteId: uint.decode(state, m),
      id: uint.decode(state, m),
    };
  },
};

const writeSocketEncoding = {
  preencode(state: any, m: WriteSocketRequest) {
    socketEncoding.preencode(state, m);
    raw.preencode(state, m.data);
  },
  encode(state: any, m: WriteSocketRequest) {
    socketEncoding.encode(state, m);
    raw.encode(state, m.data);
  },
  decode(state: any, m: any): WriteSocketRequest {
    const socket = socketEncoding.decode(state, m);
    return {
      ...socket,
      data: raw.decode(state, m),
    };
  },
};

const errorSocketEncoding = {
  decode(state: any, m: any): ErrorSocketRequest {
    const socket = socketEncoding.decode(state, m);
    return {
      ...socket,
      err: deserializeError(json.decode(state, m)),
    };
  },
};

export default class PeerManager {
  private static _instance: PeerManager;

  public static get instance(): PeerManager {
    if (!PeerManager._instance) {
      PeerManager._instance = new PeerManager();
    }

    return PeerManager._instance;
  }

  private _sockets = new Map<number, Socket>();

  get sockets(): Map<number, Socket> {
    return this._sockets;
  }

  private _socketMap = new Map<number, number>();

  get socketMap(): Map<number, number> {
    return this._socketMap;
  }

  private _peers: Map<string, PeerEntity> = new Map<string, PeerEntity>();

  private _nextPeer = roundRobinFactory(this._peers);

  get peers(): Map<string, PeerEntity> {
    return this._peers;
  }

  private _ipfs?: Helia;

  get ipfs(): Helia {
    return this._ipfs as Helia;
  }

  set ipfs(value: Helia) {
    this._ipfs = value as Helia;
  }

  private _ipfsReady?: Promise<void>;
  private _ipfsResolve?: () => void;

  get ipfsReady(): Promise<void> {
    if (!this._ipfsReady) {
      this._ipfsReady = new Promise((resolve) => {
        this._ipfsResolve = resolve;
      });
    }

    return this._ipfsReady as Promise<any>;
  }

  handleNewPeerChannel(peer: Peer, channel: any) {
    this.update(peer.socket.remotePublicKey, { peer });

    this._registerOpenSocketMessage(peer, channel);
    this._registerWriteSocketMessage(peer, channel);
    this._registerCloseSocketMessage(peer, channel);
    this._registerTimeoutSocketMessage(peer, channel);
    this._registerErrorSocketMessage(peer, channel);
  }

  async handleNewPeer() {
    if (!this.ipfs.libp2p.isStarted()) {
      await this.ipfs.libp2p.start();
      this._ipfsResolve?.();
    }
  }

  async handleClosePeer(peer: Peer) {
    for (const item of this._sockets) {
      if (item[1].peer.peer === peer) {
        item[1].end();
      }
    }

    const pubkey = this._toString(peer.socket.remotePublicKey);

    if (this._peers.has(pubkey)) {
      this._peers.delete(pubkey);
    }
  }

  public get(pubkey: Uint8Array): PeerEntity | undefined {
    if (this._peers.has(this._toString(pubkey))) {
      return this._peers.get(this._toString(pubkey)) as PeerEntity;
    }

    return undefined;
  }

  public update(pubkey: Uint8Array, data: Partial<PeerEntity>): void {
    const peer = this.get(pubkey) ?? ({} as PeerEntity);

    this._peers.set(this._toString(pubkey), {
      ...peer,
      ...data,
      ...{
        messages: {
          ...peer?.messages,
          ...data?.messages,
        },
      },
    } as PeerEntity);
  }

  public async createSocket(options: TcpSocketConnectOpts): Promise<Socket> {
    if (!this.peers.size) {
      throw new Error("no peers found");
    }

    const peer = this._nextPeer();
    const socketId = nextSocketId();
    const socket = new Socket(socketId, this, peer, options);
    this._sockets.set(socketId, socket);

    return socket;
  }

  private _registerOpenSocketMessage(peer: Peer, channel: any) {
    const self = this;
    const message = channel.addMessage({
      encoding: {
        preencode: json.preencode,
        encode: json.encode,
        decode: socketEncoding.decode,
      },
      async onmessage(m: SocketRequest) {
        const socket = self._sockets.get(m.id);
        if (socket) {
          socket.remoteId = m.remoteId;
          // @ts-ignore
          socket.emit("connect");
        }
      },
    });
    this.update(peer.socket.remotePublicKey, {
      messages: { openSocket: message },
    });
  }

  private _registerWriteSocketMessage(peer: Peer, channel: any) {
    const self = this;
    const message = channel.addMessage({
      encoding: writeSocketEncoding,
      onmessage(m: WriteSocketRequest) {
        self._sockets.get(m.id)?.push(m.data);
      },
    });
    this.update(peer.socket.remotePublicKey, {
      messages: { writeSocket: message },
    });
  }

  private _registerCloseSocketMessage(peer: Peer, channel: any) {
    const self = this;
    const message = channel.addMessage({
      encoding: socketEncoding,
      onmessage(m: CloseSocketRequest) {
        self._sockets.get(m.id)?.end();
      },
    });
    this.update(peer.socket.remotePublicKey, {
      messages: { closeSocket: message },
    });
  }

  private _registerTimeoutSocketMessage(peer: Peer, channel: any) {
    const self = this;
    const message = channel.addMessage({
      encoding: socketEncoding,
      onmessage(m: SocketRequest) {
        // @ts-ignore
        self._sockets.get(m.id)?.emit("timeout");
      },
    });
    this.update(peer.socket.remotePublicKey, {
      messages: { timeoutSocket: message },
    });
  }

  private _registerErrorSocketMessage(peer: Peer, channel: any) {
    const self = this;
    const message = channel.addMessage({
      encoding: errorSocketEncoding,
      onmessage(m: ErrorSocketRequest) {
        // @ts-ignore
        self._sockets.get(m.id)?.emit("error", m.err);
      },
    });
    this.update(peer.socket.remotePublicKey, {
      messages: { errorSocket: message },
    });
  }

  private _toString(pubkey: Uint8Array) {
    return b4a.from(pubkey).toString("hex");
  }
}
