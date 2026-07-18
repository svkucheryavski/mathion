import re
import unicodedata

ALLOWED_EXTENSIONS = {
    "png", "jpg", "jpeg", "gif",
    "pdf", "csv", "xls", "xlsx", "ppt", "pptx",
    "r", "py", "m",
    "js",
}

_EXTENSION_TO_MIME = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "gif": "image/gif",
    "pdf": "application/pdf",
    "csv": "text/csv",
    "xls": "application/vnd.ms-excel",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "ppt": "application/vnd.ms-powerpoint",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "r": "text/plain",
    "py": "text/plain",
    "m": "text/plain",
    "js": "application/javascript",
}


def sanitize_filename(name: str) -> str:
    """Sanitize filename: lowercase, spaces to hyphens, strip special chars."""
    if "." in name:
        base, ext = name.rsplit(".", 1)
        ext = ext.lower()
    else:
        base = name
        ext = ""

    base = unicodedata.normalize("NFKD", base)
    base = base.encode("ascii", "ignore").decode("ascii")
    base = base.lower()
    base = re.sub(r"[\s_]+", "-", base)
    base = re.sub(r"[^a-z0-9-]", "", base)
    base = re.sub(r"-+", "-", base)
    base = base.strip("-")

    if not base:
        base = "file"

    # Cap the full name at Postgres String(255): truncate the base, keep the
    # extension (a derived name — truncation beats rejecting the upload).
    ext_part = f".{ext}" if ext else ""
    keep = 255 - len(ext_part)
    if keep <= 0:  # pathological: the extension alone exceeds the column width
        return ext_part[:255]
    return base[:keep] + ext_part


def validate_extension(filename: str) -> str | None:
    """Return the lowercase extension if allowed, None otherwise."""
    if "." not in filename:
        return None
    ext = filename.rsplit(".", 1)[1].lower()
    return ext if ext in ALLOWED_EXTENSIONS else None


def get_mime_type(ext: str) -> str:
    """Get MIME type for a file extension."""
    return _EXTENSION_TO_MIME.get(ext, "application/octet-stream")


PDF_MAGIC = b"%PDF-"


def looks_like_pdf(content: bytes) -> bool:
    """True if the bytes begin with the PDF file-header signature (%PDF-).

    A header screen, not a full PDF parse: it rejects obviously non-PDF
    content but does not guarantee structural validity.
    """
    return content.startswith(PDF_MAGIC)
