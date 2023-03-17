import { Peer } from "@lumeweb/libhyperproxy";

type Message = {
  send: (pubkey: Uint8Array | any) => void;
};

export interface PeerEntityMessages {
  keyExchange: Message;
  openSocket: Message;
  writeSocket: Message;
  closeSocket: Message;
  timeoutSocket: Message;
  errorSocket: Message;
}

export interface PeerEntity {
  messages: PeerEntityMessages | Partial<PeerEntityMessages>;
  submitKeyExchange: (pubkey: Uint8Array) => void;
  peer: Peer;
}

export interface PeerInfoResult {
  publicKey: Uint8Array;
  libp2pPublicKey: Uint8Array;
}

export interface SocketRequest {
  remoteId: number;
  id: number;
}

export type CloseSocketRequest = SocketRequest;

export interface WriteSocketRequest extends SocketRequest {
  data: Uint8Array;
}

export interface ErrorSocketRequest extends SocketRequest {
  err: Error;
}
