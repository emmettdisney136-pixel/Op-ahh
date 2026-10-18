const Command = require("../_/Command.js");

class UnlinkCommand extends Command {
    subCommand = "account";
    global = true;
    linkOnly = false;

    constructor() {
        super("unlink", "Unlink your account from perxa, removing your account from our system.");
    }

    /**
     * @param {import("discord.js").CommandInteraction} interaction
     * @param {{ components: import("../../Classes/DiscordJS/Component.js") }} helpers
     */
    async execute(interaction, { components }) {
        Object.assign(this, { interaction, components });
        this.flags.push(64);

        await interaction.deferReply({ flags: this.flags });
        
        this.resetUser(interaction.dbUser, false); // since we can just fall back to interaction error handling,
        // we dont need anything more here :)

        components
            .reset()
            .separator()
            .text(
                `### [Account Unlinked!](https://discord.gg/nethernet)\n` +
                `-# perxa has Unlinked you from our service.` +
                ` With your unlinking, we keep hold of your ID only for 14 days. This is for perxa to apply to ***[Russian Regulations](https://www.dlapiperdataprotection.com/index.html?t=law&c=RU)***` +
                ` For more info please create a ticket or Private-Message a developer.`
            )
            .separator()
            .text(`### -# [Discord](https://discord.gg/nethernet) • [Telegram](https://t.me/kaboomTata)`);

        return interaction.editReply({ components, flags: this.flags });
    }
}

module.exports = UnlinkCommand;