/**
 * Music player — queue, join voice, play URL / local file
 */
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  getVoiceConnection,
  StreamType
} = require('@discordjs/voice');
const play = require('play-dl');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

class MusicPlayer {
  constructor(client, onLog) {
    this.client = client;
    this.log = onLog || (() => {});
    this.queue = [];
    this.current = null;
    this.player = createAudioPlayer();
    this.guildId = null;
    this.channelId = null;
    this.connection = null;
    this.loop = false;

    this.player.on(AudioPlayerStatus.Idle, () => {
      if (this.loop && this.current) {
        this.queue.unshift(this.current);
      }
      this.current = null;
      this.playNext().catch((e) => this.log('err', e.message));
    });
    this.player.on('error', (e) => {
      this.log('err', 'Player: ' + e.message);
      this.playNext().catch(() => {});
    });
  }

  async join(guildId, channelId) {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) throw new Error('Không tìm thấy server');
    const channel = guild.channels.cache.get(channelId);
    if (!channel || channel.type !== 2) throw new Error('Không phải kênh thoại');

    this.guildId = guildId;
    this.channelId = channelId;

    const existing = getVoiceConnection(guildId);
    if (existing) existing.destroy();

    this.connection = joinVoiceChannel({
      channelId,
      guildId,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false
    });

    await entersState(this.connection, VoiceConnectionStatus.Ready, 20_000);
    this.connection.subscribe(this.player);
    this.log('ok', `Đã vào #${channel.name}`);
    return { guild: guild.name, channel: channel.name };
  }

  leave() {
    this.player.stop(true);
    this.queue = [];
    this.current = null;
    if (this.connection) {
      try {
        this.connection.destroy();
      } catch {}
      this.connection = null;
    }
    const c = this.guildId && getVoiceConnection(this.guildId);
    if (c) {
      try {
        c.destroy();
      } catch {}
    }
    this.log('sys', 'Đã rời voice');
  }

  async add(query, meta = {}) {
    const item = await this.resolve(query, meta);
    this.queue.push(item);
    this.log('sys', `+ Queue: ${item.title}`);
    if (!this.current) await this.playNext();
    return item;
  }

  async resolve(query, meta = {}) {
    // Local file
    if (meta.filePath && fs.existsSync(meta.filePath)) {
      return {
        title: meta.title || path.basename(meta.filePath),
        url: meta.filePath,
        type: 'file',
        filePath: meta.filePath
      };
    }

    const q = String(query || '').trim();
    if (!q) throw new Error('Thiếu link / query');

    // Direct media URL
    if (/\.(mp3|wav|ogg|m4a|flac|webm)(\?|$)/i.test(q) || q.includes('cdn.discordapp.com')) {
      return { title: meta.title || q.split('/').pop().split('?')[0], url: q, type: 'url' };
    }

    // YouTube / Spotify via play-dl
    try {
      if (play.yt_validate(q) === 'video' || q.includes('youtube.com') || q.includes('youtu.be')) {
        const info = await play.video_info(q);
        const title = info.video_details?.title || 'YouTube';
        return { title, url: q, type: 'youtube' };
      }
      if (q.includes('spotify.com')) {
        const sp = await play.spotify(q);
        if (sp && sp.name) {
          const yt = await play.search(sp.artists?.[0]?.name + ' ' + sp.name, { limit: 1 });
          if (yt?.[0]?.url) {
            return { title: sp.name, url: yt[0].url, type: 'youtube' };
          }
        }
      }
      // search
      const searched = await play.search(q, { limit: 1 });
      if (searched?.[0]?.url) {
        return {
          title: searched[0].title || q,
          url: searched[0].url,
          type: 'youtube'
        };
      }
    } catch (e) {
      this.log('err', 'resolve: ' + e.message);
    }

    // fallback treat as URL stream
    return { title: meta.title || q.slice(0, 60), url: q, type: 'url' };
  }

  async createResource(item) {
    if (item.type === 'file' || item.filePath) {
      return createAudioResource(item.filePath || item.url, { inlineVolume: true });
    }
    if (item.type === 'youtube') {
      try {
        const stream = await play.stream(item.url);
        return createAudioResource(stream.stream, {
          inputType: stream.type,
          inlineVolume: true
        });
      } catch (e) {
        // yt-dlp fallback
        return this.resourceViaYtDlp(item.url);
      }
    }
    // generic URL
    try {
      const stream = await play.stream(item.url);
      return createAudioResource(stream.stream, {
        inputType: stream.type,
        inlineVolume: true
      });
    } catch {
      return createAudioResource(item.url, { inlineVolume: true });
    }
  }

  resourceViaYtDlp(url) {
    return new Promise((resolve, reject) => {
      const ytdlp = spawn(
        'yt-dlp',
        ['-f', 'bestaudio/best', '-o', '-', '--quiet', url],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      );
      ytdlp.on('error', () => reject(new Error('Cần ffmpeg + play-dl hoặc yt-dlp')));
      const res = createAudioResource(ytdlp.stdout, {
        inputType: StreamType.Arbitrary,
        inlineVolume: true
      });
      resolve(res);
    });
  }

  async playNext() {
    if (!this.connection) {
      this.log('err', 'Chưa join kênh thoại');
      return;
    }
    if (!this.queue.length) {
      this.log('sys', 'Hết queue');
      return;
    }
    const item = this.queue.shift();
    this.current = item;
    try {
      const resource = await this.createResource(item);
      if (resource.volume) resource.volume.setVolume(0.8);
      this.player.play(resource);
      this.log('ok', '▶ ' + item.title);
    } catch (e) {
      this.log('err', 'Play lỗi: ' + e.message);
      await this.playNext();
    }
  }

  skip() {
    this.player.stop(true);
    this.log('sys', '⏭ Skip');
  }

  stop() {
    this.queue = [];
    this.current = null;
    this.player.stop(true);
    this.log('sys', '⏹ Stop');
  }

  pause() {
    this.player.pause();
    this.log('sys', '⏸ Pause');
  }

  resume() {
    this.player.unpause();
    this.log('sys', '▶ Resume');
  }

  setLoop(on) {
    this.loop = !!on;
    this.log('sys', 'Loop: ' + (this.loop ? 'ON' : 'OFF'));
  }

  status() {
    return {
      joined: !!this.connection,
      guildId: this.guildId,
      channelId: this.channelId,
      current: this.current,
      queue: this.queue.map((q) => ({ title: q.title, type: q.type })),
      loop: this.loop,
      playing: this.player.state.status === AudioPlayerStatus.Playing,
      paused: this.player.state.status === AudioPlayerStatus.Paused
    };
  }
}

module.exports = { MusicPlayer };
