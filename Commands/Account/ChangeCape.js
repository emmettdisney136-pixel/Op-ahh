const Command = require("../_/Command.js");
const Capes = require('../../Data/minecraft/skins/capes.json')

class EditCommand extends Command {
    subCommand = "change";
    linkOnly = true;

    constructor() {
        super("cape", "Allows you to add a cool cape to your skin for operations.", [
            {
                name: "cape",
                description: "Type of cape to apply.",
                type: 3,
                required: true,
                choices: [
                    ...Object.entries(Capes).map(([name]) => ({ name: name.replaceAll("_", " "), value: name })),
                    { name: "Nothing", value: "none" }
                ]
            }
        ]);
    }

    /**
     * @param {import("discord.js").CommandInteraction} interaction
     * @param {{ components: import("../../Classes/DiscordJS/Component.js") }} helpers
     */
    async execute(interaction, { args, components }) {
        const { cape } = args;
        const { dbUser } = interaction;

        Object.assign(this, { interaction, components });

        await interaction.deferReply({ flags: this.flags });
        if (!dbUser.capeWhatsOn || typeof dbUser.capeWhatsOn !== "string") dbUser.capeWhatsOn = null;

        dbUser.capeWhatsOn = cape === "none" ? null : cape;
        await dbUser.save();

        components
            .reset()
            .separator()
            .text(
                `### Cape changed!\n` +
                `-# You have changed your in-game cape to the \`${cape}\`, you can view this by doing any in-game command where the bot spawns!`
            )
            .separator()
            .text(`### -# [Discord](https://discord.gg/nethernet) • [Telegram](https://t.me/kaboomTata)`);

        return interaction.editReply({ components, flags: this.flags });
    }
}

module.exports = EditCommand;