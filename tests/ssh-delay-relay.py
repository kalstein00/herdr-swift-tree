"""Hold downstream packets on a loopback SSH connection for native UI tests."""

import argparse
import asyncio
from pathlib import Path


async def pipe(reader, writer, control=None):
    try:
        while block := await reader.read(65536):
            held = control is not None and (control / "hold").exists()
            if held:
                (control / "held").touch()
                while (control / "hold").exists():
                    await asyncio.sleep(0.025)
            writer.write(block)
            await writer.drain()
            if held:
                (control / "forwarded").touch()
    finally:
        writer.close()


async def main(control, target_port):
    async def connect(reader, writer):
        upstream_reader, upstream_writer = await asyncio.open_connection("127.0.0.1", target_port)
        await asyncio.gather(
            pipe(reader, upstream_writer),
            pipe(upstream_reader, writer, control),
            return_exceptions=True,
        )

    server = await asyncio.start_server(connect, "127.0.0.1", 0)
    (control / "port").write_text(str(server.sockets[0].getsockname()[1]), encoding="ascii")
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("control", type=Path)
    parser.add_argument("target_port", type=int)
    arguments = parser.parse_args()
    asyncio.run(main(arguments.control, arguments.target_port))
