import { createHelia } from "helia";
// @ts-ignore
import Hyperswarm from "hyperswarm";
import { MultiSocketProxy } from "@lumeweb/libhyperproxy";
import { UnixFS, unixfs } from "@helia/unixfs";
import { PROTOCOL } from "./constants.js";
import {
  ActiveQuery,
  addHandler,
  handleMessage,
} from "@lumeweb/libkernel/module";
import { createClient } from "@lumeweb/kernel-swarm-client";
import { ipns, IPNS } from "@helia/ipns";
import { dht, pubsub } from "@helia/ipns/routing";
// @ts-ignore
import { gossipsub } from "@chainsafe/libp2p-gossipsub";
import { CID } from "multiformats/cid";
import { bases } from "multiformats/basics";
import { substr } from "runes2";
import { MultibaseDecoder } from "multiformats";
import { peerIdFromCID } from "@libp2p/peer-id";
import { IDBBlockstore } from "blockstore-idb";
import { IDBDatastore } from "datastore-idb";
import defer from "p-defer";
import { Helia } from "@helia/interface";
// @ts-ignore
import type { Components } from "libp2p/src/components.js";
import { libp2pConfig } from "./config.js";
import { createClient as createNetworkRegistryClient } from "@lumeweb/kernel-network-registry-client";

const basesByPrefix: { [prefix: string]: MultibaseDecoder<any> } = Object.keys(
  bases,
).reduce((acc, curr) => {
  // @ts-ignore
  acc[bases[curr].prefix] = bases[curr];
  return acc;
}, {});

const TYPES = ["content"];

onmessage = handleMessage;

const moduleDefer = defer();
let activeIpfsPeersDefer = defer();
let networkPeersAvailable = defer();
let networkReady = true;
const networkRegistry = createNetworkRegistryClient();

let swarm;
let proxy: MultiSocketProxy;
let fs: UnixFS;
let IPNS: IPNS;
let ipfs: Helia;

// @ts-ignore
BigInt.prototype.toJSON = function () {
  return this.toString();
};

addHandler("presentKey", handlePresentKey);
addHandler("register", handleRegister);
addHandler("status", handleStatus, { receiveUpdates: true });
addHandler("name", handleName);
addHandler("ready", handleReady);
addHandler("stat", handleStat);
addHandler("ls", handleLs, { receiveUpdates: true });
addHandler("cat", handleCat, { receiveUpdates: true });
addHandler("ipnsResolve", handleIpnsResolve);
addHandler("getActivePeers", handleGetActivePeers);

async function handlePresentKey() {
  swarm = createClient();

  proxy = new MultiSocketProxy({
    swarm,
    listen: true,
    protocol: PROTOCOL,
    autostart: true,
    emulateWebsocket: true,
    server: false,
  });

  const blockstore = new IDBBlockstore("ipfs_blocks");
  const datastore = new IDBDatastore("ipfs_data");

  await blockstore.open();
  await datastore.open();
  ipfs = await createHelia({
    blockstore,
    // @ts-ignore
    datastore,
    libp2p: libp2pConfig(proxy),
    start: false,
  });

  proxy.on("peerChannelOpen", async () => {
    if (!ipfs.libp2p.isStarted()) {
      await ipfs.start();
      networkPeersAvailable.resolve();
      networkReady = true;
    }
  });

  swarm.join(PROTOCOL);
  await swarm.start();
  await swarm.ready();
  // @ts-ignore
  fs = unixfs(ipfs);
  IPNS = ipns(ipfs as any, [dht(ipfs), pubsub(ipfs as any)]);

  ipfs.libp2p.addEventListener("peer:connect", () => {
    if (ipfs.libp2p.getPeers().length > 0) {
      activeIpfsPeersDefer.resolve();
    }
  });

  ipfs.libp2p.addEventListener("peer:disconnect", () => {
    if (ipfs.libp2p.getPeers().length === 0) {
      activeIpfsPeersDefer = defer();
    }
  });

  moduleDefer.resolve();
}

async function handleReady(aq: ActiveQuery) {
  await ready();

  aq.respond();
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
          await fs.stat(
            getCID(aq.callerInput.cid),
            aq.callerInput.options ?? {},
          ),
        ),
      ),
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
  let nextChunk = defer();

  aq.setReceiveUpdate?.((data: any) => {
    switch (data) {
      case "abort":
        aborted = true;
        break;
      case "next":
        nextChunk.resolve();
        nextChunk = defer();
        break;
    }
  });
  const iterable = fs.ls(
    getCID(aq.callerInput.cid),
    aq.callerInput.options ?? {},
  );

  for await (const item of iterable) {
    if (aborted) {
      break;
    }
    aq.sendUpdate(JSON.parse(JSON.stringify(item)));

    await nextChunk.promise;
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
  let nextChunk = defer();

  aq.setReceiveUpdate?.((data: any) => {
    switch (data) {
      case "abort":
        aborted = true;
        break;
      case "next":
        nextChunk.resolve();
        nextChunk = defer();
        break;
    }
  });

  const iterable = fs.cat(
    getCID(aq.callerInput.cid),
    aq.callerInput.options ?? {},
  );

  for await (const chunk of iterable) {
    if (aborted) {
      break;
    }

    aq.sendUpdate(chunk);

    await nextChunk.promise;
  }

  aq.respond();
}

async function handleIpnsResolve(aq: ActiveQuery) {
  await ready();

  await activeIpfsPeersDefer.promise;

  if (ipfs.libp2p.getPeers().length === 0) {
    activeIpfsPeersDefer = defer();
  }

  await activeIpfsPeersDefer.promise;

  if (!aq.callerInput || !("cid" in aq.callerInput)) {
    aq.reject("cid required");
    return;
  }

  try {
    return aq.respond(
      (
        await IPNS.resolve(
          peerIdFromCID(getCID(aq.callerInput.cid)),
          aq.callerInput?.options,
        )
      ).asCID.toString(),
    );
  } catch (e: any) {
    aq.reject((e as Error).message);
  }
}

function getCID(cid: string): CID {
  try {
    return CID.parse(cid);
  } catch {}

  const prefix = substr(cid, 0, 1);

  if (!(prefix in basesByPrefix)) {
    throw new Error("invalid multibase found in CID");
  }

  const base = basesByPrefix[prefix];
  return CID.parse(cid, base);
}

async function handleGetActivePeers(aq: ActiveQuery) {
  await ready();

  aq.respond(ipfs.libp2p.getPeers());
}

async function ready() {
  await moduleDefer.promise;
  await networkPeersAvailable.promise;
}

async function handleRegister(aq: ActiveQuery) {
  await networkRegistry.registerNetwork(TYPES);

  aq.respond();
}

async function handleStatus(aq: ActiveQuery) {
  function sendUpdate() {
    aq.sendUpdate({
      peers: netPeers,
      ready: netPeers > 0,
    });
  }

  let netPeers = 0;
  if (!networkReady) {
    sendUpdate();
    await ready();
    getPeers();
  }

  function getPeers() {
    netPeers = ipfs.libp2p.getPeers().length;
  }

  function peersListener() {
    getPeers();
    sendUpdate();
  }

  const peerEvents = ["connection:prune", "peer:connect", "peer:disconnect"];
  peerEvents.forEach((ev) => {
    // @ts-ignore
    ipfs.libp2p.components.connectionManager.events.addEventListener(
      ev,
      peersListener,
    );
  });

  // @ts-ignore
  ipfs.libp2p.components.connectionManager.events.addEventListener(
    "peer:disconnect",
    peersListener,
  );

  ipfs.libp2p.addEventListener("start", peersListener);

  aq.setReceiveUpdate?.(() => {
    peerEvents.forEach((ev) => {
      // @ts-ignore
      ipfs.libp2p.components.connectionManager.events.removeEventListener(
        ev,
        peersListener,
      );
    });
    ipfs.libp2p.removeEventListener("start", peersListener);
    aq.respond();
  });

  sendUpdate();
}

function handleName(aq: ActiveQuery) {
  aq.respond("IPFS");
}
