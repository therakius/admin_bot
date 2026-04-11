// controllers/messageController.js

const PREFIX = ".";
const BOT_OWNER = process.env.BOT_OWNER_NUMBER;

// ==================== COMMANDS ====================
const COMMANDS = {
  kick: { desc: "Remove a member", usage: ".kick", adminOnly: true },
  mute: { desc: "Silence the group", usage: ".mute", adminOnly: true },
  unmute: { desc: "Open the group", usage: ".unmute", adminOnly: true },
  promote: { desc: "Promote a member", usage: ".promote", adminOnly: true },
  demote: { desc: "Demote an admin", usage: ".demote", adminOnly: true },
  info: { desc: "Show group information", usage: ".info" },
  help: { desc: "Show this menu", usage: ".help" },
};

// ==================== UTILS ====================

// normaliza qualquer JID para só o número
const extractNumber = (jid) => {
  if (!jid) return null;
  return jid.split("@")[0].split(":")[0];
};

// compara dois JIDs independentemente do formato (@lid, @s.whatsapp.net, com/sem :device)
const sameUser = (a, b) => {
  if (!a || !b) return false;
  return extractNumber(a) === extractNumber(b);
};

// encontra um participante pelo número, independente do formato do JID
const findParticipant = (participants, jid) => {
  const num = extractNumber(jid);
  return participants.find((p) => extractNumber(p.id) === num) || null;
};

// ==================== MAIN HANDLER ====================
export async function handleMessage(sock, message) {
  try {
    if (message.key.fromMe) return;
    if (message.key.remoteJid === "status@broadcast") return;

    const jid = message.key.remoteJid;
    if (!jid?.endsWith("@g.us")) return;

    const msg = message.message;
    const text =
      msg?.conversation ||
      msg?.extendedTextMessage?.text ||
      msg?.imageMessage?.caption ||
      msg?.videoMessage?.caption ||
      "";

    if (!text.startsWith(PREFIX)) return;

    const [rawCmd] = text.slice(PREFIX.length).trim().split(/\s+/);
    const cmd = rawCmd.toLowerCase();

    if (!COMMANDS[cmd]) return;

    console.log(
      `\n📨 Command received: "${cmd}" | from: ${message.key.participant} | group: ${jid}`,
    );

    // ================= GROUP METADATA =================
    let groupMeta;
    try {
      groupMeta = await sock.groupMetadata(jid);
      console.log(
        `📋 Group: "${groupMeta.subject}" | participants: ${groupMeta.participants.length}`,
      );
    } catch (err) {
      console.error("❌ Metadata error:", err);
      return;
    }

    const participants = groupMeta.participants;

    // ================= IDS =================
    const senderId = message.key.participant;
    const botRawId = sock.user?.id;

    console.log(`🤖 sock.user.id raw: ${botRawId}`);
    console.log(`👤 senderId: ${senderId}`);
    console.log(`👑 BOT_OWNER env: ${BOT_OWNER}`);
    console.log(
      `📌 All participants:`,
      participants.map((p) => `${p.id} (admin: ${p.admin})`),
    );

    // ================= LOCATE BOT IN PARTICIPANTS =================
    // grupos novos usam @lid, grupos antigos usam @s.whatsapp.net
    // findParticipant normaliza pelo número para cobrir ambos
    // depois
    const botLid = sock.user?.lid;

    console.log(`🤖 sock.user.id raw: ${botRawId}`);
    console.log(`🤖 sock.user.lid: ${botLid}`);
    console.log(`👤 senderId: ${senderId}`);
    console.log(`👑 BOT_OWNER env: ${BOT_OWNER}`);
    console.log(
      `📌 All participants:`,
      participants.map((p) => `${p.id} (admin: ${p.admin})`),
    );

    // tenta por @lid primeiro, fallback para número
    const botParticipant =
      (botLid ? findParticipant(participants, botLid) : null) ||
      findParticipant(participants, botRawId);

    console.log(`🤖 botParticipant found:`, botParticipant ?? "NOT FOUND");

    if (!botParticipant) {
      console.warn(
        "⚠️ Bot not found in participants list — cannot determine bot role.",
      );
    }

    const botJid = botParticipant?.id || null;
    const isBotAdmin = botParticipant?.admin != null; // 'admin' | 'superadmin' | null

    // ================= SENDER ROLE =================
    const senderParticipant = findParticipant(participants, senderId);
    const isAdmin = senderParticipant?.admin != null;
    const isOwner =
    sameUser(senderId, process.env.BOT_OWNER_NUMBER) ||
    sameUser(senderId, process.env.BOT_OWNER_LID);

    console.log(
      `🔐 isAdmin: ${isAdmin} | isBotAdmin: ${isBotAdmin} | isOwner: ${isOwner}`,
    );

    // ================= PERMISSION CHECK =================
    if (COMMANDS[cmd].adminOnly && !isAdmin && !isOwner) {
      console.log(`🚫 Permission denied for "${cmd}"`);
      return sock.sendMessage(jid, {
        text: "❌ Only admins or bot owner can use this command.",
      });
    }

    // ================= TARGET RESOLUTION =================
    const context = msg?.extendedTextMessage?.contextInfo || {};
    const quoted = context.participant || null;
    const mentioned = context.mentionedJid || [];
    const target = quoted || mentioned[0] || null;

    console.log(
      `🎯 Target resolved: ${target ?? "none"} | quoted: ${quoted} | mentioned: ${mentioned}`,
    );

    // ================= ROUTER =================
    const handlers = {
      kick: () =>
        handleKick(
          sock,
          jid,
          target,
          participants,
          isBotAdmin,
          isOwner,
          botJid,
        ),
      mute: () => handleMute(sock, jid, isBotAdmin, true, isOwner),
      unmute: () => handleMute(sock, jid, isBotAdmin, false, isOwner),
      promote: () =>
        handleRole(
          sock,
          jid,
          target,
          participants,
          isBotAdmin,
          "promote",
          isOwner,
          botJid,
        ),
      demote: () =>
        handleRole(
          sock,
          jid,
          target,
          participants,
          isBotAdmin,
          "demote",
          isOwner,
          botJid,
        ),
      info: () => handleInfo(sock, jid, groupMeta),
      help: () => handleHelp(sock, jid, isAdmin || isOwner),
    };

    await handlers[cmd]();
  } catch (err) {
    console.error("🔥 Fatal error in handleMessage:", err);
  }
}

// ==================== HANDLERS ====================

// ===== KICK =====
async function handleKick(
  sock,
  jid,
  target,
  participants,
  isBotAdmin,
  isOwner,
  botJid,
) {
  console.log(
    `\n⚙️  handleKick | target: ${target} | isBotAdmin: ${isBotAdmin} | isOwner: ${isOwner}`,
  );

  if (!target) {
    return sock.sendMessage(jid, { text: "⚠️ Reply or @mention a user." });
  }

  if (!isBotAdmin && !isOwner) {
    console.log("🚫 Bot is not admin — cannot kick");
    return sock.sendMessage(jid, { text: "⚠️ I need admin rights." });
  }

  if (sameUser(target, botJid)) {
    return sock.sendMessage(jid, { text: "⚠️ I cannot remove myself." });
  }

  const targetParticipant = findParticipant(participants, target);
  const isTargetAdmin = targetParticipant?.admin != null;

  console.log(
    `🎯 target participant:`,
    targetParticipant ?? "NOT FOUND",
    `| isTargetAdmin: ${isTargetAdmin}`,
  );

  if (isTargetAdmin && !isOwner) {
    return sock.sendMessage(jid, { text: "❌ Cannot remove an admin." });
  }

  try {
    // usa o JID exato do participante encontrado (respeita @lid vs @s.whatsapp.net)
    const targetJid = targetParticipant?.id || target;
    await sock.groupParticipantsUpdate(jid, [targetJid], "remove");
    console.log(`✅ Kicked: ${targetJid}`);
    await sock.sendMessage(jid, { text: "✅ Member removed." });
  } catch (err) {
    console.error("❌ Kick error:", err);
    await sock.sendMessage(jid, { text: "❌ Failed to remove member." });
  }
}

// ===== MUTE / UNMUTE =====
async function handleMute(sock, jid, isBotAdmin, mute, isOwner) {
  console.log(
    `\n⚙️  handleMute | mute: ${mute} | isBotAdmin: ${isBotAdmin} | isOwner: ${isOwner}`,
  );

  if (!isBotAdmin && !isOwner) {
    console.log("🚫 Bot is not admin — cannot mute");
    return sock.sendMessage(jid, { text: "⚠️ I need admin rights." });
  }

  try {
    await sock.groupSettingUpdate(
      jid,
      mute ? "announcement" : "not_announcement",
    );
    console.log(`✅ Group ${mute ? "muted" : "unmuted"}`);
    await sock.sendMessage(jid, {
      text: mute ? "🔇 Group silenced." : "🔊 Group opened.",
    });
  } catch (err) {
    console.error("❌ Mute error:", err);
    await sock.sendMessage(jid, { text: "❌ Failed to change setting." });
  }
}

// ===== PROMOTE / DEMOTE =====
async function handleRole(
  sock,
  jid,
  target,
  participants,
  isBotAdmin,
  action,
  isOwner,
  botJid,
) {
  console.log(
    `\n⚙️  handleRole | action: ${action} | target: ${target} | isBotAdmin: ${isBotAdmin}`,
  );

  if (!target) {
    return sock.sendMessage(jid, { text: "⚠️ Reply or @mention a user." });
  }

  if (!isBotAdmin && !isOwner) {
    console.log("🚫 Bot is not admin — cannot change roles");
    return sock.sendMessage(jid, { text: "⚠️ I need admin rights." });
  }

  if (sameUser(target, botJid)) {
    return sock.sendMessage(jid, { text: "⚠️ I cannot change my own role." });
  }

  try {
    const targetParticipant = findParticipant(participants, target);
    const targetJid = targetParticipant?.id || target;
    await sock.groupParticipantsUpdate(jid, [targetJid], action);
    console.log(`✅ ${action}: ${targetJid}`);
    await sock.sendMessage(jid, {
      text:
        action === "promote"
          ? "✅ Promoted to admin."
          : "✅ Demoted to member.",
    });
  } catch (err) {
    console.error(`❌ Role error (${action}):`, err);
    await sock.sendMessage(jid, { text: "❌ Failed to change role." });
  }
}

// ===== INFO =====
async function handleInfo(sock, jid, groupMeta) {
  console.log(`\n⚙️  handleInfo | group: ${groupMeta.subject}`);

  const adminParticipants = groupMeta.participants.filter((p) => p.admin);
  const admins = adminParticipants
    .map((p) => `• @${extractNumber(p.id)}`)
    .join("\n");

  const text = [
    `📋 *${groupMeta.subject}*`,
    ``,
    `👥 Members: ${groupMeta.participants.length}`,
    `🛡️ Admins:\n${admins}`,
    `📅 Created: ${new Date(groupMeta.creation * 1000).toLocaleDateString()}`,
    groupMeta.desc ? `\n📝 ${groupMeta.desc}` : "",
  ].join("\n");

  const mentions = adminParticipants.map((p) => p.id);
  await sock.sendMessage(jid, { text, mentions });
}

// ===== HELP =====
async function handleHelp(sock, jid, isPrivileged) {
  console.log(`\n⚙️  handleHelp | isPrivileged: ${isPrivileged}`);

  const lines = Object.entries(COMMANDS)
    .filter(([, meta]) => !meta.adminOnly || isPrivileged)
    .map(([, meta]) => `${meta.usage} — ${meta.desc}`);

  await sock.sendMessage(jid, {
    text: `🤖 *Commands:*\n\n${lines.join("\n")}`,
  });
}
