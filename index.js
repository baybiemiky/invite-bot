const express = require("express");
const mongoose = require("mongoose");
const { Client, GatewayIntentBits } = require("discord.js");

// ---------------- EXPRESS (Render keep-alive)
const app = express();
app.get("/", (req, res) => res.send("Bot is running"));
app.listen(process.env.PORT || 3000);

// ---------------- MONGOOSE
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch(console.error);

const inviteSchema = new mongoose.Schema({
  userId: { type: String, unique: true },
  invites: { type: Number, default: 0 }
});

const Invite = mongoose.model("Invite", inviteSchema);

// ---------------- DISCORD CLIENT
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites
  ]
});

// guildId -> invites cache
const inviteCache = new Map();

// ---------------- READY EVENT
client.once("clientReady", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  await refreshAllInvites();
});

// ---------------- REFRESH INVITES (IMPORTANT FIX)
async function refreshAllInvites() {
  for (const guild of client.guilds.cache.values()) {
    try {
      const invites = await guild.invites.fetch();
      inviteCache.set(guild.id, new Map(invites.map(i => [i.code, i.uses])));
    } catch (err) {
      console.log(`Failed to fetch invites for ${guild.name}`);
    }
  }
}

// ---------------- TRACK INVITES
client.on("guildMemberAdd", async (member) => {
  const guild = member.guild;

  let oldInvites = inviteCache.get(guild.id);
  if (!oldInvites) oldInvites = new Map();

  let newInvites;
  try {
    newInvites = await guild.invites.fetch();
  } catch {
    return;
  }

  inviteCache.set(guild.id, new Map(newInvites.map(i => [i.code, i.uses])));

  const usedInvite = newInvites.find(inv => {
    const oldUses = oldInvites.get(inv.code) || 0;
    return inv.uses > oldUses;
  });

  if (!usedInvite || !usedInvite.inviter) return;

  const inviterId = usedInvite.inviter.id;

  // ---------------- SAVE TO MONGODB (SAFE UPSERT)
  await Invite.findOneAndUpdate(
    { userId: inviterId },
    { $inc: { invites: 1 } },
    { upsert: true, new: true }
  );

  const updated = await Invite.findOne({ userId: inviterId });

  console.log(`${inviterId} now has ${updated.invites} invites`);

  // ---------------- ROLE REWARD
  if (updated.invites === 3) {
    const role = guild.roles.cache.find(r => r.name === "Met Requirement");
    if (!role) return;

    try {
      const user = await guild.members.fetch(inviterId);
      await user.roles.add(role);
    } catch (err) {
      console.log("Role error:", err);
    }
  }
});

// ---------------- LOGIN
client.login(process.env.TOKEN);
