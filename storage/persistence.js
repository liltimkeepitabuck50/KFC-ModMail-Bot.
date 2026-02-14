const fs = require('fs');
const path = require('path');
const { Events } = require('discord.js');

// Paths
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

let tickets = loadTickets();

console.log('[Persistence] Persistence module loaded.');

// GLOBAL HOOK: When ANY client becomes ready
require('discord.js').Client.prototype.once.call(
  require('discord.js').Client.prototype,
  'ready',
  async function () {
    console.log('[Persistence] Bot is ready. Repairing tickets…');

    const guildId = process.env.GUILD_ID;
    const guild = await this.guilds.fetch(guildId).catch(() => null);
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
  }
);

// GLOBAL HOOK: Channel created
require('discord.js').Client.prototype.on.call(
  require('discord.js').Client.prototype,
  'channelCreate',
  (channel) => {
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
  }
);

// GLOBAL HOOK: Channel deleted
require('discord.js').Client.prototype.on.call(
  require('discord.js').Client.prototype,
  'channelDelete',
  (channel) => {
    for (const userId of Object.keys(tickets)) {
      if (tickets[userId].channelId === channel.id) {
        delete tickets[userId];
        saveTickets(tickets);
      }
    }
  }
);

// GLOBAL HOOK: DM relay
require('discord.js').Client.prototype.on.call(
  require('discord.js').Client.prototype,
  'messageCreate',
  async function (message) {
    if (message.author.bot) return;
    if (message.guild) return;

    const userId = message.author.id;
    const ticket = tickets[userId];

    if (!ticket) return;

    const guild = await this.guilds.fetch(process.env.GUILD_ID).catch(() => null);
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
  }
);
