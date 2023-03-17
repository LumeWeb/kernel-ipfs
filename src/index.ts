import { createLibp2p } from "libp2p";
import { MemoryDatastore } from "datastore-core";
import { MemoryBlockstore } from "blockstore-core";
import { createHelia } from "helia";
import { yamux } from "@chainsafe/libp2p-yamux";
// @ts-ignore
import Hyperswarm from "hyperswarm";
import { Peer, Proxy } from "@lumeweb/libhyperproxy";
// @ts-ignore
import sodium from "sodium-universal";
// @ts-ignore
import { CustomEvent } from "@libp2p/interfaces/events";
// @ts-ignore
import { fixed32, raw } from "compact-encoding";
import { mplex } from "@libp2p/mplex";
import PeerManager from "./peerManager.js";
import { hypercoreTransport } from "./libp2p/transport.js";
import { UnixFS, unixfs } from "@helia/unixfs";
// @ts-ignore
import { delegatedPeerRouting } from "@libp2p/delegated-peer-routing";
import { noise } from "@chainsafe/libp2p-noise";
import { create as createIpfsHttpClient } from "ipfs-http-client";
import { delegatedContentRouting } from "@libp2p/delegated-content-routing";
import type { Options } from "ipfs-core";
import { multiaddr } from "@multiformats/multiaddr";
import { DELEGATE_LIST, PROTOCOL } from "./constants.js";
import { ActiveQuery, addHandler, handleMessage } from "libkmodule";
import { createClient } from "@lumeweb/kernel-swarm-client";

onmessage = handleMessage;

let moduleLoadedResolve: Function;
let moduleLoaded: Promise<void> = new Promise((resolve) => {
  moduleLoadedResolve = resolve;
});

let swarm;
let proxy: Proxy;
let fs: UnixFS;

// @ts-ignore
BigInt.prototype.toJSON = function () {
  return this.toString();
};

addHandler("presentSeed", handlePresentSeed);
addHandler("stat", handleStat);
addHandler("ls", handleLs, { receiveUpdates: true });
addHandler("cat", handleCat, { receiveUpdates: true });

async function handlePresentSeed() {
  swarm = createClient();

  const client = createIpfsHttpClient(getDelegateConfig());

  PeerManager.instance.ipfs = await createHelia({
    blockstore: new MemoryBlockstore(),
    datastore: new MemoryDatastore(),
    libp2p: await createLibp2p({
      transports: [hypercoreTransport({ peerManager: PeerManager.instance })],
      connectionEncryption: [noise()],
      streamMuxers: [yamux(), mplex()],
      start: false,
      contentRouters: [delegatedContentRouting(client)],
      peerRouters: [delegatedPeerRouting(client)],
      relay: {
        enabled: false,
      },
    }),
  });

  proxy = new Proxy({
    swarm,
    listen: true,
    protocol: PROTOCOL,
    autostart: true,
    emulateWebsocket: true,
    createDefaultMessage: false,
    onchannel(peer: Peer, channel: any) {
      PeerManager.instance.handleNewPeerChannel(peer, channel);
    },
    onopen() {
      PeerManager.instance.handleNewPeer();
    },
    onclose(peer: Peer) {
      PeerManager.instance.handleClosePeer(peer);
    },
  });

  swarm.join(PROTOCOL);
  await swarm.start();
  // @ts-ignore
  fs = unixfs(PeerManager.instance.ipfs);
  moduleLoadedResolve();
}

async function handleStat(aq: ActiveQuery) {
  await moduleLoaded;

  if (!("cid" in aq.callerInput)) {
    aq.reject("cid required");
    return;
  }

  let aborted = false;

  aq.setReceiveUpdate?.(() => {
    aborted = true;
  });

  try {
    aq.respond(
      JSON.parse(
        JSON.stringify(
          await fs.stat(aq.callerInput.cid, aq.callerInput.options ?? {})
        )
      )
    );
  } catch (e) {
    aq.reject((e as Error).message);
  }
}

async function handleLs(aq: ActiveQuery) {
  await moduleLoaded;
  if (!("cid" in aq.callerInput)) {
    aq.reject("cid required");
    return;
  }

  let aborted = false;

  aq.setReceiveUpdate?.(() => {
    aborted = true;
  });

  const iterable = fs.ls(aq.callerInput.cid, aq.callerInput.options ?? {});

  for await (const item of iterable) {
    if (aborted) {
      break;
    }
    aq.sendUpdate(JSON.parse(JSON.stringify(item)));
  }

  aq.respond();
}

async function handleCat(aq: ActiveQuery) {
  await moduleLoaded;

  if (!("cid" in aq.callerInput)) {
    aq.reject("cid required");
    return;
  }

  let aborted = false;

  aq.setReceiveUpdate?.(() => {
    aborted = true;
  });

  const iterable = fs.cat(aq.callerInput.cid, aq.callerInput.options ?? {});

  for await (const chunk of iterable) {
    if (aborted) {
      break;
    }

    aq.sendUpdate(chunk);
  }

  aq.respond();
}

function getDelegateConfig(): Options {
  const delegateString =
    DELEGATE_LIST[Math.floor(Math.random() * DELEGATE_LIST.length)];
  const delegateAddr = multiaddr(delegateString).toOptions();

  return {
    // @ts-ignore
    host: delegateAddr.host,
    // @ts-ignore
    protocol: parseInt(delegateAddr.port) === 443 ? "https" : "http",
    port: delegateAddr.port,
  };
}
