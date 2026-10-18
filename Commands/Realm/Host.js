const Command = require("../_/Command.js");

const RealmApi = require('../../Classes/Realm.js')

class Host extends Command {
    subCommand = "realm";
    linkOnly = true;

    constructor() {
        super("host", "Just get's a realm connection information!", [
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

        let host = await realmApi.getRealmIP(realm?.id, true);
        if (host?.errorMsg) return this.invalidApiResponse(host, input)
        
        realm.address = host.address;

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
                `### Host Info\n` +
                `-# Networking Protocol: **${host.networkProtocol}**\n` +
                `-# Address: **${host.address}**\n` +
                `-# Pending Update: **${host.pendingUpdate}**\n` +
                `-# Session Region: **${host?.sessionRegionData?.regionName}**`
            )
            .separator();

        await interaction.editReply({ components, flags: this.flags });
    }
}

module.exports = Host;