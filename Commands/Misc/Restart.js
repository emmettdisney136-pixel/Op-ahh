const Command = require('../_/Command.js');

class Restart extends Command {
    staffOnly = true;
    
    constructor() {
        super('restart', 'Restart Perxa');
    }

    /**
     * @param {import("discord.js").CommandInteraction} interaction
     * @param {{ components: import("../../Classes/DiscordJS/Component.js") }} helpers
     */
    async execute(interaction) {
        await interaction.deferReply({ flags: this.flags });
        await interaction.editReply({ content: '### -# Restarting Perxa, please wait.' });

        setTimeout(() => process.exit(0), 500);
    }
}

module.exports = Restart;