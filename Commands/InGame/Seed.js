const Command = require("../_/Command.js");

const RealmApi = require('../../Classes/Realm.js')
const Client = require('../../Classes/Client.js');

class Seed extends Command {
    linkOnly = true;

    constructor() {
        super("seed", "Legit just view a realm's seed, requires a join.", require('../../Data/InputBlock.json'));
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
        this.maps.inGame.set(interaction.user.id, { type: "seedRealm", input, stage: "testingRealm", client: null, disconnect: false });

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

            client.on('start_game', async ({ seed, exported_from_editor, game_version, limited_world_width, limited_world_length, world_template_id, spawn_position }) => {
                // since seed is a signed 64-bit integer
                seed = BigInt.asIntN(64, seed);
                game_version = game_version.replaceAll('*', '')

                components
                    .reset()
                    .separator()
                    .text(
                        `### Realm Seed.\n` +
                        `-# perxa has fetched the realm seed for; **${realm.name}** *(${realm.id})*.`
                    )
                    .separator()
                    .text(
                        `### Realm Seed\n` +
                        `-# Seed: **${seed}**\n` +
                        `-# Exported World: **${exported_from_editor ? "yes" : "no"}**\n` +
                        `-# Was a download: **${world_template_id ? "yes" : "no"}**\n` +

                        `### Version Details\n` +
                        `-# Game Version: **${game_version || "26.50 (fallback)"}**\n` +
                        `-# Is valid: **yes**\n` + // todo

                        `### Limited World\n` +
                        `-# Limited Width: **${limited_world_width} (Million)**\n` +
                        `-# Limited Length: **${limited_world_length} (Million)**\n`
                    )
                    .separator()
                    .addLinkButton('ChunkBase', `https://www.chunkbase.com/apps/biome-finder#seed=${seed}&platform=bedrock_${game_version || "26_50"}&dimension=overworld&x=${spawn_position.x}&z=${spawn_position.z}`)

                await interaction.editReply({ components, flags: this.flags });

                client.destroyClient("disconnect for realm seed, normal ass disconnect", "defaultClose", false)
                this.maps.inGame.delete(this.interaction.user.id);
            });

            client.once('clientClosed', async ({ reason }) => this.closedComponent(realm, reason, client));
        } catch (error) {
            console.error(error);
        }
    }
}

module.exports = Seed;