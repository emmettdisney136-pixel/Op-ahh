const Command = require("../_/Command.js");

const RealmApi = require('../../Classes/Realm.js')

class Players extends Command {
    subCommand = "realm";
    linkOnly = true;

    constructor() {
        super("players", "View a realm's players, using a API call rather than joining.", [
            ...require('../../Data/InputBlock.json'),
            {
                name: "leave",
                description: "Leave the Realm after the process is done.",
                type: 5,
                required: false
            }
        ]);
    }

    /**
     * @param {import("discord.js").CommandInteraction} interaction
     * @param {{ components: import("../../Classes/DiscordJS/Component.js") }} helpers
     */
    async execute(interaction, { components, args }) {
        const { input, leave } = args;
        Object.assign(this, { interaction, components });

        await interaction.deferReply({ flags: this.flags });

        const realmApi = new RealmApi(interaction.dbUser);
        await realmApi.init();

        let realm = /^\d+$/.test(input)
            ? await realmApi.getRealmInfoByID(input, true)
            : await realmApi.getRealmInfo(input, false, true);

        if (realm?.errorMsg) return this.invalidApiResponse(realm, input)

        realm.onlinePlayers = realm.players?.filter(p => p.online);
        delete realm.players;
        delete realm.slots;
        delete realm.friendlyId; // this isnt needed tbf

        if (leave) await realmApi.leaveRealm(realm.id)
        if (realm.onlinePlayers > 0)
            return this.fastReply('Woah there.', `There was no players found on **${realm.name} *(${realm.id})***, maybe do this on a realm that has members silly!`);

        realm.players = await realmApi.getXboxUserBulk(realm.onlinePlayers.map(p => p.uuid))

        components
            .reset()
            .separator()
            .text(
                `### Realm Players\n` +
                `-# perxa has found **${realm.name}** *(${realm.id})*.\n` +
                `-# **${realm.players?.length ?? 0} */* ${realm.maxPlayers}** players currently on the realm.`
            )
            .separator()
            .text(
                `### Player Info\n` +
                (
                    realm.players?.length
                        ? realm.players.map(player => {
                            const realmPlayer = realm.onlinePlayers?.find(p => p.uuid === player.xuid);
                            
                            return (
                                `**${player.gamertag ?? 'Unknown Player'}**\n` +
                                `-# Gamerscore: ***${Number(player.gamerScore ?? 0).toLocaleString()}***  >>  ${player.presenceState === 'Online' ? 'Online State' : 'Offline State'}\n` +
                                `-# Role: **${realmPlayer?.role ?? 'Unknown'}**  >>  Joined: **<t:${realmPlayer.lastLogin}:D>**\n` +
                                `-# **(\`${player.xuid}\`)**`
                            );
                        }).join('\n\n')
                        : '-# No players found.'
                )
            )
            .separator();

        await interaction.editReply({ components, flags: this.flags });
    }
}

module.exports = Players;