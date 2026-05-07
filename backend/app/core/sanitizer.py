import bleach

ALLOWED_TAGS = [
    "a",
    "b",
    "blockquote",
    "br",
    "em",
    "h2",
    "h3",
    "li",
    "ol",
    "p",
    "strong",
    "ul",
]
ALLOWED_ATTRIBUTES = {"a": ["href", "title"]}
ALLOWED_PROTOCOLS = ["http", "https", "mailto"]


def sanitize_recipe_html(value: str) -> str:
    return bleach.clean(
        value,
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRIBUTES,
        protocols=ALLOWED_PROTOCOLS,
        strip=True,
    )
