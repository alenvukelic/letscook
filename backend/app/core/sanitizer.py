import re

import bleach


def allow_image_attr(tag: str, name: str, value: str) -> bool:
    if tag != "img":
        return False
    if name in {"alt", "title"}:
        return True
    if name == "src":
        # Product rule: uploaded/local media only, no external image hotlinking.
        return value.startswith("/media/")
    return False

ALLOWED_TAGS = [
    "a",
    "b",
    "blockquote",
    "br",
    "em",
    "h2",
    "h3",
    "img",
    "li",
    "ol",
    "p",
    "strong",
    "ul",
]
ALLOWED_ATTRIBUTES = {"a": ["href", "title"], "img": allow_image_attr}
ALLOWED_PROTOCOLS = ["http", "https", "mailto"]


def sanitize_recipe_html(value: str) -> str:
    return bleach.clean(
        value,
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRIBUTES,
        protocols=ALLOWED_PROTOCOLS,
        strip=True,
    )


def validate_recipe_markdown(value: str) -> str:
    markdown = value.strip()
    image_urls = re.findall(r"!\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)", markdown)
    image_urls.extend(re.findall(r"<img\s+[^>]*src=[\"']([^\"']+)[\"']", markdown, re.IGNORECASE))
    invalid_urls = [url for url in image_urls if not url.startswith("/media/")]
    if invalid_urls:
        raise ValueError("Markdown images must use local /media/ URLs")
    return markdown
