const Command = require("../_/Command.js");
const skinUpload = require("../../Data/minecraft/skins/apperanceObjects.json");

const PlayFabAPI = require("../../Classes/PlayFab");

class EditCommand extends Command {
    subCommand = "skin";
    linkOnly = true;

    constructor() {
        super("edit", "Edit your saved skin settings, forces rendering to render different colors on the skin.", [
            {
                name: "asset",
                description: "The skin asset to edit.",
                type: 3,
                required: true,
                choices: [
                    { name: "Eyes", value: "eyes" },
                    { name: "Hair", value: "hair" },
                    { name: "Mouth", value: "mouth" },
                    { name: "Skin Tone", value: "tone" }
                ]
            },
            {
                name: "color",
                description: "The color to use.",
                type: 3,
                required: true,
                choices: [
                    { name: "Default", value: "default" },
                    { name: "Black", value: "#000000" },
                    { name: "White", value: "#FFFFFF" },
                    { name: "Red", value: "#FF0000" },
                    { name: "Green", value: "#00FF00" },
                    { name: "Blue", value: "#0000FF" },
                    { name: "Yellow", value: "#FFFF00" },
                    { name: "Purple", value: "#db0ddb" },
                    { name: "Pink", value: "#FFC0CB" },
                    { name: "Orange", value: "#FFA500" },
                    { name: "Brown", value: "#8B4513" }
                ]
            }
        ]);
    }

    /**
     * @param {import("discord.js").CommandInteraction} interaction
     * @param {{ components: import("../../Classes/DiscordJS/Component.js") }} helpers
     */
    async execute(interaction, { args, components }) {
        const { asset, color } = args;
        const { dbUser } = interaction;
        
        Object.assign(this, { interaction, components });

        await interaction.deferReply({ flags: this.flags });

        if (!dbUser.skinOverwrites || typeof dbUser.skinOverwrites !== "object") dbUser.skinOverwrites = {};

        dbUser.skinOverwrites[asset] = color;
        await dbUser.save();

        const upload = structuredClone(skinUpload);
        const persona = upload.appearanceObjects.find(object => object.profileName === "personaProfile1")?.personaAppearance?.personaCollection?.universalApp;

        if (!persona) throw new Error("Failed to find persona skin data.");

        const pieces = {
            eyes: "a0f263b3-e093-4c85-aadb-3759417898ff/d",
            hair: "2bb1473b-9a5c-4eae-9fd5-82302a6aa3da/d",
            mouth: "2e4341c3-c014-4114-94b5-73968230aaaf/d"
        };

        if (asset === "tone") {
            const skin = persona.find(piece => piece.skcol);

            if (skin && color !== "default") skin.skcol = `#ff${color.slice(1).toLowerCase()}`;
        } else if (color !== "default") {
            const piece = persona.find(piece => piece.id === pieces[asset]);
            if (piece?.col) piece.col[0] = `#ff${color.slice(1).toLowerCase()}`;
        }

        const playfab = new PlayFabAPI(dbUser); // meow
        await playfab.uploadSkin(upload);
        
        return this.fastReply(
            `Skin Updated!`,
            `Updated your skin to have the following:\n` +
            `> Asset: ${asset}\n> Color: ${color}`
        );
    }
}

module.exports = EditCommand;