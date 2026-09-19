/**
 * Music Bot Panel
 * npm install && npm start → http://localhost:3000
 * Cần: Node 18+, FFmpeg trong PATH (để phát ổn định)
 */

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const {
  Client,
  GatewayIntentBits,
  ChannelType,
  ActivityType
} = require('discord.js');
const { MusicPlayer } = require('./bot/player');

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOAD = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD)) fs.mkdirSync(UPLOAD, { recursive: true });

app.use(cors());
app.use(bodyParser.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const storage = multer.diskStorage({
  destination: UPLOAD,
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\-() ]+/g, '_');
    cb(null, Date.now() + '-' + safe);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/\.(mp3|wav|ogg|m4a|flac|webm)$/i.test(file.originalname)) cb(null, true);
    else cb(new Error('Chỉ nhận file audio'));
  }
});

let client = null;
let player = null;
let botInfo = null;
const logs = [];
const sse = new Set();

function push(type, text) {
  const e = { type, text: String(text), time: Date.now() };
  logs.push(e);
  if (logs.length > 300) logs.shift();
  const line = `data: ${JSON.stringify(e)}\n\n`;
  for (const r of sse) {
    try {
      r.write(line);
    } catch {}
  }
}

function destroy() {
  if (player) {
    try {
      player.leave();
    } catch {}
    player = null;
  }
  if (client) {
    try {
      client.destroy();
    } catch {}
    client = null;
  }
  botInfo = null;
}

async function startBot(token) {
  destroy();
  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ]
  });

  player = new MusicPlayer(client, push);

  client.once('ready', () => {
    botInfo = {
      tag: client.user.tag,
      id: client.user.id,
      avatar: client.user.displayAvatarURL({ size: 128 }),
      guilds: client.guilds.cache.size
    };
    try {
      client.user.setActivity('Music · Panel', { type: ActivityType.Listening });
    } catch {}
    push('ok', 'Online: ' + client.user.tag);
  });

  // Prefix commands in Discord too
  client.on('messageCreate', async (msg) => {
    if (msg.author.bot || !msg.guild) return;
    if (!msg.content.startsWith('!')) return;
    const [cmd, ...args] = msg.content.slice(1).trim().split(/\s+/);
    const c = (cmd || '').toLowerCase();
    try {
      if (c === 'join') {
        const ch = msg.member?.voice?.channel;
        if (!ch) return msg.reply('Vào kênh thoại trước');
        await player.join(msg.guild.id, ch.id);
        msg.reply('Đã join **' + ch.name + '**');
      } else if (c === 'play') {
        const q = args.join(' ');
        if (!q) return msg.reply('`!play <link|tên bài>`');
        if (!player.connection) {
          const ch = msg.member?.voice?.channel;
          if (!ch) return msg.reply('Vào voice hoặc Join từ panel');
          await player.join(msg.guild.id, ch.id);
        }
        const item = await player.add(q);
        msg.reply('Đã thêm: **' + item.title + '**');
      } else if (c === 'skip') {
        player.skip();
        msg.reply('⏭ Skip');
      } else if (c === 'stop') {
        player.stop();
        msg.reply('⏹ Stop');
      } else if (c === 'leave') {
        player.leave();
        msg.reply('Bye');
      } else if (c === 'queue') {
        const st = player.status();
        const lines = [];
        if (st.current) lines.push('▶ ' + st.current.title);
        st.queue.forEach((q, i) => lines.push(i + 1 + '. ' + q.title));
        msg.reply(lines.join('\n') || 'Queue trống');
      } else if (c === 'help') {
        msg.reply('**Music:** `!join` `!play` `!skip` `!stop` `!leave` `!queue`');
      }
    } catch (e) {
      msg.reply('Lỗi: ' + e.message).catch(() => {});
      push('err', e.message);
    }
  });

  await client.login(token);
}

// API
app.get('/api/status', (req, res) => {
  res.json({
    running: !!(client && client.isReady()),
    bot: botInfo,
    player: player ? player.status() : null
  });
});

app.get('/api/logs/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  logs.slice(-40).forEach((e) => res.write(`data: ${JSON.stringify(e)}\n\n`));
  sse.add(res);
  req.on('close', () => sse.delete(res));
});

app.post('/api/start', async (req, res) => {
  const token = (req.body.token || '').trim();
  if (!token || token.length < 50) return res.status(400).json({ error: 'Token không hợp lệ' });
  if (client && client.isReady()) return res.status(400).json({ error: 'Bot đang chạy' });
  push('sys', 'Đang login...');
  try {
    await startBot(token);
    res.json({ success: true });
  } catch (e) {
    destroy();
    push('err', e.message);
    res.status(401).json({ error: e.message });
  }
});

app.post('/api/stop', (req, res) => {
  destroy();
  push('sys', 'Đã stop bot');
  res.json({ success: true });
});

app.get('/api/guilds', (req, res) => {
  if (!client || !client.isReady()) return res.status(400).json({ error: 'Bot offline' });
  const list = client.guilds.cache.map((g) => ({
    id: g.id,
    name: g.name,
    icon: g.iconURL({ size: 64 })
  }));
  res.json(list);
});

app.get('/api/guilds/:id/channels', (req, res) => {
  if (!client || !client.isReady()) return res.status(400).json({ error: 'Bot offline' });
  const g = client.guilds.cache.get(req.params.id);
  if (!g) return res.status(404).json({ error: 'Không có server' });
  const voice = g.channels.cache
    .filter((c) => c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice)
    .sort((a, b) => a.rawPosition - b.rawPosition)
    .map((c) => ({
      id: c.id,
      name: c.name,
      members: c.members?.cache?.size || 0,
      type: c.type === ChannelType.GuildStageVoice ? 'stage' : 'voice'
    }));
  res.json(voice);
});

app.post('/api/join', async (req, res) => {
  try {
    if (!player) return res.status(400).json({ error: 'Bot offline' });
    const { guildId, channelId } = req.body;
    const info = await player.join(guildId, channelId);
    res.json({ success: true, ...info });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/leave', (req, res) => {
  if (!player) return res.status(400).json({ error: 'Bot offline' });
  player.leave();
  res.json({ success: true });
});

app.post('/api/play', async (req, res) => {
  try {
    if (!player) return res.status(400).json({ error: 'Bot offline' });
    const q = (req.body.query || req.body.url || '').trim();
    if (!q) return res.status(400).json({ error: 'Nhập link hoặc tên bài' });
    if (!player.connection) return res.status(400).json({ error: 'Chọn kênh thoại và Join trước' });
    const item = await player.add(q);
    res.json({ success: true, item });
  } catch (e) {
    push('err', e.message);
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/play-file', upload.single('file'), async (req, res) => {
  try {
    if (!player) return res.status(400).json({ error: 'Bot offline' });
    if (!req.file) return res.status(400).json({ error: 'Chưa chọn file' });
    if (!player.connection) return res.status(400).json({ error: 'Join kênh thoại trước' });
    const item = await player.add(req.file.path, {
      filePath: req.file.path,
      title: req.file.originalname
    });
    res.json({ success: true, item });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/skip', (req, res) => {
  if (!player) return res.status(400).json({ error: 'Offline' });
  player.skip();
  res.json({ success: true });
});
app.post('/api/stop-music', (req, res) => {
  if (!player) return res.status(400).json({ error: 'Offline' });
  player.stop();
  res.json({ success: true });
});
app.post('/api/pause', (req, res) => {
  if (!player) return res.status(400).json({ error: 'Offline' });
  player.pause();
  res.json({ success: true });
});
app.post('/api/resume', (req, res) => {
  if (!player) return res.status(400).json({ error: 'Offline' });
  player.resume();
  res.json({ success: true });
});
app.post('/api/loop', (req, res) => {
  if (!player) return res.status(400).json({ error: 'Offline' });
  player.setLoop(!!req.body.on);
  res.json({ success: true, loop: player.loop });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🎵 Music Bot Panel → http://localhost:${PORT}\n`);
});
