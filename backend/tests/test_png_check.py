"""Branding D5: a PNG is checked without decoding: signature, IHDR first and
valid, every chunk's CRC, up to IEND."""
import struct
import zlib

import pytest

from mathion.png_check import PngRefused, check_png

SIGNATURE = b"\x89PNG\r\n\x1a\n"


def chunk(kind: bytes, data: bytes, crc: int | None = None) -> bytes:
    if crc is None:
        crc = zlib.crc32(kind + data)
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", crc)


def ihdr(width=2, height=1, depth=8, colour=6, compression=0, filtering=0, interlace=0) -> bytes:
    return chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, depth, colour, compression, filtering, interlace))


def idat(width=2, height=1) -> bytes:
    return chunk(b"IDAT", zlib.compress((b"\x00" + b"\xff" * 4 * width) * height))


def png(*chunks: bytes) -> bytes:
    return SIGNATURE + b"".join(chunks)


VALID = png(ihdr(), idat(), chunk(b"IEND", b""))


def test_valid_png():
    assert check_png(VALID) == (2, 1)


def test_bytes_after_iend_are_ignored():
    assert check_png(VALID + b"trailing junk") == (2, 1)


def test_ancillary_chunks_are_walked():
    assert check_png(png(ihdr(), chunk(b"tEXt", b"Title\x00Logo"), idat(), chunk(b"IEND", b""))) == (2, 1)


PLTE = chunk(b"PLTE", b"\x00\x00\x00\xff\xff\xff")


@pytest.mark.parametrize("depth, colour", [(1, 0), (16, 0), (8, 2), (16, 2), (1, 3), (8, 3), (8, 4), (16, 6)])
def test_valid_depth_colour_pairs(depth, colour):
    extra = (PLTE,) if colour == 3 else ()
    assert check_png(png(ihdr(depth=depth, colour=colour), *extra, idat(), chunk(b"IEND", b""))) == (2, 1)


def test_interlaced_accepted():
    assert check_png(png(ihdr(interlace=1), idat(), chunk(b"IEND", b""))) == (2, 1)


@pytest.mark.parametrize("data", [
    b"\xff\xd8\xff\xe0" + b"\x00" * 40,                                   # a JPEG
    b'<svg xmlns="http://www.w3.org/2000/svg"></svg>',                     # an SVG
    b"",
    SIGNATURE,
    png(chunk(b"IHDR", struct.pack(">IIBBBBB", 2, 1, 8, 6, 0, 0, 0), crc=0), idat(), chunk(b"IEND", b"")),
    png(ihdr(), chunk(b"IDAT", zlib.compress(b"\x00" * 9), crc=1), chunk(b"IEND", b"")),
    png(ihdr(), idat()),                                                   # no IEND
    VALID[:-6],                                                            # a truncated chunk
    png(ihdr(width=0), idat(), chunk(b"IEND", b"")),
    png(ihdr(height=0), idat(), chunk(b"IEND", b"")),
    png(ihdr(width=2 ** 31), idat(), chunk(b"IEND", b"")),
    png(ihdr(depth=16, colour=3), idat(), chunk(b"IEND", b"")),
    png(ihdr(depth=4, colour=2), idat(), chunk(b"IEND", b"")),
    png(ihdr(depth=8, colour=5), idat(), chunk(b"IEND", b"")),
    png(chunk(b"CgBI", b"\x50\x00\x20\x02"), ihdr(), idat(), chunk(b"IEND", b"")),
    png(chunk(b"IHDR", struct.pack(">IIBBBB", 2, 1, 8, 6, 0, 0)), idat(), chunk(b"IEND", b"")),  # 12 bytes
    png(ihdr(), chunk(b"IEND", b"")),                                      # no image data
    png(ihdr(), ihdr(), idat(), chunk(b"IEND", b"")),                      # a second IHDR
    png(ihdr(compression=1), idat(), chunk(b"IEND", b"")),
    png(ihdr(filtering=1), idat(), chunk(b"IEND", b"")),
    png(ihdr(interlace=2), idat(), chunk(b"IEND", b"")),
    png(ihdr(), chunk(b"ab1d", b""), idat(), chunk(b"IEND", b"")),          # a type that isn't letters
    png(ihdr(), chunk(b"\x00\x01\x02\x03", b""), idat(), chunk(b"IEND", b"")),
    png(ihdr(), chunk(b"ABCD", b""), idat(), chunk(b"IEND", b"")),          # an unknown critical chunk
    png(ihdr(colour=3), idat(), chunk(b"IEND", b"")),                      # a palette image with no PLTE
    png(ihdr(), idat(), chunk(b"IEND", b"x")),                             # IEND with data
])
def test_refused(data):
    with pytest.raises(PngRefused):
        check_png(data)


def test_huge_chunk_length_is_refused_without_reading_on():
    with pytest.raises(PngRefused):
        check_png(png(ihdr(), struct.pack(">I", 0xFFFFFFF0) + b"IDAT"))


def test_unknown_ancillary_chunk_is_skipped():
    assert check_png(png(ihdr(), chunk(b"abCd", b"anything"), idat(), chunk(b"IEND", b""))) == (2, 1)
