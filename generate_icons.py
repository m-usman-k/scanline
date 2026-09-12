#!/usr/bin/env python3
"""Generate placeholder icons for Scanline Chrome extension."""
import struct
import zlib
import os

def create_png(size, output_path):
    # Create a simple purple square with an "S" shape
    pixels = []
    center = size // 2
    radius = size // 3

    for y in range(size):
        row = []
        for x in range(size):
            # Background: dark purple
            r, g, b, a = 108, 92, 231, 255

            # Create a simple "S" / scanline shape
            dx = x - center
            dy = y - center
            dist = (dx*dx + dy*dy) ** 0.5

            if dist < radius:
                # Inner circle - lighter
                r, g, b = 140, 120, 255
                # Add a simple pattern
                if (x + y) % 3 == 0 and dist < radius * 0.7:
                    r, g, b = 255, 255, 255
                    a = 200
            elif dist < radius + 2:
                # Border
                r, g, b = 80, 65, 200

            row.extend([r, g, b, a])
        pixels.append(bytes([0] + row))  # Filter byte + pixel data

    raw_data = b''.join(pixels)

    def make_chunk(chunk_type, data):
        chunk = chunk_type + data
        crc = struct.pack('>I', zlib.crc32(chunk) & 0xFFFFFFFF)
        return struct.pack('>I', len(data)) + chunk + crc

    signature = b'\x89PNG\r\n\x1a\n'
    ihdr_data = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    ihdr = make_chunk(b'IHDR', ihdr_data)
    idat = make_chunk(b'IDAT', zlib.compress(raw_data))
    iend = make_chunk(b'IEND', b'')

    with open(output_path, 'wb') as f:
        f.write(signature + ihdr + idat + iend)

icons_dir = os.path.join(os.path.dirname(__file__), 'icons')
os.makedirs(icons_dir, exist_ok=True)

for size in [16, 48, 128]:
    create_png(size, os.path.join(icons_dir, f'icon{size}.png'))
    print(f'Created icon{size}.png')

print('Done!')
