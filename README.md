# Music Bot Panel

Bot Discord **chỉ phát nhạc** — panel web chọn kênh thoại, dán link hoặc tải file.

## Chạy

```bash
cd music-bot
npm install
npm start
```

http://localhost:3000

### Hệ thống

- **FFmpeg** cần có trong PATH (phát audio)
- Node.js ≥ 18

```bash
# Ubuntu/Debian
sudo apt install ffmpeg
```

## Discord

1. Tạo bot, copy token  
2. Intent: **Server Members** (tuỳ), **Message Content**, voice hoạt động qua Guild Voice States  
3. Mời bot với quyền **Connect**, **Speak**, **Use Voice Activity**  
4. Panel: Start → chọn server → bấm kênh thoại → **Join** → Play link / file  

## Lệnh trong Discord

| Lệnh | Mô tả |
|------|--------|
| `!join` | Vào voice của bạn |
| `!play <link\|tên>` | Phát / thêm queue |
| `!skip` | Bỏ bài |
| `!stop` | Dừng + xóa queue |
| `!leave` | Rời voice |
| `!queue` | Xem hàng đợi |
| `!help` | Help |

## Panel

- Menu **danh sách kênh thoại** theo server  
- Dán YouTube / URL audio  
- Upload mp3/wav/ogg/m4a  
- Pause · Resume · Skip · Stop · Loop  
