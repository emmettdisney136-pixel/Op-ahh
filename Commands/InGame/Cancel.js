const Command = require("../_/Command.js");

class Cancel extends Command {
    linkOnly = true;

    constructor() {
        super("cancel", "Cancel a operation.");
    }

    /**
     * @param {import("discord.js").CommandInteraction} interaction
     * @param {{ components: import("../../Classes/DiscordJS/Component.js") }} helpers
     */
    async execute(interaction, { components }) {
        Object.assign(this, { interaction, components });

        await interaction.deferReply({ flags: this.flags });

        if (!this.maps.inGame.has(interaction.user.id))
            return this.fastReply("Not in game.", "You are not doing a in-game command, please do one before trying to cancel it.");

        const { client } = this.maps.inGame.get(interaction.user.id);

        this.maps.inGame.get(interaction.user.id).disconnect = true;
        client?.destroyClient("Requested to close by user, canceling operation.", "cancel", true);

        await new Promise(resolve => setTimeout(resolve, 2000));
        if (this.maps.inGame.has(interaction.user.id)) this.maps.inGame.delete(interaction.user.id);
        // simple way of implimenting this, i cba to handle this in each command tbh

        return this.fastReply("Canceled.", "You have canceled the operation, the client has been closed.");
    }
}

module.exports = Cancel;