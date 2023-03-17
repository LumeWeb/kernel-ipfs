import { Callback, Duplex } from "streamx";
import { TcpSocketConnectOpts } from "net";
import { PeerEntity, SocketRequest, WriteSocketRequest } from "./types.js";
import PeerManager from "./peerManager.js";
import { clearTimeout } from "timers";

const asyncIterator = Symbol.asyncIterator || Symbol("asyncIterator");

const STREAM_DESTROYED = new Error("Stream was destroyed");
const READ_DONE = 0b0010000000000 << 4;
const DESTROYED = 0b1000;

export class Socket extends Duplex {
  private _options: TcpSocketConnectOpts;
  private _id: number;
  private _manager: PeerManager;

  private _connectTimeout?: number;

  constructor(
    id: number,
    manager: PeerManager,
    peer: PeerEntity,
    options: TcpSocketConnectOpts
  ) {
    super();
    this._id = id;
    this._manager = manager;
    this._peer = peer;
    this._options = options;

    // @ts-ignore
    this.on("timeout", () => {
      if (this._connectTimeout) {
        clearTimeout(this._connectTimeout);
      }
    });
  }

  private _remoteId = 0;

  set remoteId(value: number) {
    this._remoteId = value;
    this._manager.socketMap.set(this._id, value);
  }

  private _peer;

  get peer() {
    return this._peer;
  }

  public _write(data: any, cb: any): void {
    this._peer.messages.writeSocket?.send({
      id: this._id,
      remoteId: this._remoteId,
      data,
    } as WriteSocketRequest);
    cb();
  }

  public _destroy(cb: Callback) {
    this._peer.messages.closeSocket?.send({
      id: this._id,
      remoteId: this._remoteId,
    } as SocketRequest);
    this._manager.socketMap.delete(this._id);
    this._manager.sockets.delete(this._id);
  }

  public connect() {
    this._peer.messages.openSocket?.send({
      ...this._options,
      id: this._id,
    });
  }

  public setTimeout(ms: number, cb: Function) {
    if (this._connectTimeout) {
      clearTimeout(this._connectTimeout);
    }

    this._connectTimeout = setTimeout(() => {
      cb && cb();
    }, ms) as any;
  }

  [asyncIterator]() {
    const stream = this;

    let error: Error | null = null;
    let promiseResolve: ((arg0: { value: any; done: boolean }) => void) | null =
      null;
    let promiseReject: ((arg0: Error) => void) | null = null;

    this.on("error", (err) => {
      error = err;
    });
    this.on("data", ondata);
    this.on("close", onclose);

    return {
      [asyncIterator]() {
        return this;
      },
      next() {
        return new Promise(function (resolve, reject) {
          promiseResolve = resolve;
          promiseReject = reject;
          const data = stream.read();
          if (data !== null) ondata(data);
          else {
            // @ts-ignore
            if ((stream._duplexState & DESTROYED) !== 0) ondata(null);
          }
        });
      },
      return() {
        return destroy(null);
      },
      throw(err: any) {
        return destroy(err);
      },
    };

    function onreadable() {
      if (promiseResolve !== null) ondata(stream.read());
    }

    function onclose() {
      if (promiseResolve !== null) ondata(null);
    }

    function ondata(data: any) {
      if (promiseReject === null) return;
      if (error) promiseReject(error);
      // @ts-ignore
      else if (data === null && (stream._duplexState & READ_DONE) === 0)
        promiseReject(STREAM_DESTROYED);
      else promiseResolve?.({ value: data, done: data === null });
      promiseReject = promiseResolve = null;
    }

    function destroy(err: any) {
      stream.destroy(err);
      return new Promise((resolve, reject) => {
        // @ts-ignore
        if (stream._duplexState & DESTROYED)
          return resolve({ value: undefined, done: true });
        stream.once("close", function () {
          if (err) reject(err);
          else resolve({ value: undefined, done: true });
        });
      });
    }
  }
}
