const { Client, GatewayIntentBits } = require("discord.js");
const sqlite3 = require("sqlite3").verbose();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const db = new sqlite3.Database("./database.db");

// create table
db.run(`
CREATE TABLE IF NOT EXISTS invites (
  userId TEXT PRIMARY KEY,
  count INTEGER
)
`);

const inviteCache = new Map();

async function fetchInvites(guild) {
  const invites = await guild.invites.fetch();
  inviteCache.set(guild.id, invites);
}

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  for (const guild of client.guilds.cache.values()) {
    await fetchInvites(guild);
  }
});

client.on("guildMemberAdd", async (member) => {
  const guild = member.guild;

  const oldInvites = inviteCache.get(guild.id) || new Map();
  const newInvites = await guild.invites.fetch().catch(() => null);
  if (!newInvites) return;

  inviteCache.set(guild.id, newInvites);

  const used = newInvites.find((inv) => {
    const old = oldInvites.get(inv.code);
    return old && inv.uses > old.uses;
  });

  if (!used || !used.inviter) return;

  const id = used.inviter.id;

  db.get(`SELECT count FROM invites WHERE userId = ?`, [id], (err, row) => {
    let newCount = row ? row.count + 1 : 1;

    db.run(
      `INSERT INTO invites (userId, count) VALUES (?, ?)
       ON CONFLICT(userId) DO UPDATE SET count = ?`,
      [id, newCount, newCount]
    );

    console.log(`${id} now has ${newCount} invites`);

    if (newCount === 3) {
      const role = guild.roles.cache.find(r => r.name === "Met Requirement");

      if (role) {
        guild.members.fetch(id).then(user => {
          user.roles.add(role).catch(console.error);
        });
      }
    }
  });
});

// COMMANDS
client.on("messageCreate", (message) => {
  if (message.author.bot) return;

  if (message.content.startsWith("!invites")) {
    const user = message.mentions.users.first() || message.author;

    db.get(`SELECT count FROM invites WHERE userId = ?`, [user.id], (err, row) => {
      message.reply(`${user.username} has **${row?.count || 0} invites**`);
    });
  }

  if (message.content === "!leaderboard") {
    db.all(`SELECT * FROM invites ORDER BY count DESC LIMIT 10`, (err, rows) => {
      if (!rows.length) return message.reply("No invites yet.");

      const text = rows
        .map((r, i) => `${i + 1}. <@${r.userId}> — ${r.count}`)
        .join("\n");

      message.reply("**Invite Leaderboard:**\n" + text);
    });
  }
});

client.login(process.env.TOKEN);
