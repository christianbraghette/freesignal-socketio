import { Database, LocalStorage, Crypto, KeyExchangeDataBundle } from "@freesignal/interfaces";
import { Datagram, PrivateIdentityKey, UserId } from "@freesignal/protocol";
import { ExportedKeySession } from "@freesignal/protocol/double-ratchet";
import { BootstrapRequest, FreeSignalNode } from "@freesignal/protocol/node";

export class FreeSignalSocketio extends FreeSignalNode {
    protected readonly outbox: LocalStorage<string, Uint8Array[]>;

    public constructor(
        storage: Database<{ sessions: LocalStorage<string, ExportedKeySession>; keyExchange: LocalStorage<string, Crypto.KeyPair>; users: LocalStorage<string, string>; bundles: LocalStorage<string, KeyExchangeDataBundle>; bootstraps: LocalStorage<string, BootstrapRequest>; outbox: LocalStorage<string, Uint8Array[]>; }>,
        privateIdentityKey?: PrivateIdentityKey
    ) {
        super(storage, privateIdentityKey);
        this.outbox = storage.outbox;
    }

    protected async addToOutbox(userId: string | UserId, datagram: Datagram | Uint8Array) {
        const array = await this.outbox.get(userId.toString());
        this.outbox.set(userId.toString(), [...(array ?? []), Datagram.from(datagram).toBytes()]);
    }

    protected async flushOutbox() {
        for (const [userId, array] of Array.from(await this.outbox.entries() ?? [])) {
            await this.outbox.delete(userId);
            for (const data of array) {
                this.emitter.emit('send', { userId: UserId.from(userId), datagram: Datagram.from(data) });
            }
        }
    }

    public onClose: () => void = () => { };
    public onError: (err: Event | Error) => void = () => { };
}