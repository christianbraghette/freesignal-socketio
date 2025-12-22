import { Datagram, UserId } from "@freesignal/protocol";
import { FreeSignalNode, FreeSignalNodeState } from "@freesignal/protocol/node";

const TransportEventPrefix = "transport:";
export enum TransportEvent {
    MESSAGE = `${TransportEventPrefix}message`,
    HANDSHAKE = `${TransportEventPrefix}handshake`
}

export interface FreeSignalSocketioState extends FreeSignalNodeState {
    outbox: Array<[string, Uint8Array[]]>
}

export class FreeSignalSocketio extends FreeSignalNode {
    protected readonly outbox: Map<string, Uint8Array[]>;

    public constructor(opts?: Partial<FreeSignalSocketioState>) {
        super(opts);
        this.outbox = new Map(opts?.outbox);
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