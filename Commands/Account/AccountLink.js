const Command = require("../_/Command.js");

const PlayFabAPI = require("../../Classes/PlayFab");
const Authflow = require("../../Classes/AuthFlow/index.js");

const { cacheFactory } = require("../../Data/JS/Database");
const AndroidDevice = require("../../Data/JS/Devices").android;

class LinkCommand extends Command {
    subCommand = "account";

    constructor() {
        super("link", "Link your account to perxa, allowing us to use your account for connections, and API requests.");
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

        if (dbUser.linked && dbUser.sticky.gamertag) return this.fastReply(
            `Woah there!`,
            `-# You're already linked to our service with \`${dbUser.sticky.gamertag}\`\n-# **Use \`/account unlink\` first, to link a different account.**`
        );

        const existing = this.maps.optIn.get(interaction.user.id);
        if (existing && Date.now() - existing.started < 300000) return this.fastReply(
            `Calm down.`,
            `You already have a linking process active, please return to that one or wait until it expires <t:${Math.floor((existing.started + 300000) / 1000)}:R>..\n`
        );

        this.maps.optIn.set(interaction.user.id, { started: Date.now() });

        try {
            const authFlow = new Authflow(undefined, cacheFactory(dbUser),
                {
                    flow: AndroidDevice.flow,
                    authTitle: AndroidDevice.authTitle,
                    deviceType: AndroidDevice.deviceType
                },
                async (code) => {
                    components
                        .reset()
                        .separator()
                        .text(
                            `-# To link, simply click the code below, and login to Xbox, to link to **perxa**.\n` +
                            `### -# [ MSA Code ]\n## -# Please click this >> [\` ${code.user_code} \`](https://microsoft.com/link?otc=${code.user_code}) << to get redirected to a auth page.`
                        )
                        .separator()
                        .text(`### -# [Discord](https://discord.gg/nethernet) • [Telegram](https://t.me/kaboomTata)`);

                    await interaction.editReply({ components, flags: this.flags })
                        .catch(() => this.resetUser(dbUser));
                }
            );

            await authFlow.init()
            const { userXUID } = await authFlow.getXboxToken();
            if (!userXUID) throw new Error("Failed to obtain Xbox XUID.");

            const playFab = new PlayFabAPI(dbUser);

            const { PlayFabId } = await playFab.loginWithXbox();
            if (!PlayFabId) throw new Error("Failed to obtain PlayFab ID.");

            await playFab.uploadSkin()
                .catch(() => { }) // i dont give a fuck if this fails; obaq :)

            const { people: [person] } = await playFab.getXboxUser(userXUID);
            if (!person?.gamertag) throw new Error("Failed to retrieve Xbox profile.");

            dbUser.linked = true;

            dbUser.sticky.playfabId = PlayFabId.toLowerCase();
            dbUser.sticky.xuid = userXUID;
            dbUser.sticky.gamertag = person.gamertag;

            await dbUser.save();

            components
                .reset()
                .separator()
                .text(
                    `### [Account Linked!](https://discord.com/channels/1539384072848150609/1539388720254427146)\n` +
                    `-# perxa has linked your account, **[${dbUser.sticky.gamertag}](https://www.xbox.com/en-US/play/user/${dbUser.sticky.gamertag.replace(/ /g, "%20")})**, to our database.` +
                    ` You now have access to commands with **(${dbUser.premium ? "premium" : "out premium"})**, allowing you to use any ${dbUser.premium ? "premium" : "non premium"} command.` +
                    ` If you want, you can read more in our discord **[here](https://discord.com/channels/1539384072848150609/1539388720254427146)**.\n` +
                    `### -# > Please note, our discord includes more info, about everything.`
                )
                .separator()
                .text(`### -# [Discord](https://discord.gg/nethernet) • [Telegram](https://t.me/kaboomTata)`);

            await interaction.editReply({ components, flags: this.flags });
        } catch (err) {
            console.error(err);
            await this.resetUser(dbUser);

            await this.fastReply(
                `error`,
                `perxa had a issue with this command, please try again later, or read below for more details.\n\n${err.message ?? err}`
            );
        } finally {
            this.maps.optIn.delete(interaction.user.id);
        }
    }
}

module.exports = LinkCommand;