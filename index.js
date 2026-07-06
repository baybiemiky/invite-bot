
console.log("BOT STARTING...");

const express = require("express");
const mongoose = require("mongoose");
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder
} = require("discord.js");

// ---------------- EXPRESS (keep alive for hosting)
const app = express();
app.get("/", (req, res) => res.send("Invite bot running"));
app.listen(process.env.PORT || 3000);

// ---------------- MONGO
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch(err => console.log("Mongo error:", err));

// ---------------- DATABASE
const inviteSchema = new mongoose.Schema({
  userId: { type: String, unique: true },
  regular: { type: Number, default: 0 },
  left: { type: Number, default: 0 }
});

const Invite = mongoose.model("Invite", inviteSchema);

// ---------------- DISCORD CLIENT
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

// ---------------- INVITE CACHE
const inviteCache = new Map();

// ---------------- SLASH COMMANDS
const commands = [
  new SlashCommandBuilder()
    .setName("invites")
    .setDescription("Check your invites")
    .addUserOption(opt =>
      opt.setName("user").setDescription("User").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Top inviters")
].map(c => c.toJSON());

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

// ---------------- SYNC INVITES
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

// ---------------- READY EVENT
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

// ---------------- INVITE TRACKING (JOIN)
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
    { $inc: { regular: 1 } },
    { upsert: true, new: true }
  );

  console.log(`${inviterId} now has ${data.regular} regular invites`);

  // CHECK ROLE (NET INVITES)
  const fullData = await Invite.findOne({ userId: inviterId });

  const net = (fullData?.regular || 0) - (fullData?.left || 0);

  if (net === 3) {
    const role = guild.roles.cache.find(r => r.name === "Met Requirement");

    if (role) {
      try {
        const user = await guild.members.fetch(inviterId);
        await user.roles.add(role);
        console.log("Role given to:", inviterId);
      } catch (err) {
        console.log("Role error:", err);
      }
    }
  }

  // ---------------- NEW INVITE LOG EMBED
  const logChannel = guild.channels.cache.get("1523472189574217940");

  if (logChannel) {
    const embed = new EmbedBuilder()
      .setTitle("📥 Invite Tracked")
      .setColor(0x3498db)
      .addFields(
        { name: "Member Joined", value: `${member.user.tag}`, inline: false },
        { name: "Invited By", value: `${used.inviter.tag}`, inline: false },
        { name: "Invite Code", value: used.code || "unknown", inline: true },
        { name: "Total Invites", value: `${data.regular}`, inline: true }
      )
      .setTimestamp();

    logChannel.send({ embeds: [embed] });
  }
});

// ---------------- LEFT TRACKING
client.on("guildMemberRemove", async (member) => {
  await Invite.findOneAndUpdate(
    { userId: member.id },
    { $inc: { left: 1 } },
    { upsert: true, new: true }
  );
});

// ---------------- SLASH COMMANDS
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "invites") {
    const user = interaction.options.getUser("user") || interaction.user;

    const data = await Invite.findOne({ userId: user.id });

    const regular = data?.regular || 0;
    const left = data?.left || 0;
    const net = regular - left;

    return interaction.reply({
      content:
`You currently have **${net} invites**.
(${regular} regular, ${left} left)`
    });
  }

  if (interaction.commandName === "leaderboard") {
    const top = await Invite.find().sort({ regular: -1 }).limit(10);

    if (!top.length) {
      return interaction.reply("No data yet.");
    }

    const msg = top.map((u, i) =>
      `**${i + 1}.** <@${u.userId}> — ${u.regular}`
    ).join("\n");

    return interaction.reply({ content: msg });
  }
});

// ---------------- LOGIN
client.login(process.env.TOKEN)
  .then(() => console.log("LOGIN SUCCESS"))
  .catch(err => console.log("LOGIN ERROR:", err));

// ---------------- HEARTBEAT
setInterval(() => {
  console.log("Bot still running...");
}, 5 * 60 * 1000);
