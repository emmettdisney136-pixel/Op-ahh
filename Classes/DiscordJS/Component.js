class ComponentBuilder extends Array {
    static get [Symbol.species]() {
        return Array;
    }

    constructor(color = 0x4F6EF7) {
        super();

        this.defaultColor = color;
        this.files = [];

        this.container = this.createContainer(color);

        super.push(this.container);
    }

    createContainer(color = this.defaultColor) {
        return {
            type: enums.CONTAINER,
            accent_color: color,
            components: []
        };
    }

    reset() {
        this.length = 0;

        this.files = [];

        this.container = this.createContainer(this.defaultColor);
        super.push(this.container);

        return this;
    }

    push(...components) {
        this.container.components.push(...components.filter(Boolean));

        return this;
    }

    text(content) {
        return this.push({
            type: enums.TEXT,
            content: Array.isArray(content)
                ? content.join("\n")
                : String(content)
        });
    }

    separator(spacing = 1, divider = true) {
        return this.push({ type: enums.SEPARATOR, divider, spacing });
    }

    addFile(url) {
        return this.push({ type: enums.FILE, file: { url } });
    }

    addImages(urls) {
        urls = Array.isArray(urls) ? urls : [urls];

        return this.push({ type: enums.MEDIA, items: urls.map(url => ({ media: { url } })) });
    }

    addThumbnail(url = "", ...texts) {
        return this.push({
            type: enums.SECTION,
            components: texts.map(text => ({ type: enums.TEXT, content: String(text) })),
            accessory: {
                type: enums.THUMBNAIL,
                media: { url }
            }
        });
    }

    addLinkButton(label, url, emoji = undefined) {
        if (url.includes(" ")) url = url.replaceAll(" ", "%20");

        return this.push({ type: enums.ACTION_ROW, components: [{ type: enums.BUTTON, style: 5, label, url, emoji }] });
    }

    addButtons({ custom_id, label, style = 1, emoji = null, text = null, disabled = false }) {
        return this.push({
            type: enums.SECTION,
            components: text
                ? [{
                    type: enums.TEXT,
                    content: text
                }]
                : [],
            accessory: {
                type: enums.BUTTON,
                custom_id, label, style, emoji, disabled
            }
        });
    }

    testButton(...buttons) {
        return this.push({
            type: enums.ACTION_ROW,
            components: buttons.map(button => ({ type: enums.BUTTON, ...button }))
        });
    }

    addSelectionMenu(type, custom_id, placeholder, options = []) {
        type = menuTypes[type] ?? type;

        const menu = { type, custom_id, placeholder };

        if (type === enums.USER_SELECT) menu.options = options;
        if (type === enums.CHANNEL_SELECT) menu.channel_types = [0, 2, 4, 5, 13];

        return this.push({ type: enums.ACTION_ROW, components: [menu] });
    }

    addFileAttachment(name, description, buffer) {
        this.files.push({ attachment: Buffer.from(buffer), name, description });

        return this;
    }

    newComponent(color = this.defaultColor, callback) {
        const container = this.createContainer(color ?? this.defaultColor);

        this.container = container;
        super.push(container);

        if (typeof callback === "function") callback(this);

        return this;
    }
}

module.exports = ComponentBuilder;

const enums = {
    ACTION_ROW: 1,
    BUTTON: 2,
    USER_SELECT: 3,
    MENTIONABLE_SELECT: 5,
    ROLE_SELECT: 6,
    CHANNEL_SELECT: 8,
    SECTION: 9,
    TEXT: 10,
    THUMBNAIL: 11,
    MEDIA: 12,
    FILE: 13,
    SEPARATOR: 14,
    CONTAINER: 17
};

const menuTypes = {
    user: enums.USER_SELECT,
    mentionable: enums.MENTIONABLE_SELECT,
    role: enums.ROLE_SELECT,
    channel: enums.CHANNEL_SELECT
};