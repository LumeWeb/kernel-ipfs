import { createLibp2p } from "libp2p";
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
// @ts-ignore
import type { Options } from "ipfs-core";
import { multiaddr } from "@multiformats/multiaddr";
import { DELEGATE_LIST, PROTOCOL } from "./constants.js";
import { ActiveQuery, addHandler, handleMessage } from "libkmodule";
import { createClient } from "@lumeweb/kernel-swarm-client";
import { ipns, ipnsValidator, ipnsSelector, IPNS } from "@helia/ipns";
import { dht, pubsub } from "@helia/ipns/routing";
import { kadDHT } from "@libp2p/kad-dht";
// @ts-ignore
import { gossipsub } from "@chainsafe/libp2p-gossipsub";
import { CID } from "multiformats/cid";
import { bases } from "multiformats/basics";
import { substr } from "runes2";
import { MultibaseDecoder } from "multiformats";
import { peerIdFromCID } from "@libp2p/peer-id";
import { bootstrap } from "@libp2p/bootstrap";
import { IDBBlockstore } from "blockstore-idb";
import { IDBDatastore } from "datastore-idb";

const basesByPrefix: { [prefix: string]: MultibaseDecoder<any> } = Object.keys(
  bases
).reduce((acc, curr) => {
  // @ts-ignore
  acc[bases[curr].prefix] = bases[curr];
  return acc;
}, {});

onmessage = handleMessage;

let moduleLoadedResolve: Function;
let moduleLoaded: Promise<void> = new Promise((resolve) => {
  moduleLoadedResolve = resolve;
});

let swarm;
let proxy: Proxy;
let fs: UnixFS;
let IPNS: IPNS;

// @ts-ignore
BigInt.prototype.toJSON = function () {
  return this.toString();
};

addHandler("presentSeed", handlePresentSeed);
addHandler("stat", handleStat);
addHandler("ls", handleLs, { receiveUpdates: true });
addHandler("cat", handleCat, { receiveUpdates: true });
addHandler("ipnsResolve", handleIpnsResolve);

async function handlePresentSeed() {
  swarm = createClient();

  const client = createIpfsHttpClient(getDelegateConfig());

  const libp2p = await createLibp2p({
    peerDiscovery: [
      bootstrap({
        list: [
          "/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN",
          "/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa",
          "/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb",
          "/dnsaddr/bootstrap.libp2p.io/p2p/QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt",
          "/ip4/104.131.131.82/tcp/4001/p2p/QmaCpDMGvV2BGHeYERUEnRQAwe3N8SzbUtfsmvsqQLuvuJ",
        ],
      }),
    ],
    transports: [hypercoreTransport({ peerManager: PeerManager.instance })],
    connectionEncryption: [noise()],
    connectionManager: {
      autoDial: true,
    },
    streamMuxers: [yamux(), mplex()],
    start: false,
    contentRouters: [delegatedContentRouting(client)],
    peerRouters: [delegatedPeerRouting(client)],
    relay: {
      enabled: true,
      advertise: {
        enabled: false,
      },
    },
    dht: kadDHT({
      validators: {
        ipns: ipnsValidator,
      },
      selectors: {
        ipns: ipnsSelector,
      },
    }),
    pubsub: gossipsub(),
  });

  const blockstore = new IDBBlockstore("ipfs_blocks");
  const datastore = new IDBDatastore("ipfs_data");

  await blockstore.open();
  await datastore.open();

  PeerManager.instance.ipfs = await createHelia({
    // @ts-ignore
    blockstore,
    // @ts-ignore
    datastore,
    libp2p,
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

  PeerManager.instance.ipfsReady;

  swarm.join(PROTOCOL);
  await swarm.start();
  await swarm.ready();
  // @ts-ignore
  fs = unixfs(PeerManager.instance.ipfs);
  IPNS = ipns(PeerManager.instance.ipfs as any, [
    dht(PeerManager.instance.ipfs),
    pubsub(PeerManager.instance.ipfs as any),
  ]);
  moduleLoadedResolve();
}

async function handleStat(aq: ActiveQuery) {
  await ready();

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
  await ready();
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
  await ready();

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

async function handleIpnsResolve(aq: ActiveQuery) {
  await ready();
  if (!aq.callerInput || !("cid" in aq.callerInput)) {
    aq.reject("cid required");
    return;
  }

  const prefix = substr(aq.callerInput.cid, 0, 1);

  if (!(prefix in basesByPrefix)) {
    aq.reject("invalid multibase found in CID");
    return;
  }

  const base = basesByPrefix[prefix];
  const cid = CID.parse(aq.callerInput.cid, base);

  try {
    return aq.respond(
      (await IPNS.resolve(peerIdFromCID(cid), aq.callerInput?.options)).asCID
    );
  } catch (e: any) {
    aq.reject((e as Error).message);
  }
}

async function ready() {
  await moduleLoaded;
  await PeerManager.instance.ipfsReady;
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
