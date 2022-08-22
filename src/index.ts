import { addHandler, handleMessage, log } from "libkmodule";
import type { ActiveQuery } from "libkmodule";
import PQueue from "p-queue";
import { ipfsPath, ipnsPath } from "is-ipfs";
import { DHT } from "@lumeweb/kernel-dht-client";
import { pack, unpack } from "msgpackr";
import { DataFn } from "libskynet";

onmessage = handleMessage;

interface StatFileResponse {
  exists: boolean;
  contentType: string | null;
  error: any;
  directory: boolean;
  files: string[];
}

let blockingGatewayUpdate = Promise.resolve();

let activeRelays: string | any[] = [];
let relays = [
  "25c2a0a833782d64213c08879b95dd5a60af244b44a058f3a7a70d6722f4bda7",
];

let dht: DHT;

addHandler("presentSeed", handlePresentSeed);
addHandler("refreshGatewayList", handleRefreshGatewayList);
addHandler("statIpfs", handleStatIpfs);
addHandler("fetchIpfs", handleFetchIpfs);
addHandler("statIpns", handleStatIpns);
addHandler("fetchIpns", handleFetchIpns);

let readyPromiseResolve: any;
let readyPromise = new Promise((resolve) => {
  readyPromiseResolve = resolve;
});

async function handlePresentSeed() {
  dht = new DHT(false);
  for (const relay of relays) {
    await dht.addRelay(relay);
  }
  await dht.ready();
  refreshGatewayList();
  readyPromiseResolve();
}

async function handleRefreshGatewayList(aq: ActiveQuery) {
  await readyPromise;
  await blockingGatewayUpdate;
  await refreshGatewayList();
  aq.respond();
}

async function handleStatIpfs(aq: ActiveQuery) {
  return handleStat(aq, "stat_ipfs", "ipfs");
}

async function handleFetchIpfs(aq: ActiveQuery) {
  return handleFetch(aq, "fetch_ipfs", "ipfs");
}

async function handleStatIpns(aq: ActiveQuery) {
  return handleStat(aq, "stat_ipns", "ipns");
}

async function handleFetchIpns(aq: ActiveQuery) {
  return handleFetch(aq, "fetch_ipns", "ipns");
}

async function validateInputs(aq: ActiveQuery, type: "ipns" | "ipfs") {
  const { hash = null } = aq.callerInput;
  const { path = "" } = aq.callerInput;
  if (!hash) {
    aq.reject("hash missing");
    return;
  }

  if (type === "ipfs" && !ipfsPath(`/ipfs/${hash}`)) {
    aq.reject("ipfs hash is invalid");
    return;
  }

  if (type === "ipns" && !ipnsPath(`/ipns/${hash}`)) {
    aq.reject("ipns hash is invalid");
    return;
  }
  await readyPromise;
  await blockingGatewayUpdate;

  return { hash, path };
}

async function handleStat(
  aq: ActiveQuery,
  method: string,
  type: "ipns" | "ipfs"
): Promise<void> {
  const valid = await validateInputs(aq, type);
  if (!valid) {
    return;
  }
  const { hash, path } = valid;
  try {
    let resp = (await fetchFromRelays(hash, path, method)) as StatFileResponse;
    aq.respond(resp);
  } catch (e: any) {
    aq.reject(e);
  }
}

async function handleFetch(
  aq: ActiveQuery,
  method: string,
  type: "ipns" | "ipfs"
): Promise<void> {
  const valid = await validateInputs(aq, type);
  if (!valid) {
    return;
  }
  const { hash, path } = valid;

  try {
    await fetchFromRelays(hash, path, method, aq.sendUpdate);
    aq.respond();
  } catch (e: any) {
    aq.reject(e);
  }
}

async function fetchFromRelays(
  hash: string,
  path: string,
  method: string,
  stream: DataFn | undefined = undefined
) {
  let error = new Error("NOT_FOUND");
  if (0 == activeRelays.length) {
    await refreshGatewayList();
  }
  for (const relay of activeRelays) {
    let resp;
    try {
      resp = await rpcCall(relay, "ipfs", method, stream, {
        hash,
        path,
      });
    } catch (e: any) {
      if (e instanceof Error) {
        error = e;
      } else {
        error = new Error(e);
      }
      continue;
    }

    if (resp) {
      return resp;
    }
  }

  throw error;
}

async function relayHasMethods(
  methodList: string[],
  relay: string
): Promise<boolean> {
  let methods: string | string[] = [];
  try {
    methods = (await rpcCall(relay, "misc", "get_methods")) as [];
  } catch (e) {
    return false;
  }

  let has = true;

  methodList.forEach((item) => {
    if (!methods.includes(item)) {
      has = false;
    }
  });

  return has;
}

async function rpcCall(
  relay: string,
  chain: string,
  query: string,
  stream?: (data: any) => void,
  data = {}
) {
  const socket = await dht.connect(relay);
  return new Promise((resolve, reject) => {
    let dataCount = 0;
    socket.on("data", (res) => {
      dataCount++;
      const response = unpack(res);

      if (!response || response.error) {
        socket.end();
        reject(response?.error);
        return;
      }

      if (!stream && 1 === dataCount) {
        socket.end();
        resolve(response?.data);
        return;
      }

      if (stream) {
        if (response?.data.done) {
          socket.end();
          resolve(true);
          return;
        }
        stream(response?.data.data);
      }
    });
    socket.write("rpc");
    socket.write(
      pack({
        query,
        chain,
        data,
        force: true,
      })
    );
  });
}

async function refreshGatewayList() {
  let processResolve: any;
  blockingGatewayUpdate = new Promise((resolve) => {
    processResolve = resolve;
  });
  const queue = new PQueue({ concurrency: 10 });

  let latencies: any[] = [];

  relays.forEach((item) => {
    queue.add(checkRelayLatency(item, latencies));
  });

  await queue.onIdle();

  activeRelays = latencies
    .sort((a: any[], b: any[]) => {
      return a[0] - b[0];
    })
    .map((item: any[]) => item[1]);
  processResolve();
}

function checkRelayLatency(relay: string, list: any[]) {
  return async () => {
    const start = Date.now();

    let resp;
    try {
      resp = await rpcCall(relay, "misc", "ping", undefined, {});
    } catch {
      return;
    }
    // @ts-ignore
    if (!resp.pong) {
      return;
    }

    const end = Date.now() - start;

    try {
      resp = await relayHasMethods(
        ["stat_ipfs", "stat_ipns", "fetch_ipfs", "fetch_ipns"],
        relay
      );
      if (!resp) {
        return;
      }
    } catch {
      return;
    }

    list.push([end, relay]);
  };
}
