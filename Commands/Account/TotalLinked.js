const Command = require("../_/Command.js");
const { User } = require('../../Data/JS/Database.js')

class TotalLinked extends Command {
    subCommand = "database";
    linkOnly = true;
    staffOnly = true;

    constructor() {
        super("info", "Show's total linked users.");
    }

    /**
     * @param {import("discord.js").CommandInteraction} interaction
     * @param {{ components: import("../../Classes/DiscordJS/Component.js") }} helpers
     */
    async execute(interaction, { components }) {
        Object.assign(this, { interaction, components });

        await interaction.deferReply({ flags: this.flags });

        const total = await User.countDocuments();
        const withLinkFlag = await User.countDocuments({ linked: true })

        await this.fastReply(`Total Cached`, `There are a total of **${total}** cached users in the database, with **${withLinkFlag}** linked.`)
    }
}

module.exports = TotalLinked;