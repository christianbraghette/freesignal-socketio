/**
 * FreeSignal Protocol
 * 
 * Copyright (C) 2025  Christian Braghette
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 * 
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>
 */

import { Database, LocalStorage, Crypto, KeyExchangeDataBundle } from "@freesignal/interfaces";
import { Datagram, PrivateIdentityKey, UserId } from "@freesignal/protocol";
import { ExportedKeySession, KeySession } from "@freesignal/protocol/double-ratchet";
import { BootstrapRequest, FreeSignalNode } from "@freesignal/protocol/node";
import { EventCallback } from "easyemitter.ts";
import { type Server as HttpServer } from "http";
import { Server, Socket as ServerSocket } from 'socket.io';
import { io, Socket as ClientSocket } from "socket.io-client";

class FreeSignalSocketio extends FreeSignalNode {
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

export class FreeSignalClient extends FreeSignalSocketio {
    private _serverId?: string;
    private socket?: ClientSocket;

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
                this.socket.send(datagram.toBytes());
    }

    public connect(url: string | URL): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                this.socket = io(url.toString(), {
                    auth: {
                        userId: this.userId.toString()
                    }
                });
    
                this.socket.on('handshake', async (userId) => {
                    this._serverId = userId;
                    await this.waitHandshaked(userId);
                    await this.flushOutbox();
                    resolve();
                });
    
                this.socket.on('message', async (data: Uint8Array) => { this.open(data); });
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

export class FreeSignalServer extends FreeSignalSocketio {
    private wss?: Server;
    private readonly connections = new Map<string, ServerSocket>();

    public constructor(
        storage: Database<{ sessions: LocalStorage<string, ExportedKeySession>; keyExchange: LocalStorage<string, Crypto.KeyPair>; users: LocalStorage<string, string>; bundles: LocalStorage<string, KeyExchangeDataBundle>; bootstraps: LocalStorage<string, BootstrapRequest>; outbox: LocalStorage<string, Uint8Array[]>; }>,
        privateIdentityKey?: PrivateIdentityKey
    ) {
        super(storage, privateIdentityKey);
        this.emitter.on('send', this.sendHandler);
        this.emitter.on('bootstrap', ({ request }) => request?.accept());
    }

    protected sendHandler: EventCallback<{ session?: KeySession; datagram?: Datagram; userId?: UserId; }, typeof this.emitter> = (eventData) => {
        const { session, datagram, userId } = eventData;
        if (!userId && !session)
            throw new Error("UserId missing");
        const receiverId = userId?.toString() || session?.userId.toString()!;
        const socket = this.connections.get(receiverId);
        if (!socket)
            throw new Error("Socket not found for user: " + userId);
        if (!datagram)
            throw new Error("Datagram missing");
        if (!socket.connected)
            this.addToOutbox(receiverId, datagram);
        else
            socket.send(datagram.toBytes());
    };

    public listen(): this
    public listen(port: number): this
    public listen(server: HttpServer): this
    public listen(server?: HttpServer | number): this {
        server ??= 12437;
        this.wss = new Server(server);
        this.wss.on('connection', async (socket) => {
            const userId: string = socket.handshake.auth.userId;

            if (!userId) {
                socket.disconnect();
                return;
            }

            console.debug("Client connected: ", userId);
            this.connections.set(userId, socket);

            socket.on('message', (data) => this.open(data));
            socket.on('disconnect', () => this.connections.delete(userId));

            socket.emit('handshake', this.userId.toString());
            if (!(await this.sessions.has(userId)))
                this.sendBootstrap(userId);
            else
                this.sendHandshake(userId);
        });
        return this;
    }

    public close() {
        if (this.wss?.close((err) => err ? this.onError(err) : undefined))
            this.onClose();
    }
}

