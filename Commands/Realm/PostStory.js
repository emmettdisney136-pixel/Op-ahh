const Command = require("../_/Command.js");

const RealmApi = require('../../Classes/Realm.js')

class PostStory extends Command {
    subCommand = "post";
    linkOnly = true;

    constructor() {
        super("story", "Post a story to a realm, allowing message and a image.", [
            ...require('../../Data/InputBlock.json'),
            {
                type: 3,
                name: "message",
                description: "What to post to the realm story board.",
                required: false,
                min_value: 1,
                max_value: 125
            }
        ]);
    }

    /**
     * @param {import("discord.js").CommandInteraction} interaction
     * @param {{ components: import("../../Classes/DiscordJS/Component.js") }} helpers
     */
    async execute(interaction, { components, args }) {
        const { input, message = "we all </3 discord.gg/nethernet SOOOO much you should join it ASAP." } = args;
        Object.assign(this, { interaction, components });

        await interaction.deferReply({ flags: this.flags });

        const realmApi = new RealmApi(interaction.dbUser);
        await realmApi.init();

        let realm = /^\d+$/.test(input)
            ? await realmApi.getRealmInfoByID(input, true)
            : await realmApi.getRealmInfo(input, false, true);

        if (realm?.errorMsg) return this.invalidApiResponse(realm, input)

        delete realm.players;
        delete realm.slots;
        delete realm.friendlyId; // this isnt needed tbf

        const posted = await realmApi.sendMessageToClub(message, realm.clubId)
        if (!posted?.postUri && !posted?.postText === message) return this.fastReply('Failed to post message',
            `perxa had a issue while posting to that club ***\`${realm.clubId}\`***, read below for a full dump.\n` +
            `${posted}`
        )

        return this.fastReply(`Posted Story`,
            `perxa has posted ***\`${message}\`*** to **${realm.name}**, you can view this in realm stories!`
        )
    }
}

module.exports = PostStory;