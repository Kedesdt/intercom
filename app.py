import os
import re
from typing import Any

from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit, join_room

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "intercom-dev-key")
socketio = SocketIO(app, cors_allowed_origins="*", allow_upgrades=False)

users: dict[str, dict[str, str]] = {}
rooms: dict[str, dict[str, Any]] = {}


def clean_name(value: Any) -> str:
    name = re.sub(r"\s+", " ", str(value or "")).strip()
    return name[:32] or "Operador"


def clean_room_name(value: Any) -> str:
    name = re.sub(r"\s+", " ", str(value or "")).strip()
    return name[:48]


def clean_room_code(value: Any) -> str:
    code = re.sub(r"\s+", " ", str(value or "")).strip()
    return code[:32].casefold()


def room_key(room_name: str, room_code: str) -> str:
    return f"{room_name.casefold()}::{room_code}"


def user_list(room_id: str) -> list[dict[str, str]]:
    return [
        {"id": user_id, "name": user["name"]}
        for user_id, user in users.items()
        if user["room"] == room_id
    ]


@app.get("/")
def index():
    return render_template("index.html")


@socketio.on("connect")
def handle_connect(auth: dict[str, Any] | None = None):
    auth = auth or {}
    name = clean_name(auth.get("name"))
    room_name = clean_room_name(auth.get("roomName"))
    room_code = clean_room_code(auth.get("roomCode"))
    if not room_name or not room_code:
        raise ConnectionRefusedError("Informe o nome e o código da sala.")

    room_id = room_key(room_name, room_code)
    room = rooms.get(room_id)
    if not room:
        room = {"name": room_name, "members": set()}
        rooms[room_id] = room

    join_room(room_id)
    room["members"].add(request.sid)
    users[request.sid] = {"name": name, "room": room_id}
    emit("ready", {"id": request.sid, "name": name, "roomName": room_name})
    socketio.emit("users", user_list(room_id), to=room_id)


@socketio.on("disconnect")
def handle_disconnect():
    user = users.pop(request.sid, None)
    if not user:
        return
    room_id = user["room"]
    room = rooms.get(room_id)
    if not room:
        return
    room["members"].discard(request.sid)
    if not room["members"]:
        rooms.pop(room_id, None)
    else:
        socketio.emit("users", user_list(room_id), to=room_id)


def relay(event: str, data: dict[str, Any] | None):
    data = data or {}
    target = data.get("target")
    sender = users.get(request.sid)
    recipient = users.get(target)
    if not sender or not recipient or sender["room"] != recipient["room"]:
        return

    payload = dict(data)
    payload["sender"] = request.sid
    payload["senderName"] = sender["name"]
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
