import { Database, LocalStorage, Crypto, KeyExchangeDataBundle } from "@freesignal/interfaces";
import { Datagram, PrivateIdentityKey, UserId } from "@freesignal/protocol";
import { ExportedKeySession, KeySession } from "@freesignal/protocol/double-ratchet";
import { BootstrapRequest } from "@freesignal/protocol/node";
import { io, Socket } from "socket.io-client";
import { EventCallback } from "easyemitter.ts";
import { FreeSignalSocketio, TransportEvent } from "./base.js"

export class FreeSignalClient extends FreeSignalSocketio {
    private _serverId?: string;
    private socket?: Socket;

    public constructor(
        storage: Database<{ sessions: LocalStorage<string, ExportedKeySession>; keyExchange: LocalStorage<string, Crypto.KeyPair>; users: LocalStorage<string, string>; bundles: LocalStorage<string, KeyExchangeDataBundle>; bootstraps: LocalStorage<string, BootstrapRequest>; outbox: LocalStorage<string, Uint8Array[]>; }>,
        privateIdentityKey?: PrivateIdentityKey
    ) {
        super(storage, privateIdentityKey);
        this.emitter.on('send', this.sendHandler);
    }

    public get connected(): boolean {
        return this.socket?.connected ?? false;
    }

    public get serverId(): UserId | undefined {
        return this._serverId ? UserId.from(this._serverId) : undefined;
    }

    protected sendHandler: EventCallback<{ session?: KeySession; payload?: Uint8Array; datagram?: Datagram; request?: BootstrapRequest; userId?: UserId; }, typeof this.emitter> = (eventData) => {
        const { session, datagram, userId } = eventData;
        if (!userId && !session)
            throw new Error("UserId missing");
        const receiverId = userId?.toString() || session?.userId.toString()!;
        if (!datagram)
            throw new Error("Datagram missing");
        if (!!this._serverId && receiverId !== this._serverId)
            this.sendRelay(this._serverId, receiverId, datagram);
        else
            if (!this.socket || !this.socket.connected)
                this.addToOutbox(receiverId, datagram);
            else
                this.socket.emit(TransportEvent.MESSAGE, datagram.toBytes());
    }

    public connect(url: string | URL): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                this.socket = io(url.toString(), {
                    auth: {
                        userId: this.userId.toString()
                    }
                });

                this.socket.on(TransportEvent.MESSAGE, (data) => {
                    this.open(new Uint8Array(data));
                });

                this.socket.on(TransportEvent.HANDSHAKE, async (userId) => {
                    this._serverId = userId;
                    await this.waitHandshaked(userId);
                    await this.flushOutbox();
                    resolve();
                });

                this.socket.on('error', (err) => this.onError(err));

                this.socket.on('disconnect', () => {
                    this.onClose();
                    this.socket = undefined;
                });
            } catch (error) {
                reject(error);
            }
        })
    }

    public close() {
        if (!this.socket)
            throw new Error("Socket not connected");
        this.socket.close();
        this.onClose();
    }

}