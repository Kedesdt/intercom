import os
import re
from typing import Any

from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "intercom-dev-key")
socketio = SocketIO(app, cors_allowed_origins="*")

users: dict[str, str] = {}


def clean_name(value: Any) -> str:
    name = re.sub(r"\s+", " ", str(value or "")).strip()
    return name[:32] or "Operador"


def user_list() -> list[dict[str, str]]:
    return [
        {"id": user_id, "name": name}
        for user_id, name in users.items()
    ]


@app.get("/")
def index():
    return render_template("index.html")


@socketio.on("connect")
def handle_connect(auth: dict[str, Any] | None = None):
    name = clean_name((auth or {}).get("name"))
    users[request.sid] = name
    emit("ready", {"id": request.sid, "name": name})
    socketio.emit("users", user_list())


@socketio.on("disconnect")
def handle_disconnect():
    users.pop(request.sid, None)
    socketio.emit("users", user_list())


def relay(event: str, data: dict[str, Any] | None):
    data = data or {}
    target = data.get("target")
    if target not in users:
        return

    payload = dict(data)
    payload["sender"] = request.sid
    payload["senderName"] = users.get(request.sid, "Operador")
    emit(event, payload, to=target)


@socketio.on("offer")
def handle_offer(data):
    relay("offer", data)


@socketio.on("answer")
def handle_answer(data):
    relay("answer", data)


@socketio.on("ice-candidate")
def handle_ice_candidate(data):
    relay("ice-candidate", data)


@socketio.on("ptt-state")
def handle_ptt_state(data):
    relay("ptt-state", data)


if __name__ == "__main__":
    socketio.run(
        app,
        host="0.0.0.0",
        port=int(os.environ.get("PORT", "5000")),
        debug=True,
    )
