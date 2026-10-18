const Command = require("../_/Command.js");

const RealmApi = require('../../Classes/Realm.js')

class Fetch extends Command {
    subCommand = "realm";
    linkOnly = true;

    constructor() {
        super("fetch", "View a realm's details, allowing you to view some info that you might not visably see.", [
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

        realm.totalPlayers = realm.players?.length || 0;
        realm.totalOpertors = realm.players?.filter(p => p.operator).length;
        realm.onlinePlayers = realm.players?.filter(p => p.online).length;
        delete realm.players;
        delete realm.slots;
        delete realm.friendlyId; // this isnt needed tbf

        if (leave) await realmApi.leaveRealm(realm.id)

        components
            .reset()
            .separator()
            .text(
                `### Realm Details\n` +
                `-# perxa has found **${realm.name}** *(${realm.id})*.\n` +
                `-# The realm is currently **${realm.state.toLowerCase()}** with **${realm.maxPlayers}** max player slots.`
            )
            .separator()
            .text(
                `### Realm Information\n` +
                `-# Members: **${realm.totalPlayers} (${realm.onlinePlayers} online)**\n` +
                `-# Operators: **${realm.totalOpertors}**\n` +
                `-# Tier: **${realm.tier.replaceAll('_', ' ')}**\n` +
                `-# Hardcore: **${realm.isHardcore ? 'Yes' : 'No'}**`
            )
            .separator()
            .text(
                `### Stories\n` +
                `-# Autostories: **${realm.storiesSettings.autostories ? 'Enabled' : 'Disabled'}**\n` +
                `-# Coordinates: **${realm.storiesSettings.coordinates ? 'Enabled' : 'Disabled'}**\n` +
                `-# Timeline: **${realm.storiesSettings.timeline ? 'Enabled' : 'Disabled'}**\n` +
                `-# In-game chat: **${realm.storiesSettings.inGameChatMessages ? 'Enabled' : 'Disabled'}**`
            )
            .separator()
            .text(
                `### Realm MOTD\n` +
                `-# ${realm.motd || 'No MOTD set.'}`
            );

        await interaction.editReply({ components, flags: this.flags });
    }
}

module.exports = Fetch;