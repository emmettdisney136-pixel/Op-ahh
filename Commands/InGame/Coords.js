const Command = require("../_/Command.js");

const RealmApi = require('../../Classes/Realm.js')
const Client = require('../../Classes/Client.js');

class Coords extends Command {
    linkOnly = true;

    constructor() {
        super("coords", "Get player position details, local player.", require('../../Data/InputBlock.json'));
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
        this.maps.inGame.set(interaction.user.id, { type: "coordsRealm", input, stage: "testingRealm", client: null, disconnect: false });

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

            client.on('start_game', async ({ player_position, dimension, spawn_position, biome_name, player_gamemode, rain_level, lightning_level }) => {
                const dx = player_position.x - spawn_position.x;
                const dy = player_position.y - spawn_position.y;
                const dz = player_position.z - spawn_position.z;

                const weather = lightning_level > 0 ? 'Thunderstorm' : rain_level > 0 ? 'Rain' : 'Clear';
                const gamemodes = { 0: 'Survival', 1: 'Creative', 2: 'Adventure', 3: 'Spectator' };

                components
                    .reset()
                    .separator()
                    .text(
                        `### Realm Coords.\n` +
                        `-# perxa has connected to **${realm.name}** *(${realm.id})*.\n` +
                        `-# The positions below are relative to the realm spawn.\n` +
                        `-# The bot has been disconnected already.`
                    )
                    .separator()
                    .text(
                        `### Player Position (${dimension})\n` +
                        `-# X: **${player_position.x.toFixed(0)}**\n` +
                        `-# Y: **${player_position.y.toFixed(0)}**\n` +
                        `-# Z: **${player_position.z.toFixed(0)}**\n` +
                        // `-# Facing: **${rotation?.y?.toFixed(1) ?? 'Unknown'}°**\n` +

                        `### Spawn Position\n` +
                        `-# X: **${spawn_position.x.toFixed(0)}**\n` +
                        `-# Y: **${Math.round(spawn_position.y) + 1 }** \n` +
                        `-# Z: **${spawn_position.z.toFixed(0)}**\n` +

                        `### Relative to Spawn\n` +
                        `-# X: **${dx.toFixed(0)}** blocks\n` +
                        `-# Y: **${dy.toFixed(0)}** blocks\n` +
                        `-# Z: **${dz.toFixed(0)}** blocks\n` +
                        `-# Total: **${Math.sqrt(dx ** 2 + dy ** 2 + dz ** 2).toFixed(0)}** blocks`
                    )
                    .separator()
                    .text(
                        `### World Information\n` +
                        `-# Biome: **${biome_name?.replace('minecraft:', '') ?? 'Unknown'}**\n` +
                        `-# Gamemode: **${gamemodes[player_gamemode] ?? player_gamemode}**\n` +
                        `-# Weather: **${weather}**`
                    );

                await interaction.editReply({ components, flags: this.flags });

                this.maps.inGame.delete(this.interaction.user.id);
                client.destroyClient("disconnect for realm seed, normal ass disconnect", "defaultClose", false);
            });

            client.once('clientClosed', async ({ reason }) => this.closedComponent(realm, reason, client));
        } catch (error) {
            console.error(error);
        }
    }
}

module.exports = Coords;