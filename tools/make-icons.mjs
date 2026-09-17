#!/usr/bin/env node
/**
 * 生成扩展图标（纯 Node 内置模块，零依赖）。
 *
 * 用法：node tools/make-icons.mjs
 * 产物：icons/16.png icons/32.png icons/48.png icons/128.png
 *
 * 图形：ChatGPT 绿圆角方块 + 白色对话气泡。
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'icons');
const SIZES = [16, 32, 48, 128];
const SS = 3; // 每像素 3x3 超采样，得到平滑边缘

const GREEN = [16, 163, 127];
const WHITE = [255, 255, 255];

/* ------------------------------ PNG 编码 ------------------------------ */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'latin1');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(size, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter type 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ------------------------------ 图形绘制 ------------------------------ */

function insideRoundRect(x, y, left, top, right, bottom, radius) {
  if (x < left || x > right || y < top || y > bottom) return false;
  const cx = Math.min(Math.max(x, left + radius), right - radius);
  const cy = Math.min(Math.max(y, top + radius), bottom - radius);
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

/** 气泡尾巴：从 (7,15.5) 到 (7,20) 到 (11.5,15.5) 的直角三角形 */
function insideTail(x, y) {
  if (y < 15.5 || y > 20) return false;
  const t = (y - 15.5) / 4.5; // 0 -> 顶，1 -> 底
  const leftEdge = 7 + t * 0.6;
  const rightEdge = 11.5 - t * 4.5;
  return x >= leftEdge && x <= rightEdge;
}

function sample(x, y) {
  const inBubble = insideRoundRect(x, y, 4.5, 3.5, 19.5, 15.5, 3.2);
  const inTail = insideTail(x, y);
  if (inBubble || inTail) return WHITE;

  const inPlate = insideRoundRect(x, y, 0.5, 0.5, 23.5, 23.5, 5.4);
  if (inPlate) {
    // 轻微上下渐变，视觉上更接近系统图标
    const l = 0.88 + 0.12 * (y / 24);
    return [GREEN[0] * l, GREEN[1] * l, GREEN[2] * l];
  }
  return null;
}

function render(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const unit = 24 / size; // 逻辑坐标系是 24x24
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const lx = (px + (sx + 0.5) / SS) * unit;
          const ly = (py + (sy + 0.5) / SS) * unit;
          const color = sample(lx, ly);
          if (color) {
            r += color[0];
            g += color[1];
            b += color[2];
            a += 255;
          }
        }
      }
      const n = SS * SS;
      const idx = (py * size + px) * 4;
      if (a > 0) {
        const cover = a / (255 * n);
        rgba[idx] = Math.round(r / (a / 255));
        rgba[idx + 1] = Math.round(g / (a / 255));
        rgba[idx + 2] = Math.round(b / (a / 255));
        rgba[idx + 3] = Math.round(cover * 255);
      }
    }
  }
  return rgba;
}

/* ------------------------------ 主流程 ------------------------------ */

mkdirSync(OUT_DIR, { recursive: true });

for (const size of SIZES) {
  const png = encodePng(size, render(size));
  const file = join(OUT_DIR, `${size}.png`);
  writeFileSync(file, png);
  console.log(`已生成 ${file} (${png.length} 字节, ${size}x${size})`);
}
