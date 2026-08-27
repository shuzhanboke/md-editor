// 生成专业 MD 编辑器图标：圆角蓝底 + 白色 Markdown "M" 标记
const fs = require("fs");
const path = require("path");

const W = 64, H = 64;
const pixelBytes = W * H * 4;
const andMaskBytes = ((W + 31) >> 3) * H * 4; // 对齐到 4 字节
const dibSize = 40 + pixelBytes + andMaskBytes;
const totalSize = 6 + 16 + dibSize;
const buf = Buffer.alloc(totalSize, 0);
let o = 0;

// ICONDIR
buf.writeUInt16LE(0, o); o += 2;
buf.writeUInt16LE(1, o); o += 2;
buf.writeUInt16LE(1, o); o += 2;
// ICONDIRENTRY
buf.writeUInt8(W, o); o += 1;
buf.writeUInt8(H, o); o += 1;
buf.writeUInt8(0, o); o += 1;
buf.writeUInt8(0, o); o += 1;
buf.writeUInt16LE(1, o); o += 2;
buf.writeUInt16LE(32, o); o += 2;
buf.writeUInt32LE(dibSize, o); o += 4;
buf.writeUInt32LE(22, o); o += 4;
// BITMAPINFOHEADER
buf.writeUInt32LE(40, o); o += 4;
buf.writeInt32LE(W, o); o += 4;
buf.writeInt32LE(H * 2, o); o += 4;
buf.writeUInt16LE(1, o); o += 2;
buf.writeUInt16LE(32, o); o += 2;
buf.writeUInt32LE(0, o); o += 4;
buf.writeUInt32LE(pixelBytes, o); o += 4;
buf.writeInt32LE(0, o); o += 4;
buf.writeInt32LE(0, o); o += 4;
buf.writeUInt32LE(0, o); o += 4;
buf.writeUInt32LE(0, o); o += 4;

// BGRA 像素（从下到上）
const bg = [0x42, 0x9e, 0xff, 255];     // #409eff 蓝底
const white = [255, 255, 255, 255];
const transparent = [0, 0, 0, 0];

// 用函数判断点是否在圆角矩形内
function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  if (x >= x0 + r && x <= x1 - r) return true;
  if (y >= y0 + r && y <= y1 - r) return true;
  const cx = x < x0 + r ? x0 + r : x1 - r;
  const cy = y < y0 + r ? y0 + r : y1 - r;
  return (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r;
}

// 判断点是否在 "M" 字母笔画上（简化：两斜线 + 中间V）
function inLetterM(x, y) {
  // M 范围 x: 16~48, y: 16~48
  if (x < 16 || x > 48 || y < 18 || y > 48) return false;
  const mx = x - 16, my = y - 16; // 归一化 0~32
  // 外侧左竖线
  if (mx >= 0 && mx <= 4 && my >= 2 && my <= 32) return true;
  // 外侧右竖线
  if (mx >= 28 && mx <= 32 && my >= 2 && my <= 32) return true;
  // 左斜线（从顶部到中间）
  if (my >= 2 && my <= 18) {
    const leftEdge = (my - 2) * 14 / 16; // 0 到 ~14
    if (mx >= leftEdge - 1 && mx <= leftEdge + 3) return true;
  }
  // 右斜线
  if (my >= 2 && my <= 18) {
    const rightEdge = 32 - (my - 2) * 14 / 16;
    if (mx >= rightEdge - 3 && mx <= rightEdge + 1) return true;
  }
  return false;
}

for (let y = H - 1; y >= 0; y--) {
  for (let x = 0; x < W; x++) {
    let px;
    const inBg = inRoundRect(x, y, 3, 3, 60, 60, 12);
    if (!inBg) {
      px = transparent;
    } else if (inLetterM(x, y)) {
      px = white;
    } else {
      // 渐变：从 #409eff 到 #2b6cb0
      const t = (x + y) / (W + H);
      px = [
        Math.round(0xff + (0xb0 - 0xff) * t), // B
        Math.round(0x9e + (0x6c - 0x9e) * t), // G
        Math.round(0x40 + (0x2b - 0x40) * t), // R
        255, // A
      ];
    }
    buf.writeUInt8(px[0], o); o += 1;
    buf.writeUInt8(px[1], o); o += 1;
    buf.writeUInt8(px[2], o); o += 1;
    buf.writeUInt8(px[3], o); o += 1;
  }
}
// AND mask 全 0
for (let i = 0; i < andMaskBytes; i++) { buf.writeUInt8(0, o); o += 1; }

const outDir = path.join(__dirname, "icons");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "icon.ico"), buf);
console.log("图标已生成:", buf.length, "字节");
