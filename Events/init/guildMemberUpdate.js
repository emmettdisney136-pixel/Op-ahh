const guildID = "1539384072848150609";
const mediaRole = "1544521550592606309";

class GuildMemberUpdate {
    name = "guildMemberUpdate";
    once = false;

    async execute(newMember) {
        if (newMember.guild.id !== guildID) return;

        const primary = newMember.user.primaryGuild;
        const hasTag = !!primary && primary.identityEnabled && primary.identityGuildId === guildID;
        const hasMedia = newMember.roles.cache.has(mediaRole);
        const perxaGuild = newMember.guild;

        if (hasTag && !hasMedia) {
            try {
                await newMember.roles.add(mediaRole);
            } catch (e) {
                console.log("error on applying role:", e);
                return;
            }

            try {
                await newMember.send(
                    `-# Thanks for wearing our tag, **${newMember.user.username}**! You now have Media permissions in **${perxaGuild.name}**.`
                );
            } catch {
            }
        } else if (!hasTag && hasMedia) {
            try {
                await newMember.roles.remove(mediaRole);
            } catch (e) {
                console.log("error on removing role:", e);
            }
        }
    }
}

module.exports = GuildMemberUpdate;
