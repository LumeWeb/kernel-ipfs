import { addHandler, handleMessage } from "libkmodule";
import type { ActiveQuery } from "libkmodule";
import PQueue from "p-queue";
import { ipfsPath, ipnsPath } from "is-ipfs";
import { DataFn } from "libskynet";
import { RpcNetwork } from "@lumeweb/kernel-rpc-client";
import { RPCResponse } from "@lumeweb/relay-types";

interface StatFileResponse {
  exists: boolean;
  contentType: string | null;
  error: any;
  directory: boolean;
  files: string[];
}
interface PingRPCResponse extends RPCResponse {
  data?: {
    ping?: any;
  };
}

interface MethodsRPCResponse extends RPCResponse {
  data?: string[];
}

onmessage = handleMessage;

let blockingGatewayUpdate = Promise.resolve();

let activeRelays: string | any[] = [];
let relays = [
  "25c2a0a833782d64213c08879b95dd5a60af244b44a058f3a7a70d6722f4bda7",
];

let network: RpcNetwork;

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
  network = new RpcNetwork(false);
  for (const relay of relays) {
    await network.addRelay(relay);
  }

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
    let query;
    if (stream) {
      query = network.streamingQuery(relay, method, "ipfs", stream, {
        hash,
        path,
      });
    } else {
      query = network.simpleQuery(relay, method, "ipfs", {
        hash,
        path,
      });
    }
    let resp = await query.result;
    if (resp.error) {
      throw new Error(resp.error);
    }

    if (!stream) {
      return resp.data;
    }
  }

  throw error;
}

async function relayHasMethods(
  methodList: string[],
  relay: string
): Promise<boolean> {
  let methods: string[];
  let query = network.simpleQuery(relay, "get_methods", "core");

  let resp = (await query.result) as MethodsRPCResponse;

  if (resp.data) {
    methods = resp.data;
  }

  let has = true;

  methodList.forEach((item) => {
    if (!methods.includes(item)) {
      has = false;
    }
  });

  return has;
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

    let query = network.simpleQuery(relay, "ping", "core");

    let resp = (await query.result) as PingRPCResponse;

    if (!resp?.data?.ping) {
      return;
    }

    const end = Date.now() - start;

    if (
      !(await relayHasMethods(
        ["stat_ipfs", "stat_ipns", "fetch_ipfs", "fetch_ipns"],
        relay
      ))
    ) {
      return;
    }

    list.push([end, relay]);
  };
}
