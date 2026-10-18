const Command = require("../_/Command.js");

const RealmApi = require('../../Classes/Realm.js')
const Client = require('../../Classes/Client.js');

const { ReturnBatch } = require("../../Classes/Perxa-Bedrock/src/cache/Packet.js");

class RollBack extends Command {
    linkOnly = true;

    constructor() {
        super("rollback", "Rollback a realm to up to 5 minutes, this could work or not.", require('../../Data/InputBlock.json'));
    }

    /**
     * @param {import("discord.js").CommandInteraction} interaction
     * @param {{ components: import("../../Classes/DiscordJS/Component.js") }} helpers
     */
    async execute(interaction, { components, args }) {
        const { input } = args;
        Object.assign(this, { interaction, components });

        await interaction.deferReply({ flags: this.flags });

        if (this.maps.inGame.has(interaction.user.id) && !this.maps.inGame.has(interaction.user.id)?.disconnect)
            return this.fastReply("Already in game.", "You are already doing a in-game command, please wait for it to finish before doing another one.");
        this.maps.inGame.set(interaction.user.id, { type: "rollbackRealm", input, stage: "testingRealm", client: null, disconnect: false });

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

            const client = new Client(realmApi, realm, interaction.dbUser, { noRCR: true });
            if (this.maps.inGame.get(interaction.user.id).disconnect)
                client.destroyClient('User requested close before client connection.', 'fastClose');

            this.maps.inGame.get(interaction.user.id).client = client;

            client.timeouts.push(setTimeout(() => {
                client.destroyClient("Client timeout, Client -> Server closed.", "connectionVoided")
                this.maps.inGame.delete(interaction.user.id)
            },
                5 * 60000));

            client.on('join', () => {
                this.fastReply(
                    `RollBack attempt started.`,
                    `perxa has connected to ***${realm.name}*** and is attempting to rollback realm, ` +
                    `this could take up to 4 minutes so please wait until the bot disconnects.`
                );

                client.intervals.push(setInterval(() => client.sendCustomBatch(ReturnBatch("PlayerFog")), 0));

                client.timeouts.push(setTimeout(() =>
                    client.destroyClient("Perxa's limit was reached, 4 minutes have passed, wait until disconnect for rollback!", "defaultClose"),
                    4 * 60000)); // 4 minutes
            });

            client.once('clientClosed', async ({ reason }) => this.closedComponent(realm, reason, client));
        } catch (error) {
            console.error(error);
        }
    }
}

module.exports = RollBack;