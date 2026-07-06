const express = require("express");
const mongoose = require("mongoose");
const { Client, GatewayIntentBits, Collection } = require("discord.js");

// ---------------- KEEP RENDER ALIVE
const app = express();
app.get("/", (req, res) => res.send("Invite bot running"));
app.listen(process.env.PORT || 3000);

// ---------------- DB CONNECT
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch(console.error);

// ---------------- DATABASE MODEL
const inviteSchema = new mongoose.Schema({
  userId: { type: String, unique: true },
  invites: { type: Number, default: 0 }
});

const Invite = mongoose.model("Invite", inviteSchema);

// ---------------- BOT
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites
  ]
});

// cache: guildId -> Map(inviteCode -> uses)
const inviteCache = new Map();

// ---------------- READY
client.once("clientReady", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  for (const guild of client.guilds.cache.values()) {
    try {
      const invites = await guild.invites.fetch();
      inviteCache.set(
        guild.id,
        new Map(invites.map(i => [i.code, i.uses]))
      );
    } catch {}
  }
});

// ---------------- UPDATE CACHE
async function updateCache(guild) {
  const invites = await guild.invites.fetch();
  inviteCache.set(
    guild.id,
    new Map(invites.map(i => [i.code, i.uses]))
  );
}

// ---------------- TRACK INVITES
client.on("guildMemberAdd", async (member) => {
  const guild = member.guild;

  const oldInvites = inviteCache.get(guild.id) || new Map();

  let newInvites;
  try {
    newInvites = await guild.invites.fetch();
  } catch {
    return;
  }

  const newCache = new Map(newInvites.map(i => [i.code, i.uses]));
  inviteCache.set(guild.id, newCache);

  const used = newInvites.find(inv => {
    return (oldInvites.get(inv.code) || 0) < inv.uses;
  });

  if (!used || !used.inviter) return;

  const userId = used.inviter.id;

  await Invite.findOneAndUpdate(
    { userId },
    { $inc: { invites: 1 } },
    { upsert: true }
  );

  console.log(`${userId} got +1 invite`);
});

// ---------------- SLASH COMMANDS
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // /invites
  if (interaction.commandName === "invites") {
    const user = interaction.options.getUser("user") || interaction.user;

    const data = await Invite.findOne({ userId: user.id });

    return interaction.reply({
      content: `${user.username} has **${data?.invites || 0} invites**`
    });
  }

  // /leaderboard
  if (interaction.commandName === "leaderboard") {
    const top = await Invite.find({})
      .sort({ invites: -1 })
      .limit(10);

    const list = await Promise.all(
      top.map(async (u, i) => {
        const user = await client.users.fetch(u.userId).catch(() => null);
        return `${i + 1}. ${user?.username || "Unknown"} — ${u.invites}`;
      })
    );

    return interaction.reply("🏆 **Invite Leaderboard**\n" + list.join("\n"));
  }
});

// ---------------- LOGIN
client.login(process.env.TOKEN);
