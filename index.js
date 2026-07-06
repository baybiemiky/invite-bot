console.log("BOT STARTED");

const express = require("express");
const mongoose = require("mongoose");
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder
} = require("discord.js");

// ---------------- EXPRESS (Render keep alive)
const app = express();
app.get("/", (req, res) => res.send("Invite bot running"));
app.listen(process.env.PORT || 3000);

// ---------------- MONGO
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch(err => console.log("Mongo error:", err));

// ---------------- DB
const inviteSchema = new mongoose.Schema({
  userId: { type: String, unique: true },
  invites: { type: Number, default: 0 }
});

const Invite = mongoose.model("Invite", inviteSchema);

// ---------------- CLIENT
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

// ---------------- INVITE CACHE
const inviteCache = new Map();

// ---------------- COMMANDS
const commands = [
  new SlashCommandBuilder()
    .setName("invites")
    .setDescription("Check invites")
    .addUserOption(opt =>
      opt.setName("user").setDescription("User").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Top inviters")
].map(c => c.toJSON());

// ---------------- INVITE SYNC FUNCTION
async function syncInvites() {
  for (const guild of client.guilds.cache.values()) {
    try {
      const invites = await guild.invites.fetch();

      inviteCache.set(
        guild.id,
        new Map(invites.map(i => [i.code, i.uses]))
      );

      console.log(`Synced invites for ${guild.name}`);
    } catch (err) {
      console.log("Invite sync failed:", guild.name);
    }
  }
}

// ---------------- REGISTER COMMANDS
async function registerCommands() {
  try {
    const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );

    console.log("Slash commands registered");
  } catch (err) {
    console.log("Command register error:", err);
  }
}

// ---------------- READY
client.once("clientReady", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  await registerCommands();
  await syncInvites();
});

// ---------------- RECONNECT SAFETY
client.on("shardReconnecting", async () => {
  console.log("Reconnecting... resyncing invites");
  await syncInvites();
});

// ---------------- INVITE TRACKING
client.on("guildMemberAdd", async (member) => {
  const guild = member.guild;

  const oldInvites = inviteCache.get(guild.id) || new Map();

  let newInvites;
  try {
    newInvites = await guild.invites.fetch();
  } catch {
    return;
  }

  inviteCache.set(
    guild.id,
    new Map(newInvites.map(i => [i.code, i.uses]))
  );

  const used = newInvites.find(inv =>
    (oldInvites.get(inv.code) || 0) < inv.uses
  );

  if (!used || !used.inviter) return;

  const inviterId = used.inviter.id;

  const data = await Invite.findOneAndUpdate(
    { userId: inviterId },
    { $inc: { invites: 1 } },
    { upsert: true, new: true }
  );

  console.log(`${inviterId} now has ${data.invites}`);

  // ROLE AT 3 INVITES
  if (data.invites === 3) {
    const role = guild.roles.cache.find(r => r.name === "Met Requirement");
    if (role) {
      try {
        const user = await guild.members.fetch(inviterId);
        await user.roles.add(role);
        console.log("Role given");
      } catch (err) {
        console.log("Role error:", err);
      }
    }
  }

  // LOG CHANNEL
  const log = guild.channels.cache.find(c => c.name === "👤・user");
  if (log) {
    log.send(`${used.inviter.tag} invited ${member.user.tag}`);
  }
});

// ---------------- SLASH COMMANDS
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "invites") {
    const user = interaction.options.getUser("user") || interaction.user;

    const data = await Invite.findOne({ userId: user.id });
    const invites = data?.invites || 0;

    return interaction.reply({
      content: `${user.username} has **${invites} invites**`
    });
  }

  if (interaction.commandName === "leaderboard") {
    const top = await Invite.find().sort({ invites: -1 }).limit(10);

    if (!top.length) {
      return interaction.reply("No data yet.");
    }

    const msg = top.map((u, i) =>
      `**${i + 1}.** <@${u.userId}> — ${u.invites}`
    ).join("\n");

    return interaction.reply({ content: msg });
  }
});

// ---------------- LOGIN
client.login(process.env.TOKEN)
  .then(() => console.log("LOGIN SUCCESS"))
  .catch(err => console.log("LOGIN ERROR:", err));

// ---------------- KEEP ALIVE
setInterval(() => {
  console.log("Bot still running...");
}, 5 * 60 * 1000);
