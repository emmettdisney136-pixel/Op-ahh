const Command = require("../_/Command.js");

const RealmApi = require('../../Classes/Realm.js')
const Client = require('../../Classes/Client.js');

class Test extends Command {
    subCommand = "render";
    linkOnly = true;

    constructor() {
        super("presets", "Render a custom loaded preset of rendering blocks above people.", [
            ...require('../../Data/InputBlock.json'),
            {
                name: "action",
                description: "Custom rendering frame.",
                type: 4,
                required: true,
                choices: [
                    // { name: "Dildo", value: 1 },
                    { name: "Perxa", value: 2 },
                    { name: "Hard R", value: 3 }
                ]
            }
        ]);
    }

    /**
     * @param {import("discord.js").CommandInteraction} interaction
     * @param {{ components: import("../../Classes/DiscordJS/Component.js") }} helpers
     */
    async execute(interaction, { components, args }) {
        const { input, action } = args;
        Object.assign(this, { interaction, components });

        await interaction.deferReply({ flags: this.flags });

        if (this.maps.inGame.has(interaction.user.id) && !this.maps.inGame.has(interaction.user.id)?.disconnect)
            return this.fastReply("Already in game.", "You are already doing a in-game command, please wait for it to finish before doing another one.");
        this.maps.inGame.set(interaction.user.id, { type: "seedRealm", input, stage: "testingRealm", client: null, disconnect: false });

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

            const client = new Client(realmApi, realm, interaction.dbUser);
            if (this.maps.inGame.get(interaction.user.id).disconnect)
                client.destroyClient('User requested close before client connection.', 'fastClose');

            this.maps.inGame.get(interaction.user.id).client = client;

            client.timeouts.push(setTimeout(() => {
                client.destroyClient("Client timeout, Client -> Server closed.", "connectionVoided")
                this.maps.inGame.delete(interaction.user.id)
            },
                5 * 60000));

            client.on('start_game', async () => {
                components
                    .reset()
                    .separator()
                    .text(
                        `### Render.\n` +
                        `-# perxa has connected to **${realm.name}** *(${realm.id})*, and has started to render ***${["a dildo", "perxa text", "Hard R"][action - 1]}*** on anything moving.` +
                        ` The bot will disconnect **<t:${Math.floor(Date.now() / 1000) + 2 * 60}:R>**.\n\n` +
                        `-# **You can run  \` / cancel \`  at any time for the bot to disconnect instantly.**`
                    )
                    .separator();

                await interaction.editReply({ components, flags: this.flags });

                client.timeouts.push(setTimeout(() => client.destroyClient("disconnect from realm, normal for RenderBlock", "defaultClose"), 2 * 60000));
            });


            client.on('move_player', ({ position, face }) => {
                let px, py, pz, ax, az;
                const put = (x, y, z) => client.sendAction({ action: 'build_denied', position: { x, y, z }, result_position: { x, y, z }, face });
                const drawText = (text, px, py, pz) => { // maybe make this a command, to render text above people, for now only presets!
                    const chars = [...text.toUpperCase()].map(c => FONT[c] || FONT[' ']);
                    const total = chars.reduce((n, g) => n + g[0].length + 1, -1);

                    let ox = Math.floor((total - 1) / 2);
                    for (const g of chars) {
                        const w = g[0].length;
                        for (let row = 0; row < 5; row++)
                            for (let col = 0; col < w; col++)
                                if (g[row][col] === '1') put(px + ox - col, py + (4 - row), pz);

                        ox -= w + 1;
                    }
                };

                switch (action) {
                    case 1:
                        px = ~~position.x, py = ~~position.y, pz = ~~position.z;
                        ax = px, az = pz + 1;

                        put(ax - 1, py, az);
                        put(ax, py, az);
                        put(ax + 1, py, az);

                        for (let y = 1; y <= 3; y++) put(ax, py + y, az);
                        break;
                    case 2:
                        drawText('PERXA', ~~position.x, ~~position.y + 3, ~~position.z + 3);
                        break;
                    case 3:
                        drawText('NIGGER', ~~position.x, ~~position.y + 3, ~~position.z + 3);
                        break;
                }
            })

            client.once('clientClosed', async ({ reason }) => this.closedComponent(realm, reason, client));
        } catch (error) {
            console.error(error);
        }
    }
}

module.exports = Test;

const FONT = {
    A: ['110', '101', '111', '101', '101'], B: ['110', '101', '110', '101', '110'],
    C: ['011', '100', '100', '100', '011'], D: ['110', '101', '101', '101', '110'],
    E: ['111', '100', '110', '100', '111'], F: ['111', '100', '110', '100', '100'],
    G: ['011', '100', '101', '101', '011'], H: ['101', '101', '111', '101', '101'],
    I: ['111', '010', '010', '010', '111'], J: ['001', '001', '001', '101', '010'],
    K: ['101', '101', '110', '101', '101'], L: ['100', '100', '100', '100', '111'],
    M: ['101', '111', '111', '101', '101'], N: ['101', '111', '111', '111', '101'],
    O: ['010', '101', '101', '101', '010'], P: ['111', '101', '110', '100', '100'],
    Q: ['010', '101', '101', '110', '011'], R: ['110', '101', '110', '101', '101'],
    S: ['011', '100', '010', '001', '110'], T: ['111', '010', '010', '010', '010'],
    U: ['101', '101', '101', '101', '011'], V: ['101', '101', '101', '101', '010'],
    W: ['101', '101', '111', '111', '101'], X: ['101', '101', '010', '101', '101'],
    Y: ['101', '101', '010', '010', '010'], Z: ['111', '001', '010', '100', '111'],
    ' ': ['00', '00', '00', '00', '00'],
};