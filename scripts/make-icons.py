"""Renders the extension icon (rounded square, a stylised "i") without dependencies."""
import struct, zlib, sys, os

ACCENT = (180, 83, 42)
WHITE = (255, 253, 249)

def inside_rounded(x, y, size, r):
    cx = min(max(x, r), size - r); cy = min(max(y, r), size - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r

def pixel(x, y, s):
    # coordinates in a 0..1 design space
    if not inside_rounded(x, y, 1.0, 0.22):
        return None
    dot = (x - 0.5) ** 2 + (y - 0.29) ** 2 <= 0.085 ** 2
    stem = 0.425 <= x <= 0.575 and 0.43 <= y <= 0.76
    stem_round = (x - 0.5) ** 2 + (y - 0.76) ** 2 <= 0.075 ** 2
    return WHITE if (dot or stem or stem_round) else ACCENT

def render(size, ss=4):
    rows = []
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            acc = [0, 0, 0, 0]
            for sy in range(ss):
                for sx in range(ss):
                    c = pixel((px + (sx + .5) / ss) / size, (py + (sy + .5) / ss) / size, size)
                    if c:
                        acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]; acc[3] += 255
            n = ss * ss
            a = acc[3] // n
            if acc[3]:
                k = acc[3] / 255
                row += bytes([int(acc[0] / k), int(acc[1] / k), int(acc[2] / k), a])
            else:
                row += bytes([0, 0, 0, 0])
        rows.append(bytes(row))
    raw = b"".join(rows)
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))

out = sys.argv[1]
for size in (16, 32, 48, 128):
    with open(os.path.join(out, f"icon-{size}.png"), "wb") as f:
        f.write(render(size))
