from __future__ import annotations

import os
import select
import socketserver
import threading
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import paramiko
import uvicorn


ENV_FILES = (Path(__file__).with_name(".env.local"), Path(__file__).with_name(".env"))


def read_env_value(name: str) -> str | None:
    for env_file in ENV_FILES:
        if not env_file.exists():
            continue
        for raw_line in env_file.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            if key.strip() == name:
                return value.strip()
    return None


class ForwardHandler(socketserver.BaseRequestHandler):
    ssh_transport: paramiko.Transport
    remote_host: str
    remote_port: int

    def handle(self) -> None:
        channel = self.ssh_transport.open_channel(
            "direct-tcpip",
            (self.remote_host, self.remote_port),
            self.request.getpeername(),
        )
        try:
            while True:
                readable, _, _ = select.select([self.request, channel], [], [], 1)
                if self.request in readable:
                    data = self.request.recv(1024)
                    if not data:
                        break
                    channel.sendall(data)
                if channel in readable:
                    data = channel.recv(1024)
                    if not data:
                        break
                    self.request.sendall(data)
        finally:
            channel.close()
            self.request.close()


class ForwardServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def forwarded_database_url(database_url: str, port: int) -> tuple[str, str, int, str]:
    parsed = urlsplit(database_url)
    if parsed.hostname is None:
        raise RuntimeError("DATABASE_URL is missing a hostname")

    local_netloc = parsed.netloc.replace(parsed.hostname, "127.0.0.1")
    remote_port = parsed.port or 5432
    if parsed.port is not None:
        local_netloc = local_netloc.replace(f":{parsed.port}", f":{port}")
    else:
        local_netloc = f"{local_netloc}:{port}"

    return (
        urlunsplit((parsed.scheme, local_netloc, parsed.path, parsed.query, parsed.fragment)),
        parsed.hostname,
        remote_port,
        parsed.username or "",
    )


def main() -> None:
    ssh_password = os.environ.get("SSH_PASSWORD")
    if not ssh_password:
        raise RuntimeError("SSH_PASSWORD environment variable is required")

    database_url = os.environ.get("DATABASE_URL") or read_env_value("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL is required in backend/.env.local or environment")

    forwarded_url, remote_host, remote_port, _ = forwarded_database_url(database_url, 6543)
    ssh_host = os.environ.get("SSH_HOST", remote_host)
    ssh_user = os.environ.get("SSH_USER", "avukelic")

    ssh_client = paramiko.SSHClient()
    ssh_client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh_client.connect(
        hostname=ssh_host,
        username=ssh_user,
        password=ssh_password,
        look_for_keys=False,
        allow_agent=False,
        timeout=15,
    )

    handler = type(
        "ApiForwardHandler",
        (ForwardHandler,),
        {
            "ssh_transport": ssh_client.get_transport(),
            "remote_host": "127.0.0.1",
            "remote_port": remote_port,
        },
    )
    server = ForwardServer(("127.0.0.1", 6543), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    previous_database_url = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = forwarded_url
    try:
        uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=False)
    finally:
        if previous_database_url is None:
            os.environ.pop("DATABASE_URL", None)
        else:
            os.environ["DATABASE_URL"] = previous_database_url
        server.shutdown()
        server.server_close()
        ssh_client.close()


if __name__ == "__main__":
    main()
