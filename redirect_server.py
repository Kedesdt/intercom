import json
import os
from pathlib import Path
from urllib.parse import urlparse

from flask import Flask, redirect

app = Flask(__name__)
ADDRESS_FILE = Path(__file__).with_name("address.json")


def load_target_address() -> str:
    try:
        with ADDRESS_FILE.open(encoding="utf-8") as file:
            config = json.load(file)
    except FileNotFoundError as error:
        raise RuntimeError(f"Arquivo não encontrado: {ADDRESS_FILE}") from error
    except json.JSONDecodeError as error:
        raise RuntimeError(f"JSON inválido em: {ADDRESS_FILE}") from error

    address = str(config.get("address", "")).strip()
    parsed = urlparse(address)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise RuntimeError("address.json deve conter uma URL http:// ou https:// válida na chave 'address'.")
    return address


@app.get("/")
def index():
    return redirect(load_target_address(), code=302)


if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=int(os.environ.get("REDIRECT_PORT", "80")),
    )
