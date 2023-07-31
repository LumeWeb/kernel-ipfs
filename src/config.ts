import { gossipsub } from "@chainsafe/libp2p-gossipsub";
import { noise } from "@chainsafe/libp2p-noise";
import { yamux } from "@chainsafe/libp2p-yamux";
import { bootstrap } from "@libp2p/bootstrap";
import { type DualKadDHT, kadDHT } from "@libp2p/kad-dht";
import { mplex } from "@libp2p/mplex";
import { ipnsSelector } from "ipns/selector";
import { ipnsValidator } from "ipns/validator";
import { autoNATService } from "libp2p/autonat";
import { identifyService } from "libp2p/identify";
import { bootstrapConfig } from "./bootstrap.js";
import type { PubSub } from "@libp2p/interface-pubsub";
import type { Libp2pOptions } from "libp2p";
import { hypercoreTransport } from "./libp2p/transport.js";
import { MultiSocketProxy } from "@lumeweb/libhyperproxy";
import { ipniContentRouting } from "@libp2p/ipni-content-routing";
import { reframeContentRouting } from "@libp2p/reframe-content-routing";
import { multiaddr } from "@multiformats/multiaddr";
import { create as createIpfsHttpClient } from "ipfs-http-client";
import { delegatedContentRouting } from "@libp2p/delegated-content-routing";
import { DELEGATE_LIST } from "./constants.js";

function getDelegateConfig(): any {
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

export function libp2pConfig(proxy: MultiSocketProxy): Libp2pOptions<{
  dht: DualKadDHT;
  pubsub: PubSub;
  identify: unknown;
  autoNAT: unknown;
}> {
  const client = createIpfsHttpClient(getDelegateConfig());

  return {
    addresses: {
      listen: [],
    },
    transports: [hypercoreTransport({ proxy })],
    connectionEncryption: [noise()],
    streamMuxers: [yamux(), mplex()],
    peerDiscovery: [bootstrap(bootstrapConfig)],
    contentRouters: [
      delegatedContentRouting(client),
      ipniContentRouting("https://cid.contact"),
      reframeContentRouting("https://cid.contact/reframe"),
    ],
    services: {
      identify: identifyService(),
      autoNAT: autoNATService(),
      pubsub: gossipsub(),
      dht: kadDHT({
        clientMode: true,
        validators: {
          ipns: ipnsValidator,
        },
        selectors: {
          ipns: ipnsSelector,
        },
      }),
    },
  };
}
