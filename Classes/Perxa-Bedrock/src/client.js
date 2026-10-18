const { Connection } = require('./connection.js')

const { authenticate } = require('./client/auth.js')
const { createDeserializer, createSerializer } = require('./transforms/serializer.js')

const { NethernetClient } = require('./nethernet.js')
const { NethernetJSONRPC } = require('./websocket/signal-jsonrpc.js')

const JWT = require('jsonwebtoken')
const crypto = require('crypto')

class Client extends Connection {
    connection

    constructor(options) {
        super()
        this.options = { ...options }
        this.compressionThreshold = 512
        this.compressionLevel = options?.compressionLevel

        this.nethernet = {}
    }

    async init() {
        this.serializer = createSerializer()
        this.deserializer = createDeserializer()

        this.ecdhKeyPair = crypto.generateKeyPairSync('ec', { namedCurve: "secp384r1" })
        this.clientX509 = this.ecdhKeyPair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
        this.privateKeyPEM = this.ecdhKeyPair.privateKey.export({ format: 'pem', type: 'sec1' })

        await authenticate(this, this.options)

        this.connection = new NethernetClient({ networkId: this.options.networkId, token: this.token, ecdhKeyPair: this.ecdhKeyPair })
        this.nethernet.signalling = new NethernetJSONRPC(this.connection.nethernet.networkId, this.options);

        await this.nethernet.signalling.connect()

        this.connection.nethernet.credentials = this.nethernet.signalling.credentials
        this.connection.nethernet.signalHandler = this.nethernet.signalling.write.bind(this.nethernet.signalling)
        this.nethernet.signalling.on('signal', signal =>
            this.connection.nethernet.handleSignal(signal)
                .catch(error => this.close(error.message))
        )

        this.emit('connectionAllowed')
    }

    connect() {
        if (!this.connection || !this.nethernet.signalling) throw new Error('Connect not currently allowed')

        this.connection.onConnected = () => this.write('request_network_settings', { client_protocol: this.options?.protocolVersion || 2169 });
        this.connection.onCloseConnection = (reason) => this.close(reason)
        this.connection.onEncapsulated = (encapsulated) => this.handle(Buffer.from(encapsulated.buffer))

        this.connection.connect();
    }

    sendLogin() {
        const { options, tokenData, ecdhKeyPair, clientX509, token } = this;
        const PlayFabId = String(tokenData?.mid || 'aed7e8a4d485a49a').toLowerCase();

        options.skinData = {
            // [redacted]
            ...options?.skinData
        };

        const updatePlayFabId = data =>
            btoa(atob(data).replaceAll('aed7e8a4d485a49a-5', `${PlayFabId}-2`));

        options.skinData.SkinId = `persona-${PlayFabId}-2`;
        options.skinData.SkinGeometryData = updatePlayFabId(options.skinData.SkinGeometryData);
        options.skinData.SkinResourcePatch = updatePlayFabId(options.skinData.SkinResourcePatch);

        this.write('login', {
            protocol_version: options?.protocolVersion,
            tokens: {
                identity: JSON.stringify({ AuthenticationType: 0, Certificate: undefined, Token: token }),
                client: JWT.sign(options.skinData, ecdhKeyPair.privateKey, { algorithm: 'ES384', header: { x5u: clientX509 } })
            }
        });
    }

    close(reason, emit = true) {
        if (this.nethernet && emit) this.emit('close', reason)

        this.batch = null
        this.connection?.close()

        this.removeAllListeners()

        if (this.nethernet?.signalling) this.nethernet.signalling.destroy()
        this.nethernet = {}
    }

    readPacket(packet) {
        let des
        try { des = this.deserializer.parsePacketBuffer(packet) } 
        catch (error) { return this.emit('error', error) }

        const { name, params } = des.data; 
        if (!name || !params) return; // since some realms do this :(

        switch (name) {
            case 'network_settings':
                this.compressionThreshold = params.compression_threshold
                this.compressionReady = true
                this.batch.updateCompressionSettings(this)

                this.sendLogin()
                break;

            case 'server_to_client_handshake':
                this.write('client_to_server_handshake', {})
                break;

            case 'item_registry': {
                const itemstates = params.itemstates
                if (itemstates) {
                    for (let i = 0; i < itemstates.length; i++) {
                        const state = itemstates[i]

                        if (state.name === 'minecraft:shield') {
                            this.serializer.proto.setVariable('ShieldItemID',  state.runtime_id)
                            this.deserializer.proto.setVariable('ShieldItemID', state.runtime_id)
                            break;
                        }
                    }
                }
                break;
            }
        }

        this.emit(name, params)
    }
}

module.exports = { Client }