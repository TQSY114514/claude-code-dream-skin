import struct, os, zlib

def create_png(width, height, pixels):
    """Create a simple RGBA PNG with a gradient circle."""
    def chunk(ctype, data):
        raw = ctype + data
        crc = struct.pack('>I', zlib.crc32(raw) & 0xFFFFFFFF)
        return struct.pack('>I', len(data)) + raw + crc

    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))

    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter none
        cx, cy = width / 2, height / 2
        r = min(width, height) / 2 - 1
        for x in range(width):
            dx, dy = x - cx, y - cy
            dist = (dx*dx + dy*dy) ** 0.5
            if dist < r:
                t = dist / r
                raw.extend([
                    int(0x7e * (1 - t) + 0xb3 * t),
                    int(0xc8 * (1 - t) + 0x88 * t),
                    int(0xe3 * (1 - t) + 0xff * t),
                    255
                ])
            else:
                raw.extend([0, 0, 0, 0])

    compressed = zlib.compress(bytes(raw))
    idat = chunk(b'IDAT', compressed)
    iend = chunk(b'IEND', b'')
    return sig + ihdr + idat + iend

def create_ico(sizes):
    """Create a Windows ICO file with multiple sizes."""
    entries = bytearray()
    png_data = bytearray()

    offset = 6 + 16 * len(sizes)  # header + entries

    for w, h in sizes:
        png = create_png(w, h, None)
        size = len(png)
        entries.extend(struct.pack('<BBBBHHII',
            w if w < 256 else 0,
            h if h < 256 else 0,
            0,  # color palette
            0,  # reserved
            1,  # color planes
            0,  # bpp
            size, offset
        ))
        png_data.extend(png)
        offset += size

    header = struct.pack('<HHH', 0, 1, len(sizes))
    return header + bytes(entries) + bytes(png_data)

# Create ICO with common sizes
sizes = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
ico = create_ico(sizes)

out_dir = os.path.join(os.getcwd(), 'resources')
os.makedirs(out_dir, exist_ok=True)
out_path = os.path.join(out_dir, 'icon.ico')
with open(out_path, 'wb') as f:
    f.write(ico)
print(f'Icon generated: {out_path} ({len(ico)} bytes)')
