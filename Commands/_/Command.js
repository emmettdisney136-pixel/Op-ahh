class Command { // default command structure
    cooldown = 3500;
    global = true;
    staffOnly = false;
    linkOnly = false;
    subCommand = null;

    constructor(name, description, options = []) {
        this.data = { name, description, options };
        this.maps = require('./CommandMaps')

        this.intervals = []
        this.timeouts = []

        this.interaction = null
        this.components = null
        this.flags = [1 << 15]
    }

    async execute(interaction) {
        await interaction.reply("yeah this command is NOT impliment you faggot");
    }

    fastReply(title, text = "", clearMap = false) {
        if (!this.components || !this.flags || !this.interaction) throw new Error("Components, flags or interaction not set");

        this.components.reset?.();
        this.components
            .text(`### ${title}\n${text}`)
            .separator()
            .text(`### -# [Discord](https://discord.gg/nethernet) • [Telegram](https://t.me/kaboomTata)`);

        if (clearMap) this.maps.inGame.delete(this.interaction.user.id);

        return !this.interaction.replied && !this.interaction.deferred ?
            this.interaction.reply({ components: this.components, flags: this.flags }) :
            this.interaction.editReply({ components: this.components, flags: this.flags });
    }

    invalidApiResponse(response, input) {
        return this.fastReply("API Failed.",
            `perxa had a issue with ***${input}***, and failed at fetching at the details. You can read below for more information.\n` +
            `### Failed at fetching ${response?.source}.\n### -# > **Message: *${response?.errorMsg}***`,
            true
        );
    }

    closedComponent(realm, reason = "fuck", client) {
        this.maps.inGame.delete(this.interaction.user.id);
        client?.destroyClient(null, 'closedComponentHandler', false);

        this.components
            .reset()
            .separator()
            .text(
                `### Client Disconnected.\n` +
                `-# perxa has disconnected from **${realm.name}** *(${realm.id})*, Client -> Server | Server -> Client has been closed!\n` +
                `### Reason ${reason.length > 255 ? `*(255/${reason.length} chars shown)*` : ``}\n### -# > ***${String(reason).substring(0, 255).replaceAll('\n', '') || "fuckass no reason!?"}***`
            )
            .separator()

        return !this.interaction.replied && !this.interaction.deferred ?
            this.interaction.reply({ components: this.components, flags: this.flags }) :
            this.interaction.editReply({ components: this.components, flags: this.flags });
    }

    async resetUser(dbUser, fullWipe = false) {
        if (fullWipe) return dbUser.deleteOne({ id: dbUser.id });
        dbUser.linked = false;

        dbUser.sticky.xuid = null;
        dbUser.sticky.gamertag = null;
        dbUser.sticky.playfabId = null;

        dbUser.linkData = {};

        await dbUser.save();
    }
}

module.exports = Command;