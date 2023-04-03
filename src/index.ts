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
import defer from "p-defer";

const basesByPrefix: { [prefix: string]: MultibaseDecoder<any> } = Object.keys(
  bases
).reduce((acc, curr) => {
  // @ts-ignore
  acc[bases[curr].prefix] = bases[curr];
  return acc;
}, {});

onmessage = handleMessage;

const moduleDefer = defer();
let activePeersDefer = defer();

let swarm;
let proxy: Proxy;
let fs: UnixFS;
let IPNS: IPNS;

// @ts-ignore
BigInt.prototype.toJSON = function () {
  return this.toString();
};

addHandler("presentSeed", handlePresentSeed);
addHandler("ready", handleReady);
addHandler("stat", handleStat);
addHandler("ls", handleLs, { receiveUpdates: true });
addHandler("cat", handleCat, { receiveUpdates: true });
addHandler("ipnsResolve", handleIpnsResolve);
addHandler("getActivePeers", handleGetActivePeers);

async function handlePresentSeed() {
  swarm = createClient();

  const client = createIpfsHttpClient(getDelegateConfig());

  const libp2p = await createLibp2p({
    peerDiscovery: [
      bootstrap({
        list: [
          // Default Bootstrap
          "/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN",
          "/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa",
          "/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb",
          "/dnsaddr/bootstrap.libp2p.io/p2p/QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt",
          "/ip4/104.131.131.82/tcp/4001/p2p/QmaCpDMGvV2BGHeYERUEnRQAwe3N8SzbUtfsmvsqQLuvuJ",
          // Cloudflare
          "/dnsaddr/node-1.ingress.cloudflare-ipfs.com/p2p/QmcFf2FH3CEgTNHeMRGhN7HNHU1EXAxoEk6EFuSyXCsvRE",
          "/dnsaddr/node-2.ingress.cloudflare-ipfs.com/p2p/QmcFmLd5ySfk2WZuJ1mfSWLDjdmHZq7rSAua4GoeSQfs1z",
          "/dnsaddr/node-3.ingress.cloudflare-ipfs.com/p2p/QmcfFmzSDVbwexQ9Au2pt5YEXHK5xajwgaU6PpkbLWerMa",
          "/dnsaddr/node-4.ingress.cloudflare-ipfs.com/p2p/QmcfJeB3Js1FG7T8YaZATEiaHqNKVdQfybYYkbT1knUswx",
          "/dnsaddr/node-5.ingress.cloudflare-ipfs.com/p2p/QmcfVvzK4tMdFmpJjEKDUoqRgP4W9FnmJoziYX5GXJJ8eZ",
          "/dnsaddr/node-6.ingress.cloudflare-ipfs.com/p2p/QmcfZD3VKrUxyP9BbyUnZDpbqDnT7cQ4WjPP8TRLXaoE7G",
          "/dnsaddr/node-7.ingress.cloudflare-ipfs.com/p2p/QmcfZP2LuW4jxviTeG8fi28qjnZScACb8PEgHAc17ZEri3",
          "/dnsaddr/node-8.ingress.cloudflare-ipfs.com/p2p/QmcfgsJsMtx6qJb74akCw1M24X1zFwgGo11h1cuhwQjtJP",
          "/dnsaddr/node-9.ingress.cloudflare-ipfs.com/p2p/Qmcfr2FC7pFzJbTSDfYaSy1J8Uuy8ccGLeLyqJCKJvTHMi",
          "/dnsaddr/node-10.ingress.cloudflare-ipfs.com/p2p/QmcfR3V5YAtHBzxVACWCzXTt26SyEkxdwhGJ6875A8BuWx",
          "/dnsaddr/node-11.ingress.cloudflare-ipfs.com/p2p/Qmcfuo1TM9uUiJp6dTbm915Rf1aTqm3a3dnmCdDQLHgvL5",
          "/dnsaddr/node-12.ingress.cloudflare-ipfs.com/p2p/QmcfV2sg9zaq7UUHVCGuSvT2M2rnLBAPsiE79vVyK3Cuev",
          // Estuary
          "/ip4/139.178.68.217/tcp/6744/p2p/12D3KooWCVXs8P7iq6ao4XhfAmKWrEeuKFWCJgqe9jGDMTqHYBjw",
          "/ip4/147.75.49.71/tcp/6745/p2p/12D3KooWGBWx9gyUFTVQcKMTenQMSyE2ad9m7c9fpjS4NMjoDien",
          "/ip4/147.75.86.255/tcp/6745/p2p/12D3KooWFrnuj5o3tx4fGD2ZVJRyDqTdzGnU3XYXmBbWbc8Hs8Nd",
          "/ip4/3.134.223.177/tcp/6745/p2p/12D3KooWN8vAoGd6eurUSidcpLYguQiGZwt4eVgDvbgaS7kiGTup",
          "/ip4/35.74.45.12/udp/6746/quic/p2p/12D3KooWLV128pddyvoG6NBvoZw7sSrgpMTPtjnpu3mSmENqhtL7",

          // Pinata
          "/dnsaddr/fra1-1.hostnodes.pinata.cloud/p2p/QmWaik1eJcGHq1ybTWe7sezRfqKNcDRNkeBaLnGwQJz1Cj",
          "/dnsaddr/fra1-2.hostnodes.pinata.cloud/p2p/QmNfpLrQQZr5Ns9FAJKpyzgnDL2GgC6xBug1yUZozKFgu4",
          "/dnsaddr/fra1-3.hostnodes.pinata.cloud/p2p/QmPo1ygpngghu5it8u4Mr3ym6SEU2Wp2wA66Z91Y1S1g29",
          "/dnsaddr/nyc1-1.hostnodes.pinata.cloud/p2p/QmRjLSisUCHVpFa5ELVvX3qVPfdxajxWJEHs9kN3EcxAW6",
          "/dnsaddr/nyc1-2.hostnodes.pinata.cloud/p2p/QmPySsdmbczdZYBpbi2oq2WMJ8ErbfxtkG8Mo192UHkfGP",
          "/dnsaddr/nyc1-3.hostnodes.pinata.cloud/p2p/QmSarArpxemsPESa6FNkmuu9iSE1QWqPX2R3Aw6f5jq4D5",
          // Eternum
          "/dns4/door.eternum.io/tcp/4001/ipfs/QmVBxJ5GekATHi89H8jbXjaU6CosCnteomjNR5xar2aH3q",
          // Textile
          "/ip4/104.210.43.77/p2p/QmR69wtWUMm1TWnmuD4JqC1TWLZcc8iR2KrTenfZZbiztd",
          // 8api.sh
          "/ip4/78.46.108.24/p2p/12D3KooWGASC2jm3pmohEJXUhuStkxDitPgzvs4qMuFPaiD9x1BA",
          "/ip4/65.109.19.136/p2p/12D3KooWRbWZN3GvLf9CHmozq4vnTzDD4EEoiqtRJxg5FV6Gfjmm",

          // Storj
          "/ip4/5.161.92.43/tcp/4001/p2p/12D3KooWFFhc8fPYnQXdWBCowxSV21EFYin3rU27p3NVgSMjN41k",
          "/ip4/5.161.92.43/udp/4001/quic/p2p/12D3KooWFFhc8fPYnQXdWBCowxSV21EFYin3rU27p3NVgSMjN41k",
          "/ip6/2a01:4ff:f0:3b1e::1/tcp/4001/p2p/12D3KooWFFhc8fPYnQXdWBCowxSV21EFYin3rU27p3NVgSMjN41k",
          "/ip6/2a01:4ff:f0:3b1e::1/udp/4001/quic/p2p/12D3KooWFFhc8fPYnQXdWBCowxSV21EFYin3rU27p3NVgSMjN41k",
          "/ip4/5.161.55.227/tcp/4001/p2p/12D3KooWSW4hoHmDXmY5rW7nCi9XmGTy3foFt72u86jNP53LTNBJ",
          "/ip4/5.161.55.227/udp/4001/quic/p2p/12D3KooWSW4hoHmDXmY5rW7nCi9XmGTy3foFt72u86jNP53LTNBJ",
          "/ip6/2a01:4ff:f0:1e5a::1/tcp/4001/p2p/12D3KooWSW4hoHmDXmY5rW7nCi9XmGTy3foFt72u86jNP53LTNBJ",
          "/ip6/2a01:4ff:f0:1e5a::1/udp/4001/quic/p2p/12D3KooWSW4hoHmDXmY5rW7nCi9XmGTy3foFt72u86jNP53LTNBJ",
          "/ip4/5.161.92.36/tcp/4001/p2p/12D3KooWSDj6JM2JmoHwE9AUUwqAFUEg9ndd3pMA8aF2bkYckZfo",
          "/ip4/5.161.92.36/udp/4001/quic/p2p/12D3KooWSDj6JM2JmoHwE9AUUwqAFUEg9ndd3pMA8aF2bkYckZfo",
          "/ip6/2a01:4ff:f0:3764::1/tcp/4001/p2p/12D3KooWSDj6JM2JmoHwE9AUUwqAFUEg9ndd3pMA8aF2bkYckZfo",
          "/ip6/2a01:4ff:f0:3764::1/udp/4001/quic/p2p/12D3KooWSDj6JM2JmoHwE9AUUwqAFUEg9ndd3pMA8aF2bkYckZfo",
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

  const ipfs = await createHelia({
    // @ts-ignore
    blockstore,
    // @ts-ignore
    datastore,
    libp2p,
  });

  PeerManager.instance.ipfs = ipfs;

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
  fs = unixfs(ipfs);
  IPNS = ipns(ipfs as any, [dht(ipfs), pubsub(ipfs as any)]);

  ipfs.libp2p.addEventListener("peer:connect", () => {
    if (ipfs.libp2p.getPeers().length > 0) {
      activePeersDefer.resolve();
    }
  });

  ipfs.libp2p.addEventListener("peer:disconnect", () => {
    if (ipfs.libp2p.getPeers().length === 0) {
      activePeersDefer = defer();
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
            aq.callerInput.options ?? {}
          )
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

  const iterable = fs.ls(
    getCID(aq.callerInput.cid),
    aq.callerInput.options ?? {}
  );

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

  const iterable = fs.cat(
    getCID(aq.callerInput.cid),
    aq.callerInput.options ?? {}
  );

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

  await activePeersDefer.promise;

  if (PeerManager.instance.ipfs.libp2p.getPeers().length === 0) {
    activePeersDefer = defer();
  }

  await activePeersDefer.promise;

  if (!aq.callerInput || !("cid" in aq.callerInput)) {
    aq.reject("cid required");
    return;
  }

  try {
    return aq.respond(
      (
        await IPNS.resolve(
          peerIdFromCID(getCID(aq.callerInput.cid)),
          aq.callerInput?.options
        )
      ).asCID.toString()
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

  aq.respond(PeerManager.instance.ipfs.libp2p.getPeers());
}

async function ready() {
  await moduleDefer.promise;
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
