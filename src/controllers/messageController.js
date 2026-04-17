// controllers/messageController.js
import { generateTriviaQuestion, explainTopic } from "../integrations/groq.js";

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
  warn: {desc: "Warns a specific member", usage: ".warn", adminOnly: true},
  trivia: {desc: "Generates a trivia question and options with the answers. The first user to choose the correct option wins. trivia only resets after 60s", usage: ".trivia"},
  explain: {desc: "Explain a topic using AI", usage: ".explain <topic>"}
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

    // Check for trivia answers (before prefix check)
    checkTriviaAnswer(sock, message);

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
          message
        ),
      mute: () => handleMute(sock, jid, isBotAdmin, true, isOwner, message),
      unmute: () => handleMute(sock, jid, isBotAdmin, false, isOwner, message),
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
          message
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
          message
        ),
      info: () => handleInfo(sock, jid, groupMeta, message),
      help: () => handleHelp(sock, jid, isAdmin || isOwner, message),
      warn: ()=> handleWarn(sock, jid, target, participants, isBotAdmin, "warn", isOwner, botJid, message),
      trivia: () => handleTrivia(sock, jid, message),
      explain: () => handleExplain(sock, jid, message)
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
  botJid, message
) {
  console.log(
    `\n⚙️  handleKick | target: ${target} | isBotAdmin: ${isBotAdmin} | isOwner: ${isOwner}`,
  );

  if (!target) {
    return sock.sendMessage(jid, { text: "⚠️ Reply or @mention a user." }, {quoted : message});
  }

  if (!isBotAdmin && !isOwner) {
    console.log("🚫 Bot is not admin — cannot kick");
    return sock.sendMessage(jid, { text: "⚠️ I need admin rights." }, {quoted : message});
  }

  if (sameUser(target, botJid)) {
    return sock.sendMessage(jid, { text: "⚠️ I cannot remove myself." }, {quoted : message});
  }

  const targetParticipant = findParticipant(participants, target);
  const isTargetAdmin = targetParticipant?.admin != null;

  console.log(
    `🎯 target participant:`,
    targetParticipant ?? "NOT FOUND",
    `| isTargetAdmin: ${isTargetAdmin}`,
  );

  if (isTargetAdmin && !isOwner) {
    return sock.sendMessage(jid, { text: "❌ Cannot remove an admin." }, {quoted : message});
  }

  try {
    // usa o JID exato do participante encontrado (respeita @lid vs @s.whatsapp.net)
    const targetJid = targetParticipant?.id || target;
    await sock.groupParticipantsUpdate(jid, [targetJid], "remove");
    console.log(`✅ Kicked: ${targetJid}`);
    await sock.sendMessage(jid, { text: "✅ Member removed." }, {quoted : message});
  } catch (err) {
    console.error("❌ Kick error:", err);
    await sock.sendMessage(jid, { text: "❌ Failed to remove member." }, {quoted : message});
  }
}

// ===== MUTE / UNMUTE =====
async function handleMute(sock, jid, isBotAdmin, mute, isOwner, message) {
  console.log(
    `\n⚙️  handleMute | mute: ${mute} | isBotAdmin: ${isBotAdmin} | isOwner: ${isOwner}`,
  );

  if (!isBotAdmin && !isOwner) {
    console.log("🚫 Bot is not admin — cannot mute");
    return sock.sendMessage(jid, { text: "⚠️ I need admin rights." }, {quoted : message});
  }

  try {
    await sock.groupSettingUpdate(
      jid,
      mute ? "announcement" : "not_announcement",
    );
    console.log(`✅ Group ${mute ? "muted" : "unmuted"}`);
    await sock.sendMessage(jid, {
      text: mute ? "🔇 Group silenced." : "🔊 Group opened.",
    }, {quoted : message});
  } catch (err) {
    console.error("❌ Mute error:", err);
    await sock.sendMessage(jid, { text: "❌ Failed to change setting." }, {quoted : message});
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
  message
) {
  console.log(
    `\n⚙️  handleRole | action: ${action} | target: ${target} | isBotAdmin: ${isBotAdmin}`,
  );

  if (!target) {
    return sock.sendMessage(jid, { text: "⚠️ Reply or @mention a user." }, {quoted : message});
  }

  if (!isBotAdmin && !isOwner) {
    console.log("🚫 Bot is not admin — cannot change roles");
    return sock.sendMessage(jid, { text: "⚠️ I need admin rights." }, {quoted : message});
  }

  if (sameUser(target, botJid)) {
    return sock.sendMessage(jid, { text: "⚠️ I cannot change my own role." }, {quoted : message});
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
    }, {quoted: message});
  } catch (err) {
    console.error(`❌ Role error (${action}):`, err);
    await sock.sendMessage(jid, { text: "❌ Failed to change role." }, {quoted : message});
  }
}

// ===== INFO =====
async function handleInfo(sock, jid, groupMeta, message) {
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
  await sock.sendMessage(jid, { text, mentions }, {quoted : message});
}

// ===== HELP =====
async function handleHelp(sock, jid, isPrivileged, message) {
  console.log(`\n⚙️  handleHelp | isPrivileged: ${isPrivileged}`);

  const lines = Object.entries(COMMANDS)
    .filter(([, meta]) => !meta.adminOnly || isPrivileged)
    .map(([, meta]) => `${meta.usage} — ${meta.desc}`);

  await sock.sendMessage(jid, {
    text: `🤖 *Commands:*\n\n${lines.join("\n")}`,
  }, {quoted : message});
}

// ===== WARN =====
async function handleWarn(
  sock,
  jid,
  target,
  participants,
  isBotAdmin,
  action,
  isOwner,
  botJid,
  message
) {
  console.log(
    `\n⚙️  handleWarn | target: ${target} | isBotAdmin: ${isBotAdmin} | isOwner: ${isOwner}`,
  );

  if (!target) {
    return sock.sendMessage(jid, { text: "⚠️ Reply or @mention a user to warn." }, {quoted : message});
  }

  if (sameUser(target, botJid)) {
    return sock.sendMessage(jid, { text: "⚠️ I cannot warn myself." }, {quoted : message});
  }

  const targetParticipant = findParticipant(participants, target);

  if (!targetParticipant) {
    console.log("🎯 Target participant not found");
    return sock.sendMessage(jid, { text: "⚠️ User not found in the group." }, {quoted : message});
  }

  try {
    const targetNumber = extractNumber(targetParticipant.id);
    const warningText = `⚠️ @${targetNumber}, Please behave yourself or you'll be removed. 🙂`;

    await sock.sendMessage(jid, {
      text: warningText,
      mentions: [targetParticipant.id],
    }, {quoted : message});

    console.log(`✅ Warned: ${targetParticipant.id}`);
  } catch (err) {
    console.error("❌ Warn error:", err);
    await sock.sendMessage(jid, { text: "❌ Failed to send warning." }, {quoted : message});
  }
}


// ===== TRIVIA STATE =====
const triviaState = new Map();

// ===== TRIVIA ANSWER LISTENER =====
export function checkTriviaAnswer(sock, message) {
  const jid = message.key.remoteJid;
  if (!jid?.endsWith("@g.us")) return;
  if (message.key.fromMe) return;

  const state = triviaState.get(jid);
  if (!state?.active) return;

  const msg = message.message;
  const text = (
    msg?.conversation ||
    msg?.extendedTextMessage?.text ||
    ""
  ).trim().toUpperCase();

  if (!["A", "B", "C", "D"].includes(text)) return;

  if (text === state.answer) {
    triviaState.set(jid, { ...state, active: false });

    const senderId = message.key.participant;
    const number = extractNumber(senderId);

    sock.sendMessage(jid, {
      text: `🎉 *@${number} got it right!*\n✅ The answer was *${state.answer}*: ${state.options[state.answer]}`,
      mentions: [senderId],
    });

    console.log(`✅ Trivia answered correctly by ${senderId} in ${jid}`);
  }
}

/// ===== TRIVIA HANDLER =====
async function handleTrivia(sock, jid, message) {
  console.log(`\n⚙️  handleTrivia | jid: ${jid}`);

  const state = triviaState.get(jid) || {};
  const COOLDOWN = 10_000;

  if (state.lastUsed && Date.now() - state.lastUsed < COOLDOWN) {
    const secsLeft = Math.ceil((COOLDOWN - (Date.now() - state.lastUsed)) / 1000);
    return sock.sendMessage(jid, {
      text: `⏳ Wait *${secsLeft}s* before starting a new trivia.`,
    });
  }

  triviaState.set(jid, { ...state, lastUsed: Date.now(), active: false });

  let triviaData;
  try {
    await sock.sendMessage(jid, { text: "🎲 Generating a trivia question..." });
    triviaData = await generateTriviaQuestion();
    
  } catch (err) {
    console.error("❌ Trivia generation error:", err);
    return sock.sendMessage(jid, {
      text: "❌ Failed to generate trivia question. Try again.",
    });
  }

  console.log(`🎯 Trivia data:`, triviaData);
  if (!triviaData?.question || !triviaData?.options?.A || !triviaData?.answer) {
    return sock.sendMessage(jid, {
      text: "❌ Invalid trivia response. Try again.",
    });
  }

  const { question, options, answer } = triviaData;

  triviaState.set(jid, {
    active: true,
    question,
    options,
    answer: answer.toUpperCase().trim(),
    lastUsed: Date.now(),
  });

  const text = [
    `🧠 *TRIVIA TIME!*`,
    ``,
    `❓ ${question}`,
    ``,
    `🅰️ ${options.A}`,
    `🅱️ ${options.B}`,
    `🅲 ${options.C}`,
    `🅳 ${options.D}`,
    ``,
    `💬 Reply with A, B, C or D!`,
  ].join("\n");

  await sock.sendMessage(jid, { text }, {quoted : message});
  console.log(`✅ Trivia started in ${jid} | Answer: ${answer}`);
}


async function handleExplain(sock, jid, message) {
  console.log(`\n⚙️  handleExplain | jid: ${jid}`);

  try {
    // Extract the full message text
    const messageText = message.message?.extendedTextMessage?.text || message.message?.conversation || "";
    
    // Extract topic by removing the ".explain " prefix
    const topic = messageText.replace(/^\.explain\s+/i, "").trim();

    // Validate topic was provided
    if (!topic) {
      return sock.sendMessage(jid, { 
        text: "❌ Please provide a topic to explain.\n\n📝 *Usage:* `.explain quantum physics`" 
      }, { quoted: message });
    }

    // Send loading message
    await sock.sendMessage(jid, { text: "🔍 Let me think about that..." }, { quoted: message });

    // Get explanation from AI
    console.log(`📚 Explaining: ${topic}`);
    const explanation = await explainTopic(topic);

    // Send the explanation
    const responseText = `📚 *Explanation: ${topic}*\n\n${explanation}`;
    await sock.sendMessage(jid, { text: responseText }, { quoted: message });
    
    console.log(`✅ Explanation sent for: ${topic}`);
  } catch (error) {
    console.error("❌ Error in handleExplain:", error);
    await sock.sendMessage(jid, { 
      text: "❌ Failed to generate explanation. Please try again." 
    }, { quoted: message });
  }
}