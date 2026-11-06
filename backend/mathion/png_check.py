"""The PNG check for the logo and the tab icon (superuser Branding spec D5).

Without decoding: the signature, an IHDR chunk first and valid, every chunk
walked by its length with a valid CRC, image data, up to IEND. Bytes after
IEND are ignored, as browsers ignore them. Apple's CgBI variant, which
browsers can't show, puts its chunk before IHDR, so "IHDR first" refuses it.
"""
import struct
import zlib

SIGNATURE = b"\x89PNG\r\n\x1a\n"
_MAX_SIDE = 2 ** 31 - 1  # PNG's own limit

# The critical chunks a browser knows; another critical chunk (an upper-case
# first letter) means the browser can't show the image.
_CRITICAL = (b"IHDR", b"PLTE", b"IDAT", b"IEND")

# Colour type -> the bit depths PNG allows for it.
_DEPTHS = {0: (1, 2, 4, 8, 16), 2: (8, 16), 3: (1, 2, 4, 8), 4: (8, 16), 6: (8, 16)}


class PngRefused(ValueError):
    """Not a PNG a browser can show; the caller words the sentence (D5, D6)."""


def check_png(data: bytes) -> tuple[int, int]:
    """D5: the PNG's width and height, or PngRefused."""
    if not data.startswith(SIGNATURE):
        raise PngRefused("no PNG signature")
    pos, first, image_data, palette = len(SIGNATURE), True, False, False
    size, colour = (0, 0), 0
    while True:
        if pos + 8 > len(data):
            raise PngRefused("the file ends before IEND")
        length, kind = struct.unpack(">I4s", data[pos:pos + 8])
        end = pos + 12 + length
        if length > _MAX_SIDE or end > len(data):
            raise PngRefused("a chunk runs past the end of the file")
        body = data[pos + 8:end - 4]
        if not kind.isalpha() or not kind.isascii():
            raise PngRefused("a chunk type isn't four letters")
        if kind[0:1].isupper() and kind not in _CRITICAL:
            raise PngRefused(f"an unknown critical chunk {kind!r}")
        if zlib.crc32(kind + body) != struct.unpack(">I", data[end - 4:end])[0]:
            raise PngRefused(f"the {kind!r} chunk's CRC is wrong")
        if first:
            if kind != b"IHDR" or length != 13:
                raise PngRefused("IHDR isn't the first chunk")
            width, height, depth, colour, compression, filtering, interlace = struct.unpack(">IIBBBBB", body)
            if not (1 <= width <= _MAX_SIDE and 1 <= height <= _MAX_SIDE):
                raise PngRefused("the width or height is out of range")
            if depth not in _DEPTHS.get(colour, ()) or compression or filtering or interlace > 1:
                raise PngRefused("the IHDR values aren't valid")
            size, first = (width, height), False
        elif kind == b"IHDR":
            raise PngRefused("a second IHDR")
        elif kind == b"PLTE":
            palette = True
        elif kind == b"IDAT":
            if colour == 3 and not palette:
                raise PngRefused("a palette image with no palette")
            image_data = True
        elif kind == b"IEND":
            if not image_data or length:
                raise PngRefused("no image data, or IEND carries data")
            return size
        pos = end
