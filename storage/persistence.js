const fs = require('fs');
const path = require('path');

// Path to tickets.json
const dataFolder = path.join(__dirname, '..', 'data');
const ticketFile = path.join(dataFolder, 'tickets.json');

// Ensure /data exists
if (!fs.existsSync(dataFolder)) {
  fs.mkdirSync(dataFolder);
}

// Ensure tickets.json exists
if (!fs.existsSync(ticketFile)) {
  fs.writeFileSync(ticketFile, '{}');
}

// Load tickets
function loadTickets() {
  try {
    return JSON.parse(fs.readFileSync(ticketFile, 'utf8'));
  } catch (err) {
    console.error('[Persistence] Failed to load tickets.json:', err);
    return {};
  }
}

// Save tickets
function saveTickets(tickets) {
  try {
    fs.writeFileSync(ticketFile, JSON.stringify(tickets, null, 2));
  } catch (err) {
    console.error('[Persistence] Failed to save tickets.json:', err);
  }
}

// GLOBAL TICKET STORE
let tickets = loadTickets();

// AUTO‑LOAD PERSISTENCE WHEN THIS FILE IS REQUIRED
module.exports = (client) => {
  console.log('[Persistence] Loaded ticket persistence module.');

  // Auto‑repair on startup
  client.once('ready', async () => {
    console.log('[Persistence] Checking stored tickets…');

    const guildId = process.env.GUILD_ID;
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return;

    for (const userId of Object.keys(tickets)) {
      const channelId = tickets[userId].channelId;

      const channel = await guild.channels.fetch(channelId).catch(() => null);

      if (!channel) {
        console.log(`[Persistence] Removing orphaned ticket for ${userId}`);
        delete tickets[userId];
        saveTickets(tickets);
      }
    }
  });

  // Detect ticket channel creation
  client.on('channelCreate', (channel) => {
    if (!channel.name.includes('-')) return;

    const parts = channel.name.split('-');
    const prefix = parts[0];
    const username = parts[1];
    const userId = parts[2];

    if (!userId) return;

    tickets[userId] = {
      userId,
      channelId: channel.id,
      department: prefix,
      claimedBy: null
    };

    saveTickets(tickets);
  });

  // Detect ticket deletion
  client.on('channelDelete', (channel) => {
    for (const userId of Object.keys(tickets)) {
      if (tickets[userId].channelId === channel.id) {
        delete tickets[userId];
        saveTickets(tickets);
      }
    }
  });

  // DM relay
  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (message.guild) return;

    const userId = message.author.id;
    const ticket = tickets[userId];

    if (!ticket) return;

    const guild = await client.guilds.fetch(process.env.GUILD_ID).catch(() => null);
    if (!guild) return;

    const channel = await guild.channels.fetch(ticket.channelId).catch(() => null);

    if (!channel) {
      delete tickets[userId];
      saveTickets(tickets);
      return;
    }

    channel.send({
      embeds: [
        {
          title: 'New Message from User',
          description: message.content || '(no content)',
          color: 0x907575,
          footer: { text: `User ID: ${userId}` },
          timestamp: new Date()
        }
      ]
    });
  });
};
