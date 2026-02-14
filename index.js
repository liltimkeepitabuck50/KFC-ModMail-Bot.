require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
  ChannelType,
  Collection,
} = require('discord.js');
const express = require('express');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User],
});

// ENV
const TOKEN = process.env.TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const TICKET_CATEGORY_ID = process.env.TICKET_CATEGORY_ID;
const TRANSCRIPT_CHANNEL_ID = process.env.TRANSCRIPT_CHANNEL_ID;

const PR_ROLE_ID = process.env.PR_ROLE_ID;
const S_ROLE_ID = process.env.S_ROLE_ID;
const GS_ROLE_ID = process.env.GS_ROLE_ID;
const LS_ROLE_ID = process.env.LS_ROLE_ID;

const PREFIX = '!';

// In‑memory ticket store
const tickets = new Map();

// Helper: themed embed
function supportEmbed(title, description) {
  const embed = new EmbedBuilder().setColor(0x907575);
  if (title) embed.setTitle(title);
  if (description) embed.setDescription(description);
  return embed;
}

// Helper: department info
function getDepartmentInfo(key) {
  switch (key) {
    case 'pr':
      return { name: 'Public Relations', roleId: PR_ROLE_ID, prefix: 'pr' };
    case 's':
      return { name: 'Staffing Support', roleId: S_ROLE_ID, prefix: 's' };
    case 'gs':
      return { name: 'General Support', roleId: GS_ROLE_ID, prefix: 'gs' };
    case 'ls':
      return { name: 'Leadership Support', roleId: LS_ROLE_ID, prefix: 'ls' };
    default:
      return null;
  }
}

// Helper: find ticket by channelId
function getTicketByChannel(channelId) {
  for (const [userId, data] of tickets.entries()) {
    if (data.channelId === channelId) return { userId, ...data };
  }
  return null;
}

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// DM handler
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // Commands (guild only)
  if (message.guild && message.content.startsWith(PREFIX)) {
    return handleCommand(message);
  }

  // DM flow
  if (message.channel.type === ChannelType.DM) {
    const user = message.author;

    // If this DM is part of an existing ticket, relay to channel
    const existing = tickets.get(user.id);
    if (existing) {
      const guild = await client.guilds.fetch(GUILD_ID).catch(() => null);
      if (!guild) return;
      const channel = await guild.channels.fetch(existing.channelId).catch(() => null);
      if (!channel) return;

      const embed = supportEmbed('New Message from User', message.content || '(no content)')
        .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
        .setFooter({ text: `User ID: ${user.id}` })
        .setTimestamp();

      if (message.attachments.size > 0) {
        embed.addFields({
          name: 'Attachments',
          value: message.attachments.map((a) => a.url).join('\n'),
        });
      }

      await channel.send({ embeds: [embed] });
      return;
    }

    // No ticket yet → ask to open
    const confirmEmbed = supportEmbed(
      'OPEN A SUPPORT TICKET 📬',
      'Would you like to open a support ticket? '
    ).addFields(
      { name: 'Note', value: 'Opening this ticket will create a private environment for you and our staff team to chat.' }
    );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ticket_confirm_open')
        .setLabel('✔️')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('ticket_cancel_open')
        .setLabel('✖️')
        .setStyle(ButtonStyle.Secondary)
    );

    await message.channel.send({ embeds: [confirmEmbed], components: [row] });
  }
});

// Button interactions
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  const { customId, user } = interaction;

  // Confirm / cancel ticket open
  if (customId === 'ticket_confirm_open') {
    const deptEmbed = supportEmbed(
      'Choose Support Department',
      'Please select the department that best matches your request.'
    );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('dept_pr').setLabel('Public Relations').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('dept_s').setLabel('Staffing Support').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('dept_gs').setLabel('General Support').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('dept_ls').setLabel('Leadership Support').setStyle(ButtonStyle.Danger)
    );

    await interaction.update({ embeds: [deptEmbed], components: [row] });
    return;
  }

  if (customId === 'ticket_cancel_open') {
    await interaction.update({
      embeds: [supportEmbed('Ticket Cancelled', 'No ticket has been opened.')],
      components: [],
    });
    return;
  }

  // Department selection
  if (customId.startsWith('dept_')) {
    const deptKey = customId.split('_')[1];
    const info = getDepartmentInfo(deptKey);
    if (!info) {
      await interaction.reply({
        embeds: [supportEmbed('Error', 'Unknown department.')],
        ephemeral: true,
      });
      return;
    }

    const guild = await client.guilds.fetch(GUILD_ID).catch(() => null);
    if (!guild) {
      await interaction.reply({
        embeds: [supportEmbed('Error', 'Guild not found.')],
        ephemeral: true,
      });
      return;
    }

    if (tickets.has(user.id)) {
      await interaction.reply({
        embeds: [supportEmbed('Ticket Already Open', 'You already have an open ticket.')],
        ephemeral: true,
      });
      return;
    }

    const channelName = `${info.prefix}-${user.username}-${user.id.slice(-4)}`;

    const channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: TICKET_CATEGORY_ID,
      permissionOverwrites: [
        {
          id: guild.roles.everyone,
          deny: [PermissionsBitField.Flags.ViewChannel],
        },
        {
          id: info.roleId,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
          ],
        },
        {
          id: client.user.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
            PermissionsBitField.Flags.ManageChannels,
            PermissionsBitField.Flags.ManageMessages,
          ],
        },
      ],
    });

    tickets.set(user.id, {
      userId: user.id,
      channelId: channel.id,
      department: deptKey,
      claimedBy: null,
    });

    // UPDATED TICKET PANEL EMBED (with new color + supportEmbed)
    const ticketEmbed = new EmbedBuilder()
      .setColor(0x907575)
      .setTitle('🎫 New Support Ticket')
      .setDescription('A new ticket has been opened. Please assist the person when availible.')
      .addFields(
        { 
          name: 'User',
          value: `<@${user.id}> (${user.tag})`,
          inline: false,
        },
        {
          name: 'User ID',
          value: user.id,
          inline: true,
        },
        {
          name: 'Account Created',
          value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`,
          inline: true,
        },
        {
          name: 'Department',
          value: `**${info.name}**. Say !reply before your message to talk to the support client.`,
          inline: false,
        }
      )
      .setTimestamp();

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket_claim').setLabel('Claim').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('ticket_unclaim').setLabel('Unclaim').setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId('ticket_close').setLabel('Close').setStyle(ButtonStyle.Danger)
    );

    await channel.send({
      content: `<@&${info.roleId}> New ticket opened.`,
      embeds: [ticketEmbed],
      components: [buttons],
    });

    const userEmbed = supportEmbed(
      'Ticket Opened',
      `Your ticket has been opened in **${info.name}**.\nOur staff will respond here.`
    );
    await interaction.update({ embeds: [userEmbed], components: [] });

    return;
  }

  // Claim / Unclaim / Close buttons
  if (['ticket_claim', 'ticket_unclaim', 'ticket_close'].includes(customId)) {
    const channel = interaction.channel;
    if (!channel || channel.type !== ChannelType.GuildText) return;

    const ticket = getTicketByChannel(channel.id);
    if (!ticket) {
      await interaction.reply({
        embeds: [supportEmbed('Error', 'This channel is not linked to a ticket.')],
        ephemeral: true,
      });
      return;
    }

    if (customId === 'ticket_claim') {
      if (ticket.claimedBy && ticket.claimedBy !== interaction.user.id) {
        await interaction.reply({
          embeds: [supportEmbed('Already Claimed', `This ticket is already claimed by <@${ticket.claimedBy}>.`)],
          ephemeral: true,
        });
        return;
      }

      ticket.claimedBy = interaction.user.id;
      tickets.set(ticket.userId, ticket);

      const embed = supportEmbed(
        'Ticket Claimed',
        `This ticket has been claimed by <@${interaction.user.id}>.`
      );

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket_claim').setLabel('Claim').setStyle(ButtonStyle.Danger).setDisabled(true),
        new ButtonBuilder().setCustomId('ticket_unclaim').setLabel('Unclaim').setStyle(ButtonStyle.Secondary).setDisabled(false),
        new ButtonBuilder().setCustomId('ticket_close').setLabel('Close').setStyle(ButtonStyle.Danger)
      );

      await interaction.update({ embeds: [embed], components: [row] });
      return;
    }

    if (customId === 'ticket_unclaim') {
      if (ticket.claimedBy !== interaction.user.id) {
        await interaction.reply({
          embeds: [supportEmbed('Not Claimer', 'Only the staff member who claimed this ticket can unclaim it.')],
          ephemeral: true,
        });
        return;
      }

      ticket.claimedBy = null;
      tickets.set(ticket.userId, ticket);

      const embed = supportEmbed('Ticket Unclaimed', 'This ticket is now unclaimed.');

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket_claim').setLabel('Claim').setStyle(ButtonStyle.Danger).setDisabled(false),
        new ButtonBuilder().setCustomId('ticket_unclaim').setLabel('Unclaim').setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId('ticket_close').setLabel('Close').setStyle(ButtonStyle.Danger)
      );

      await interaction.update({ embeds: [embed], components: [row] });
      return;
    }

    if (customId === 'ticket_close') {
      await interaction.deferUpdate();

      const messages = await channel.messages.fetch({ limit: 100 });
      const sorted = Array.from(messages.values()).sort(
        (a, b) => a.createdTimestamp - b.createdTimestamp
      );

      let transcriptText = `Transcript for ticket channel #${channel.name}\nChannel ID: ${channel.id}\nUser ID: ${ticket.userId}\nClosed by: ${interaction.user.tag} (${interaction.user.id})\n\n`;

      for (const msg of sorted) {
        const time = new Date(msg.createdTimestamp).toISOString();
        const author = `${msg.author.tag} (${msg.author.id})`;
        const content = msg.content || '';
        const attachments = msg.attachments.size
          ? ` [Attachments: ${msg.attachments.map((a) => a.url).join(', ')}]`
          : '';
        transcriptText += `[${time}] ${author}: ${content}${attachments}\n`;
      }

      const transcriptChannel = await client.channels
        .fetch(TRANSCRIPT_CHANNEL_ID)
        .catch(() => null);

      if (transcriptChannel && transcriptChannel.isTextBased()) {
        await transcriptChannel.send({
          content: `Transcript for ticket channel #${channel.name}`,
          files: [
            {
              attachment: Buffer.from(transcriptText, 'utf-8'),
              name: `transcript-${channel.id}.txt`,
            },
          ],
        });
      }

      const user = await client.users.fetch(ticket.userId).catch(() => null);
      if (user) {
        const closedEmbed = supportEmbed(
          'Ticket Closed',
          'Your ticket has been closed. Thank you for contacting us.'
        );
        await user.send({ embeds: [closedEmbed] }).catch(() => null);
      }

      tickets.delete(ticket.userId);
      await channel.delete().catch(() => null);
      return;
    }
  }
});

// Command handler
async function handleCommand(message) {
  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const cmd = args.shift()?.toLowerCase();
  if (!cmd) return;

  if (!message.guild) return;

  const channel = message.channel;
  const ticket = getTicketByChannel(channel.id);

  if (['reply', 'connect', 'transfer'].includes(cmd) && !ticket) return;

  if (cmd === 'reply') {
    const replyText = args.join(' ');
    if (!replyText) {
      await message.reply({
        embeds: [supportEmbed('Usage', '!reply <message>')],
      });
      return;
    }

    const user = await client.users.fetch(ticket.userId).catch(() => null);
    if (!user) {
      const errMsg = await message.reply({
        embeds: [supportEmbed('Error', 'Could not find the user for this ticket.')],
      });
      await errMsg.react('❌').catch(() => null);
      return;
    }

    const dmEmbed = supportEmbed('Staff Reply', replyText).setFooter({
      text: `From: ${message.author.tag}`,
    });

    try {
      await user.send({ embeds: [dmEmbed] });

      const logEmbed = supportEmbed('Reply Sent to User', replyText)
        .setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL() })
        .setTimestamp();

      await channel.send({ embeds: [logEmbed] });

      await message.react('📨').catch(() => null);
    } catch (err) {
      const logEmbed = supportEmbed(
        'Reply Failed',
        'Could not send message to the user (they may have DMs closed or blocked the bot).'
      );
      await channel.send({ embeds: [logEmbed] });
      await message.react('❌').catch(() => null);
    }

    return;
  }

  if (cmd === 'connect') {
    const deptInfo = getDepartmentInfo(ticket.department);
    const user = await client.users.fetch(ticket.userId).catch(() => null);
    if (!user) {
      await message.reply({
        embeds: [supportEmbed('Error', 'Could not find the user for this ticket.')],
      });
      return;
    }

    const embed = supportEmbed(
      'Staff Member Connected',
      'A staff member has connected to your ticket.'
    ).addFields(
      { name: 'Staff Member', value: `${message.author.tag}`, inline: true },
      { name: 'Department', value: deptInfo ? deptInfo.name : 'Unknown', inline: true }
    );

    try {
      await user.send({ embeds: [embed] });

      const logEmbed = supportEmbed(
        'Connect Sent',
        `You have connected to the user.\nDepartment: **${deptInfo ? deptInfo.name : 'Unknown'}**`
      );
      await channel.send({ embeds: [logEmbed] });
      await message.react('📨').catch(() => null);
    } catch (err) {
      const logEmbed = supportEmbed(
        'Connect Failed',
        'Could not send connection notice to the user.'
      );
      await channel.send({ embeds: [logEmbed] });
      await message.react('❌').catch(() => null);
    }

    return;
  }

  if (cmd === 'transfer') {
    const sub = args[0]?.toLowerCase();
    if (!['pr', 's', 'gs', 'ls'].includes(sub)) {
      await message.reply({
        embeds: [supportEmbed('Usage', '!transfer pr | s | gs | ls')],
      });
      return;
    }

    const info = getDepartmentInfo(sub);
    if (!info) {
      await message.reply({
        embeds: [supportEmbed('Error', 'Unknown department.')],
      });
      return;
    }

    ticket.department = sub;
    tickets.set(ticket.userId, ticket);

    const newName = `${info.prefix}-${channel.name.split('-').slice(1).join('-') || channel.name}`;
    await channel.setName(newName).catch(() => null);

    const transferEmbed = supportEmbed(
      'Ticket Transferred',
      `This ticket has been transferred to **${info.name}**.`
    );

    await channel.send({
      content: `<@&${info.roleId}> Ticket transferred to your department.`,
      embeds: [transferEmbed],
    });

    return;
  }
}

// Express server for UptimeRobot / Render
const app = express();

app.get('/', (req, res) => {
  res.send('Bot is alive!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Uptime server listening on port ${PORT}`);
});

client.login(TOKEN);
