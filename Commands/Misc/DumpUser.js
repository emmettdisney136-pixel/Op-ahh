const Command = require("../_/Command.js");

const { User } = require('../../Data/JS/Database.js');

class DumpUser extends Command {
    staffOnly = true;

    constructor() {
        super("dump", "Dump a user.", [
            {
                type: 3,
                name: "user",
                description: "The user to dump.",
                required: true,
                min_value: 1,
                max_value: 21
            }
        ]);
    }

    /**
     * @param {import("discord.js").CommandInteraction} interaction
     * @param {{ components: import("../../Classes/DiscordJS/Component.js") }} helpers
     */
    async execute(interaction, { args, components }) {
        const { user } = args
        Object.assign(this, { interaction, components });
        this.flags.push(64);

        await interaction.deferReply({ flags: this.flags });

        const user2 = await User.findOne({ id: user }).lean()

        return interaction.editReply({
            files: [
                {
                    name: `${user}.txt`,
                    attachment: Buffer.from(JSON.stringify(user2, null, 2), 'utf-8'),
                }
            ]
        });
    }
}

module.exports = DumpUser;