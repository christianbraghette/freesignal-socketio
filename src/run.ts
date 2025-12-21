import { AsyncMap } from "@freesignal/protocol";
import { FreeSignalServer } from "./server.js";

const server = new FreeSignalServer({ keyExchange: new AsyncMap(), sessions: new AsyncMap(), users: new AsyncMap(), bundles: new AsyncMap(), bootstraps: new AsyncMap(), outbox: new AsyncMap() }).listen();
console.log("Freesignal Server started!");