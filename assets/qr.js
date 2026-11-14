/*!
 * Minimal standalone QR Code generator (Byte mode, Versions 1-10, EC Level L)
 * Based on ISO/IEC 18004 specification.
 * License: MIT
 */
(function (global) {
  "use strict";

  // Total data codewords for EC Level L (Versions 1..10)
  var DATA_CODEWORDS_L = [0, 19, 34, 55, 80, 108, 136, 156, 194, 232, 274];
  // EC codewords per block for Level L (Versions 1..10)
  var EC_PER_BLOCK_L = [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18];
  // Number of blocks [group1Count, group1DataLen, group2Count, group2DataLen] for Level L
  var BLOCKS_L = [
    null,
    [1, 19, 0, 0],
    [1, 34, 0, 0],
    [1, 55, 0, 0],
    [1, 80, 0, 0],
    [1, 108, 0, 0],
    [2, 68, 0, 0],
    [2, 78, 0, 0],
    [2, 97, 0, 0],
    [2, 116, 0, 0],
    [2, 68, 2, 69]
  ];
  var ALIGNMENT_POS = [
    null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
    [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]
  ];

  // GF(256) log/exp tables with primitive polynomial 0x11d
  var EXP = new Uint8Array(512);
  var LOG = new Uint8Array(256);
  (function initGF() {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  function rsGenerator(degree) {
    var poly = [1];
    for (var i = 0; i < degree; i++) {
      var next = new Array(poly.length + 1).fill(0);
      var factor = EXP[i];
      for (var j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= gfMul(poly[j], factor);
      }
      poly = next;
    }
    return poly;
  }

  function rsRemainder(data, ecLen) {
    var gen = rsGenerator(ecLen);
    var res = new Array(ecLen).fill(0);
    for (var i = 0; i < data.length; i++) {
      var factor = data[i] ^ res[0];
      res.shift();
      res.push(0);
      if (factor !== 0) {
        for (var j = 0; j < ecLen; j++) {
          res[j] ^= gfMul(gen[j + 1], factor);
        }
      }
    }
    return res;
  }

  function utf8Bytes(str) {
    if (typeof TextEncoder !== "undefined") {
      return Array.from(new TextEncoder().encode(str));
    }
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 128) out.push(c);
      else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63));
      else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63));
    }
    return out;
  }

  function pickVersion(byteLen) {
    for (var v = 1; v <= 10; v++) {
      var headerBits = v >= 10 ? 20 : 12; // 4 mode + (8 or 16) len
      var maxBytes = Math.floor((DATA_CODEWORDS_L[v] * 8 - headerBits) / 8);
      if (byteLen <= maxBytes) return v;
    }
    throw new Error("QR payload too long");
  }

  function encodeData(bytes, version) {
    var totalCW = DATA_CODEWORDS_L[version];
    var bits = [];
    function pushBits(val, len) {
      for (var i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
    }
    pushBits(0b0100, 4); // Byte mode
    pushBits(bytes.length, version >= 10 ? 16 : 8);
    for (var i = 0; i < bytes.length; i++) pushBits(bytes[i], 8);
    var maxBits = totalCW * 8;
    var term = Math.min(4, maxBits - bits.length);
    pushBits(0, term);
    while (bits.length % 8 !== 0) bits.push(0);
    var cw = [];
    for (var b = 0; b < bits.length; b += 8) {
      var byte = 0;
      for (var k = 0; k < 8; k++) byte = (byte << 1) | bits[b + k];
      cw.push(byte);
    }
    var pads = [0xec, 0x11];
    var pi = 0;
    while (cw.length < totalCW) {
      cw.push(pads[pi]);
      pi ^= 1;
    }
    return cw;
  }

  function interleaveCodewords(cw, version) {
    var spec = BLOCKS_L[version];
    var ecLen = EC_PER_BLOCK_L[version];
    var blocks = [];
    var ecBlocks = [];
    var idx = 0;
    for (var g = 0; g < 2; g++) {
      var count = spec[g * 2];
      var len = spec[g * 2 + 1];
      for (var i = 0; i < count; i++) {
        var blk = cw.slice(idx, idx + len);
        idx += len;
        blocks.push(blk);
        ecBlocks.push(rsRemainder(blk, ecLen));
      }
    }
    var out = [];
    var maxDataLen = Math.max(spec[1], spec[3]);
    for (var d = 0; d < maxDataLen; d++) {
      for (var b = 0; b < blocks.length; b++) {
        if (d < blocks[b].length) out.push(blocks[b][d]);
      }
    }
    for (var e = 0; e < ecLen; e++) {
      for (var b2 = 0; b2 < ecBlocks.length; b2++) {
        out.push(ecBlocks[b2][e]);
      }
    }
    return out;
  }

  function createMatrix(version) {
    var size = version * 4 + 17;
    var mod = Array.from({ length: size }, function () { return new Int8Array(size); });
    var func = Array.from({ length: size }, function () { return new Uint8Array(size); });

    function setFunc(r, c, val) {
      if (r >= 0 && r < size && c >= 0 && c < size) {
        mod[r][c] = val ? 1 : 0;
        func[r][c] = 1;
      }
    }

    function drawFinder(r, c) {
      for (var dr = -1; dr <= 7; dr++) {
        for (var dc = -1; dc <= 7; dc++) {
          var rr = r + dr, cc = c + dc;
          if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
          var dark = (dr >= 0 && dr <= 6 && (dc === 0 || dc === 6)) ||
                     (dc >= 0 && dc <= 6 && (dr === 0 || dr === 6)) ||
                     (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4);
          setFunc(rr, cc, dark);
        }
      }
    }

    drawFinder(0, 0);
    drawFinder(0, size - 7);
    drawFinder(size - 7, 0);

    for (var i = 8; i < size - 8; i++) {
      setFunc(6, i, i % 2 === 0);
      setFunc(i, 6, i % 2 === 0);
    }

    var align = ALIGNMENT_POS[version];
    for (var ai = 0; ai < align.length; ai++) {
      for (var aj = 0; aj < align.length; aj++) {
        var ar = align[ai], ac = align[aj];
        if (func[ar][ac]) continue;
        for (var dr = -2; dr <= 2; dr++) {
          for (var dc = -2; dc <= 2; dc++) {
            var d = Math.max(Math.abs(dr), Math.abs(dc));
            setFunc(ar + dr, ac + dc, d === 2 || d === 0);
          }
        }
      }
    }

    // Reserve format info + dark module
    for (var k = 0; k < 9; k++) {
      if (k !== 6) {
        setFunc(8, k, 0);
        setFunc(k, 8, 0);
      }
    }
    for (var m = 0; m < 8; m++) {
      setFunc(8, size - 1 - m, 0);
      setFunc(size - 1 - m, 8, 0);
    }
    setFunc(size - 8, 8, 1);

    // Reserve version info for v >= 7
    if (version >= 7) {
      for (var vr = 0; vr < 6; vr++) {
        for (var vc = 0; vc < 3; vc++) {
          setFunc(vr, size - 11 + vc, 0);
          setFunc(size - 11 + vc, vr, 0);
        }
      }
    }

    return { size: size, mod: mod, func: func };
  }

  function placeData(mat, codewords) {
    var size = mat.size;
    var bitIdx = 0;
    var totalBits = codewords.length * 8;
    var up = true;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var i = 0; i < size; i++) {
        var r = up ? size - 1 - i : i;
        for (var dx = 0; dx < 2; dx++) {
          var c = right - dx;
          if (!mat.func[r][c]) {
            var bit = 0;
            if (bitIdx < totalBits) {
              bit = (codewords[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1;
              bitIdx++;
            }
            mat.mod[r][c] = bit;
          }
        }
      }
      up = !up;
    }
  }

  function formatBits(mask) {
    var data = (0b01 << 3) | mask; // EC Level L = 01
    var rem = data;
    for (var i = 0; i < 10; i++) rem = (rem << 1) ^ (((rem >> 9) & 1) * 0x537);
    return ((data << 10) | rem) ^ 0x5412;
  }

  function versionBits(version) {
    var rem = version;
    for (var i = 0; i < 12; i++) rem = (rem << 1) ^ (((rem >> 11) & 1) * 0x1f25);
    return (version << 12) | rem;
  }

  function applyMaskAndMeta(mat, mask, version) {
    var size = mat.size;
    var out = mat.mod.map(function (row) { return new Int8Array(row); });
    for (var r = 0; r < size; r++) {
      for (var c = 0; c < size; c++) {
        if (!mat.func[r][c]) {
          var inv = false;
          if (mask === 0) inv = (r + c) % 2 === 0;
          else if (mask === 1) inv = r % 2 === 0;
          else if (mask === 2) inv = c % 3 === 0;
          else if (mask === 3) inv = (r + c) % 3 === 0;
          else if (mask === 4) inv = (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
          else if (mask === 5) inv = ((r * c) % 2 + (r * c) % 3) === 0;
          else if (mask === 6) inv = (((r * c) % 2 + (r * c) % 3) % 2) === 0;
          else inv = (((r + c) % 2 + (r * c) % 3) % 2) === 0;
          if (inv) out[r][c] ^= 1;
        }
      }
    }
    var fmt = formatBits(mask);
    for (var i = 0; i <= 5; i++) out[8][i] = (fmt >> i) & 1;
    out[8][7] = (fmt >> 6) & 1;
    out[8][8] = (fmt >> 7) & 1;
    out[7][8] = (fmt >> 8) & 1;
    for (var j = 9; j < 15; j++) out[14 - j][8] = (fmt >> j) & 1;
    for (var k = 0; k < 8; k++) out[8][size - 1 - k] = (fmt >> k) & 1;
    for (var m = 8; m < 15; m++) out[size - 15 + m][8] = (fmt >> m) & 1;

    if (version >= 7) {
      var vbits = versionBits(version);
      for (var b = 0; b < 18; b++) {
        var bit = (vbits >> b) & 1;
        var a = Math.floor(b / 3), bmod = b % 3;
        out[a][size - 11 + bmod] = bit;
        out[size - 11 + bmod][a] = bit;
      }
    }
    return out;
  }

  function penaltyScore(grid, size) {
    var score = 0;
    for (var r = 0; r < size; r++) {
      var run = 1;
      for (var c = 1; c < size; c++) {
        if (grid[r][c] === grid[r][c - 1]) {
          run++;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else run = 1;
      }
    }
    for (var c2 = 0; c2 < size; c2++) {
      var run2 = 1;
      for (var r2 = 1; r2 < size; r2++) {
        if (grid[r2][c2] === grid[r2 - 1][c2]) {
          run2++;
          if (run2 === 5) score += 3;
          else if (run2 > 5) score += 1;
        } else run2 = 1;
      }
    }
    for (var r3 = 0; r3 < size - 1; r3++) {
      for (var c3 = 0; c3 < size - 1; c3++) {
        var v = grid[r3][c3];
        if (v === grid[r3][c3 + 1] && v === grid[r3 + 1][c3] && v === grid[r3 + 1][c3 + 1]) {
          score += 3;
        }
      }
    }
    return score;
  }

  function generateMatrix(text) {
    var bytes = utf8Bytes(String(text));
    var version = pickVersion(bytes.length);
    var cw = encodeData(bytes, version);
    var stream = interleaveCodewords(cw, version);
    var mat = createMatrix(version);
    placeData(mat, stream);
    var bestGrid = null;
    var bestScore = Infinity;
    for (var mask = 0; mask < 8; mask++) {
      var grid = applyMaskAndMeta(mat, mask, version);
      var s = penaltyScore(grid, mat.size);
      if (s < bestScore) {
        bestScore = s;
        bestGrid = grid;
      }
    }
    return { size: mat.size, grid: bestGrid };
  }

  function drawToCanvas(canvas, text, quietZone) {
    var qz = typeof quietZone === "number" ? quietZone : 2;
    var res = generateMatrix(text);
    var ctx = canvas.getContext("2d");
    var w = canvas.width;
    var h = canvas.height;
    var totalMods = res.size + qz * 2;
    var scale = Math.floor(Math.min(w, h) / totalMods) || 1;
    var offset = Math.floor((w - res.size * scale) / 2);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#080a0f";
    for (var r = 0; r < res.size; r++) {
      for (var c = 0; c < res.size; c++) {
        if (res.grid[r][c]) {
          ctx.fillRect(offset + c * scale, offset + r * scale, scale, scale);
        }
      }
    }
  }

  global.HiFiQR = {
    generateMatrix: generateMatrix,
    drawToCanvas: drawToCanvas
  };
})(window);

