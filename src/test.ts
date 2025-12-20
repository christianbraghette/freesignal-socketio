import { AsyncMap } from "@freesignal/protocol";
import { FreeSignalClient as FreeSignalClient } from "./client.js";
import { FreeSignalServer as FreeSignalServer } from "./server.js"
import { decodeData } from "@freesignal/utils";

const server = new FreeSignalServer({ keyExchange: new AsyncMap(), sessions: new AsyncMap(), users: new AsyncMap(), bundles: new AsyncMap(), bootstraps: new AsyncMap(), outbox: new AsyncMap() }).listen();
const client1 = new FreeSignalClient({ keyExchange: new AsyncMap(), sessions: new AsyncMap(), users: new AsyncMap(), bundles: new AsyncMap(), bootstraps: new AsyncMap(), outbox: new AsyncMap() });
const client2 = new FreeSignalClient({ keyExchange: new AsyncMap(), sessions: new AsyncMap(), users: new AsyncMap(), bundles: new AsyncMap(), bootstraps: new AsyncMap(), outbox: new AsyncMap() });

client1.onMessage = (data) => console.log("Alice: ", decodeData<string>(data.payload));
client1.onRequest = (request) => request.accept();
client2.onMessage = (data) => console.log("Bob: ", decodeData<string>(data.payload));
client2.onRequest = (request) => request.accept();

setTimeout(() => client1.sendBootstrap(client2.userId), 500);
setTimeout(() => client1.sendData(client2.userId, "Hi Alice!"), 1000);
setTimeout(() => client2.sendData(client1.userId, "Hi Bob!"), 1500);
setTimeout(() => Promise.all(["How are you?", "How are this days?", "For me it's a good time"].map(msg => client1.sendData(client2.userId, msg))), 2000);
setTimeout(() => client2.sendData(client1.userId, "Not so bad my man"), 2500);
setTimeout(() => Promise.all(["I'm thinking...", "Is this secure?"].map(msg => client1.sendData(client2.userId, msg))), 3000);

setTimeout(() => process.exit(), 3500);

client1.connect("ws://localhost:12437");
client2.connect("ws://localhost:12437");