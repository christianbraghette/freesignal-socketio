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
import { BootstrapRequest } from "@freesignal/protocol/node";
import { EventCallback } from "easyemitter.ts";
import { type Server as HttpServer } from "http";
import { Server, Socket } from 'socket.io';
import { FreeSignalSocketio, TransportEvent } from "./base.js";



export class FreeSignalServer extends FreeSignalSocketio {
    private wss?: Server;
    private readonly connections = new Map<string, Socket>();

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
            socket.emit(TransportEvent.MESSAGE, datagram.toBytes());
    };

    public listen(): this
    public listen(port: number): this
    public listen(server: HttpServer): this
    public listen(server?: HttpServer | number): this {
        server ??= 12437;
        this.wss = new Server(server, {
            cors: {
                /*origin: (origin, callback) => {
                    // origin può essere undefined (curl, mobile app, server)
                    callback(null, true);
                },*/
                origin: '*',
                //methods: ["GET", "POST"]
            }
        });
        this.wss.on('connection', async (socket) => {
            const userId: string = socket.handshake.auth.userId;

            if (!userId) {
                socket.disconnect();
                return;
            }

            console.debug("Client connected: ", userId);
            this.connections.set(userId, socket);

            socket.on(TransportEvent.MESSAGE, (data) => this.open(data));
            socket.on('disconnect', () => this.connections.delete(userId));

            socket.emit(TransportEvent.HANDSHAKE, this.userId.toString());
            if (!(await this.sessions.has(userId))) {
                this.sendBootstrap(userId);
            } else {
                this.sendHandshake(userId);
            }
        });
        return this;
    }

    public close() {
        if (this.wss?.close((err) => err ? this.onError(err) : undefined))
            this.onClose();
    }
}

