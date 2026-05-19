from __future__ import annotations

import os
import select
import socketserver
import sys
import threading
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from db import import_markdown_folder


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


def main() -> None:
    if len(sys.argv) < 2:
        raise RuntimeError("Usage: python db/run_import_over_ssh.py <folder> [--author-email ...]")

    ssh_password = os.environ.get("SSH_PASSWORD")
    if not ssh_password:
        raise RuntimeError("SSH_PASSWORD environment variable is required")

    ssh_client = paramiko.SSHClient()
    ssh_client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh_client.connect(
        hostname="ubuntu-dev",
        username="avukelic",
        password=ssh_password,
        look_for_keys=False,
        allow_agent=False,
        timeout=15,
    )

    handler = type(
        "ImportForwardHandler",
        (ForwardHandler,),
        {
            "ssh_transport": ssh_client.get_transport(),
            "remote_host": "127.0.0.1",
            "remote_port": 5432,
        },
    )
    server = ForwardServer(("127.0.0.1", 6543), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    previous_database_url = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = "postgresql://letscook:Alen1981@127.0.0.1:6543/letscook"
    previous_argv = sys.argv[:]
    try:
        sys.argv = [previous_argv[0], *previous_argv[1:]]
        import_markdown_folder.main()
    finally:
        sys.argv = previous_argv
        if previous_database_url is None:
            os.environ.pop("DATABASE_URL", None)
        else:
            os.environ["DATABASE_URL"] = previous_database_url
        server.shutdown()
        server.server_close()
        ssh_client.close()


if __name__ == "__main__":
    main()
