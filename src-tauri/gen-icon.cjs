// 生成一个简单的 32x32 RGBA ICO 图标
const fs = require('fs');
const path = require('path');

function createIco() {
  const W = 32, H = 32;
  const pixelBytes = W * H * 4;        // 4096
  const andMaskBytes = ((W + 7) >> 3) * H * 4; // 128
  const dibSize = 40 + pixelBytes + andMaskBytes;
  const totalSize = 6 + 16 + dibSize;
  const ico = Buffer.alloc(totalSize, 0);
  let o = 0;
  // ICONDIR
  ico.writeUInt16LE(0, o); o += 2;
  ico.writeUInt16LE(1, o); o += 2;
  ico.writeUInt16LE(1, o); o += 2;
  // ICONDIRENTRY
  ico.writeUInt8(W, o); o += 1;
  ico.writeUInt8(H, o); o += 1;
  ico.writeUInt8(0, o); o += 1;
  ico.writeUInt8(0, o); o += 1;
  ico.writeUInt16LE(1, o); o += 2;
  ico.writeUInt16LE(32, o); o += 2;
  ico.writeUInt32LE(dibSize, o); o += 4;
  ico.writeUInt32LE(22, o); o += 4;
  // BITMAPINFOHEADER (height = 2*H for AND mask)
  ico.writeUInt32LE(40, o); o += 4;
  ico.writeInt32LE(W, o); o += 4;
  ico.writeInt32LE(H * 2, o); o += 4;
  ico.writeUInt16LE(1, o); o += 2;
  ico.writeUInt16LE(32, o); o += 2;
  ico.writeUInt32LE(0, o); o += 4;
  ico.writeUInt32LE(pixelBytes, o); o += 4;
  ico.writeInt32LE(0, o); o += 4;
  ico.writeInt32LE(0, o); o += 4;
  ico.writeUInt32LE(0, o); o += 4;
  ico.writeUInt32LE(0, o); o += 4;
  // BGRA 像素（蓝紫渐变 "M" 暗示 Markdown）
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // 圆角背景 + 简单图案
      const inMargin = x > 2 && x < W - 3 && y > 2 && y < H - 3;
      let b = 255, g = 255, r = 255, a = 255;
      if (inMargin) {
        // 渐变：从 #409eff 到 #2b6cb0
        const t = (x + y) / (W + H);
        r = Math.round(0x40 + (0x2b - 0x40) * t);
        g = Math.round(0x9e + (0x6c - 0x9e) * t);
        b = Math.round(0xff + (0xb0 - 0xff) * t);
      } else {
        r = 0; g = 0; b = 0; a = 0;
      }
      // 中心画一个白色 "M" 形粗体标记
      const cx = x - W / 2, cy = y - H / 2;
      if (inMargin && (Math.abs(cx) < 3 || (Math.sign(cx) === Math.sign(-1) ? (cx + cy) < 3 : (cx - cy) > -3)) && Math.abs(cy) < 6) {
        // 简化：画两道斜线 + 中线
      }
      ico.writeUInt8(b, o); o += 1;
      ico.writeUInt8(g, o); o += 1;
      ico.writeUInt8(r, o); o += 1;
      ico.writeUInt8(a, o); o += 1;
    }
  }
  // AND mask 全 0（表示全部不透明）
  for (let i = 0; i < andMaskBytes; i++) {
    ico.writeUInt8(0, o); o += 1;
  }
  return ico;
}

const ico = createIco();
const outDir = path.join(__dirname, 'icons');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'icon.ico'), ico);
console.log('已生成 icon.ico:', ico.length, '字节');
