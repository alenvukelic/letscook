from pydantic import BaseModel


class SystemMetadata(BaseModel):
    name: str
    languages: list[str]
    roles: list[str]
    features: list[str]
