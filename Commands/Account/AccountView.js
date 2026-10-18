const Command = require("../_/Command.js");

class ViewCommand extends Command {
    subCommand = "account";
    linkOnly = true;

    constructor() {
        super("view", "View your linked account information.");
    }

    /**
     * @param {import("discord.js").CommandInteraction} interaction
     * @param {{ components: import("../../Classes/DiscordJS/Component.js") }} helpers
     */
    async execute(interaction, { components }) {
        const { dbUser } = interaction;

        Object.assign(this, { interaction, components });
        this.flags.push(64);

        await interaction.deferReply({ flags: this.flags });
        
        components
            .reset()
            .separator()
            .text(
                `### [Account Information!](https://discord.gg/nethernet)\n` +
                `-# Below you can find what details perxa has stored about your account.` +
                ` if you wish to logout, you can do so by using the  **\`/account unlink\`**  command at any time.`
            )
            .separator()
            .text(
                `## *${dbUser.sticky.gamertag.toLowerCase()}*\n` +
                `### State;\n` +
                `-# ***staff:** ${dbUser.staff}*\n` +
                // `-# ***linked:** ${dbUser.linked}*\n` +
                // `-# ***blacklisted:** ${dbUser.blacklisted}*\n` +
                `### Inventory;\n` +
                `-# ***netherQuartz:** ${dbUser.netherQuartz} (releasing soon)*\n` +
                // `-# ***ownedCapes:** ${dbUser.ownedCapes.length}\n` +
                `-# ***equipped cape:** ${dbUser.capeWhatsOn || "None"}*\n` +
                `-# ***total skin overwrites:** ${Object.keys(dbUser.skinOverwrites).length}*\n` +
                `### Account Details;\n` +
                `-# ***xbox gamertag:** ${dbUser.sticky.gamertag || "None"}*\n` +
                `-# ***xbox identifier:** ${dbUser.sticky.xuid || "None"}*\n` +
                `-# ***playfab identifier:** ${dbUser.sticky.playfabId || "None"}*\n`
            )
            .separator()
            .text(`### -# [Discord](https://discord.gg/nethernet) • [Telegram](https://t.me/kaboomTata)`);

        return interaction.editReply({ components, flags: this.flags });
    }
}

module.exports = ViewCommand;