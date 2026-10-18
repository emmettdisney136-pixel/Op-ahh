const { v4 } = require('uuid')

const { Client: BedrockClient } = require('./Perxa-Bedrock/index')

const DisconnectReasons = require('../Data/minecraft/disconnectReasons.json')

const steve = require("../Data/minecraft/skins/Steve.json")
const capes = require("../Data/minecraft/skins/capes.json")

class Client extends BedrockClient {
    disconnected = false;
    intervals = [];
    timeouts = [];

    runtime = 0n;
    tick = 0n;
    position = { x: 0, y: 0, z: 0 };

    constructor(RealmAPI, Realm, DBUser, Settings) {
        super({ authflow: RealmAPI?.flow, networkId: Realm.address, skinData: { ...steve }, protocolVersion: 2193 });
        Object.assign(this, { RealmAPI, Realm, DBUser, Settings });

        this.#connect();
    }

    async #connect() {
        try {
            await Promise.race([
                new Promise(resolve => {
                    this.once('connectionAllowed', resolve);
                    this.init();
                }),

                new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timed out')), 15000))
            ]);

            this.setupListeners();
            this.connect();

            this.#applyCustomSkinData();
        } catch (error) {
            if (this.disconnected) return;
            // if (this.Settings.nickEh30) return this.#connect()

            if (error.message === 'Connection timed out')
                this.destroyClient('Failed to create upstream connection to server.', 'clientTimeout');

            console.error('Connection failed:', error);
        }
    }

    setupListeners() {
        this.once('disconnect', async ({ reason, message = "silentDisconnect" }) => {
            if (this.disconnected) return;
            console.log('Disconnected. Attempting to close all active states...')

            this.destroyClient(reason, message)
        });

        this.once('close', () => {
            if (this.disconnected) return;
            console.log('Disconnected. Attempting to close all active states...')

            this.destroyClient("Server closed our connection Client -> Server & Server -> Client.", "closeEmitted")
        })

        this.once('resource_packs_info', () => {
            const payload = {
                response_status: 'completed',
                response_status_name: 'resourcepackstackfinished',
                resourcepackids: []
            };

            this.write('resource_pack_client_response', payload);
            if (!this.Settings?.noRCR) this.write('request_chunk_radius', { chunk_radius: 16, max_radius: 8 });

            this.emit('join')
        });

        this.once('start_game', ({ player_position, runtime_entity_id }) => {
            this.position = player_position
            this.runtime = BigInt(runtime_entity_id)

            this.write('serverbound_loading_screen', { type: 2 });
            this.write("set_local_player_as_initialized", { runtime_entity_id: this.runtime });

            this.intervals.push(setInterval(() => this.RealmAPI.sendInGamePresenceRealm(this.Realm), 300000))
            // vision idk if it was 60000 so change if needed :pray:

            this.on('respawn', ({ state, position }) => {
                const packet = {
                    runtime_entity_id: this.runtime,
                    position: this.position,
                    result_position: state === 1 ? position : this.position
                };

                switch (state) {
                    case 0:
                        this.write('respawn', { ...packet, state: 2 })
                        break;
                    case 1:
                        this.write('player_action', { ...packet, action: 'respawn', face: -1 })

                        this.position = packet.result_position;
                        break;
                }
            });
        });
    }

    sendCommand(command, type = "automationplayer", amount = 1, subClientId = 2) {
        const packet = {
            command: String(command).substring(0, 256),
            internal: false,
            version: "Latest",
            origin: {
                type: type,
                uuid: type === "automationplayer" ? v4() : "",
                request_id: type === "automationplayer" ? v4() : "",
                player_entity_id: 0n
            }
        };

        this.write('command_request', packet, subClientId, 0, amount);
    }

    sendAction(packet, amount = 1, subClientId = 0) {
        packet.runtime_entity_id = this.runtime;

        this.write('player_action', packet, subClientId, 0, amount);
    }

    createSubClient(skinData = {}, amount = 1, subClientId = 2) {
        let skinDataPayload = {
            ...this.options?.skinData,
            PrimaryUser: false,
            ClientRandomId: Number((crypto.getRandomValues(new BigUint64Array(1))[0] / 1000n) * 1000n),
            ...steve,
            ...skinData
        };

        if (skinDataPayload.PersonaSkin && !skinDataPayload?.PremiumSkin) {
            skinDataPayload.SkinId = `${v4()}.persona-${this.DBUser.sticky.playfabId.toLowerCase()}-0`;
            skinDataPayload.SkinGeometry = btoa((atob(skinDataPayload.SkinGeometryData)).replaceAll(`aed7e8a4d485a49a-5`, `${this.DBUser.sticky.playfabId.toLowerCase()}-0`));
            skinDataPayload.SkinResources = btoa((atob(skinDataPayload.SkinResourcePatch)).replaceAll(`aed7e8a4d485a49a-5`, `${this.DBUser.sticky.playfabId.toLowerCase()}-0`));
        }

        delete skinDataPayload.SkinGeometryData, skinDataPayload.SkinResourcePatch;

        const packet = {
            tokens: {
                identity: JSON.stringify({ AuthenticationType: 1, Token: this.token }),
                client: JWT.sign(skinDataPayload, this.ecdhKeyPair.privateKey, { algorithm: 'ES384', header: { x5u: this.clientX509 } })
            }
        }

        this.write('sub_client_login', packet, subClientId, 0, amount);
    }

    #applyCustomSkinData() {
        const ssbp = this.Settings?.ssbpD
        this.#applyColors()

        if (!ssbp?.enabled && capes[String(this.DBUser?.capeWhatsOn)]) this.options.skinData.PersonaPieces.push(capes[String(this.DBUser?.capeWhatsOn)] || capes["home"])

        if (ssbp?.enabled) {
            switch (ssbp.type) {
                case 1:
                    this.options.skinData.AnimatedImageData[0].ImageWidth = -64
                    break;
                case 2:
                    this.options.skinData.AnimatedImageData[0].ImageHeight = -64
                    break;
                case 3:
                    this.options.skinData.CapeImageHeight = 65472
                    break;
                case 4:
                    this.options.skinData.CapeImageWidth = 65472
                    break;
            }
        }
    }

    #applyColors() {
        if (typeof this.DBUser.skinOverwrites !== 'object' || !Object.keys(this.DBUser.skinOverwrites).length) return;

        const skin = this.options.skinData;
        const { hair, eyes, tone, mouth } = this.DBUser.skinOverwrites;

        if (tone && tone !== "default") skin.SkinColor = tone;

        for (const [PieceType, color] of [["persona_eyes", eyes], ["persona_hair", hair], ["persona_mouth", mouth]]) {
            if (!color || color === "default") continue;
            const piece = skin.PieceTintColors.find(piece => piece.PieceType === PieceType);

            if (piece) piece.Colors[0] = color;
        }
    }

    destroyClient(reason = "Uhrm report this ty.", message = "noMessage", emitClosed = true) {
        if (this.disconnected) return;

        if (reason === "kicked") reason = message;
        emitClosed && this.emit('clientClosed', { reason: DisconnectReasons[reason] ?? reason, message })

        this.intervals.forEach(clearInterval);
        this.timeouts.forEach(clearTimeout);

        this.disconnected = true;
        this.close();
    }
}

module.exports = Client