const express = require("express");
const mongoose = require("mongoose");
const { Client, GatewayIntentBits } = require("discord.js");

// ---------------- EXPRESS (Render keep alive)
const app = express();
app.get("/", (req, res) => res.send("Invite bot running"));
app.listen(process.env.PORT || 3000);

// ---------------- MONGO DB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch(console.error);

// ---------------- DATABASE
const inviteSchema = new mongoose.Schema({
  userId: { type: String, unique: true },
  invites: { type: Number, default: 0 }
});

const Invite = mongoose.model("Invite", inviteSchema);

// ---------------- DISCORD BOT
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites
  ]
});

// ---------------- INVITE CACHE
const inviteCache = new Map();

// ---------------- READY EVENT
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

  const used = newInvites.find(inv => {
    return (oldInvites.get(inv.code) || 0) < inv.uses;
  });

  if (!used || !used.inviter) return;

  const inviterId = used.inviter.id;

  const data = await Invite.findOneAndUpdate(
    { userId: inviterId },
    { $inc: { invites: 1 } },
    { upsert: true, new: true }
  );

  console.log(`${inviterId} now has ${data.invites} invites`);

  // ---------------- ROLE GIVE AT 3 INVITES
  if (data.invites === 3) {
    const role = guild.roles.cache.find(r => r.name === "Met Requirement");
    if (!role) return;

    try {
      const user = await guild.members.fetch(inviterId);
      await user.roles.add(role);
      console.log("Role given");
    } catch (err) {
      console.log(err);
    }
  }
});

// ---------------- LOGIN
client.login(process.env.TOKEN);