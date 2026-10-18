const Command = require("../_/Command.js");

const RealmApi = require('../../Classes/Realm.js')
const { RealmWhitelist } = require('../../Data/JS/Database.js')

class Whitelist extends Command {
    subCommand = "realm";
    linkOnly = true;
    staffOnly = true;

    constructor() {
        super("whitelist", "Whitelist a realm, using Code or ID.", [
            ...require('../../Data/InputBlock.json'),
            {
                type: 6,
                name: 'owner',
                description: 'The user who owns the realm, or has wanted it to be whitelisted.',
                required: true
            }
        ]);
    }

    /**
     * @param {import("discord.js").CommandInteraction} interaction
     * @param {{ components: import("../../Classes/DiscordJS/Component.js") }} helpers
     */
    async execute(interaction, { components, args }) {
        const { input, owner } = args;
        Object.assign(this, { interaction, components });

        await interaction.deferReply({ flags: this.flags });

        const realmApi = new RealmApi(interaction.dbUser, true);
        await realmApi.init();

        let realm = /^\d+$/.test(input)
            ? await realmApi.getRealmInfoByID(input, true)
            : await realmApi.getRealmInfo(input, false, true);

        if (realm?.errorMsg) return this.invalidApiResponse(realm, input)

        const isAlreadyWhitelisted = await RealmWhitelist.findOne({ id: realm.id })
        if (isAlreadyWhitelisted?.id) {
            await RealmWhitelist.deleteOne({ id: realm.id })

            return this.fastReply(`Whitelist removed`, `${realm.name} has been removed from the whitelist like magic!`)
        }

        realm.totalPlayers = realm.players?.length || 0;
        delete realm.players;
        delete realm.slots;

        new RealmWhitelist({ id: realm.id, name: realm.name, ownerId: owner?.id }).save()
        await this.fastReply("Added to whitelisted", `${realm.name} (${realm.id}) was added to the whitelist`);

        await realmApi.leaveRealm(realm.id);
    }
}

module.exports = Whitelist;