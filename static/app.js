const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];
const socket = io({ autoConnect: false });
const peers = new Map();
const cards = new Map();
let selfId = null;
let localStream = null;
let joined = false;
let users = [];
let selectedMicrophoneId = "";
let selectedSpeakerId = "";

const matrix = document.querySelector("#matrix");
const emptyState = document.querySelector("#empty-state");
const nameInput = document.querySelector("#name-input");
const joinButton = document.querySelector("#join-button");
const hint = document.querySelector("#hint");
const connectionLabel = document.querySelector("#connection-label");
const connectionDot = document.querySelector("#connection-dot");
const userCount = document.querySelector("#user-count");
const microphoneSelect = document.querySelector("#microphone-select");
const speakerSelect = document.querySelector("#speaker-select");
const deviceHint = document.querySelector("#device-hint");

function setConnection(online, label) {
  connectionDot.classList.toggle("online", online);
  connectionLabel.textContent = label;
}

function renderUsers() {
  const others = users.filter((user) => user.id !== selfId);
  userCount.textContent = `${others.length} ${others.length === 1 ? "conectado" : "conectados"}`;
  emptyState.classList.toggle("hidden", others.length > 0);
  matrix.replaceChildren();
  cards.clear();

  others.forEach((user, index) => {
    const card = document.createElement("article");
    card.className = "channel";
    card.innerHTML = `<div class="channel-top"><p class="operator"></p><span class="channel-id">CH ${String(index + 1).padStart(2, "0")}</span></div><p class="channel-state">Canal livre</p><button class="talk-button" type="button">PRESSIONE PARA FALAR</button>`;
    card.querySelector(".operator").textContent = user.name;
    const button = card.querySelector("button");
    button.disabled = !joined;
    bindPtt(button, card, user.id);
    matrix.append(card);
    cards.set(user.id, { card, button, state: card.querySelector(".channel-state") });
  });
}

function bindPtt(button, card, targetId) {
  const start = async (event) => {
    event.preventDefault();
    if (!joined || button.dataset.pressed === "true") return;
    button.dataset.pressed = "true";
    button.textContent = "FALANDO...";
    card.classList.add("talking");
    card.querySelector(".channel-state").textContent = "Transmitindo áudio";
    try {
      await ensureLocalAudio();
      await ensurePeer(targetId, true);
      socket.emit("ptt-state", { target: targetId, active: true });
    } catch (error) {
      console.error(error);
      stopPtt(button, card, targetId);
      hint.textContent = "Não foi possível acessar o microfone.";
    }
  };
  const stop = (event) => {
    event.preventDefault();
    stopPtt(button, card, targetId);
  };
  button.addEventListener("pointerdown", start);
  ["pointerup", "pointercancel", "pointerleave"].forEach((eventName) => button.addEventListener(eventName, stop));
  button.addEventListener("keydown", (event) => { if (event.code === "Space" || event.code === "Enter") start(event); });
  button.addEventListener("keyup", (event) => { if (event.code === "Space" || event.code === "Enter") stop(event); });
}

function stopPtt(button, card, targetId) {
  if (button.dataset.pressed !== "true") return;
  button.dataset.pressed = "false";
  button.textContent = "PRESSIONE PARA FALAR";
  card.classList.remove("talking");
  card.querySelector(".channel-state").textContent = "Canal livre";
  if (localStream) localStream.getAudioTracks().forEach((track) => { track.enabled = false; });
  socket.emit("ptt-state", { target: targetId, active: false });
}

async function ensureLocalAudio() {
  if (!localStream) {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: selectedMicrophoneId ? { deviceId: { exact: selectedMicrophoneId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true } : { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    localStream.getAudioTracks().forEach((track) => { track.enabled = false; });
    peers.forEach(({ pc }) => {
      localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
    });
  }
  localStream.getAudioTracks().forEach((track) => { track.enabled = true; });
}

async function loadAudioDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const microphones = devices.filter((device) => device.kind === "audioinput");
  const speakers = devices.filter((device) => device.kind === "audiooutput");
  const previousMicrophone = selectedMicrophoneId;
  microphoneSelect.replaceChildren();
  speakerSelect.replaceChildren();
  microphones.forEach((device, index) => {
    const option = new Option(device.label || `Microfone ${index + 1}`, device.deviceId);
    microphoneSelect.add(option);
  });
  speakers.forEach((device, index) => {
    const option = new Option(device.label || `Alto-falante ${index + 1}`, device.deviceId);
    speakerSelect.add(option);
  });
  microphoneSelect.disabled = microphones.length === 0;
  speakerSelect.disabled = speakers.length === 0;
  if (previousMicrophone && microphones.some((device) => device.deviceId === previousMicrophone)) {
    microphoneSelect.value = previousMicrophone;
  } else if (microphones[0]) {
    selectedMicrophoneId = microphones[0].deviceId;
    microphoneSelect.value = selectedMicrophoneId;
  }
  deviceHint.textContent = speakers.length && "setSinkId" in HTMLMediaElement.prototype
    ? "Dispositivos prontos para uso."
    : "Seu navegador não permite selecionar o alto-falante por esta página.";
}

async function changeMicrophone(deviceId) {
  selectedMicrophoneId = deviceId;
  const replacement = await navigator.mediaDevices.getUserMedia({
    audio: { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: false,
  });
  const replacementTrack = replacement.getAudioTracks()[0];
  replacementTrack.enabled = false;
  const oldTrack = localStream?.getAudioTracks()[0];
  peers.forEach(({ pc }) => {
    pc.getSenders().find((sender) => sender.track?.kind === "audio")?.replaceTrack(replacementTrack);
  });
  if (oldTrack) oldTrack.stop();
  localStream = replacement;
}

async function changeSpeaker(deviceId) {
  selectedSpeakerId = deviceId;
  const audioElements = document.querySelectorAll("audio");
  if (!("setSinkId" in HTMLMediaElement.prototype)) return;
  await Promise.all([...audioElements].map((audio) => audio.setSinkId(deviceId)));
}

function createPeer(targetId) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  peers.set(targetId, { pc, makingOffer: false });
  if (localStream) localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
  pc.onicecandidate = ({ candidate }) => { if (candidate) socket.emit("ice-candidate", { target: targetId, candidate }); };
  pc.ontrack = ({ streams }) => {
    if (streams[0]) {
      let audio = document.querySelector(`#audio-${CSS.escape(targetId)}`);
      if (!audio) { audio = document.createElement("audio"); audio.id = `audio-${targetId}`; audio.autoplay = true; document.body.append(audio); }
      audio.srcObject = streams[0];
      if (selectedSpeakerId && "setSinkId" in HTMLMediaElement.prototype) {
        audio.setSinkId(selectedSpeakerId).catch(console.error);
      }
      audio.play().catch(() => {});
    }
  };
  pc.onconnectionstatechange = () => { if (["failed", "closed"].includes(pc.connectionState)) peers.delete(targetId); };
  return pc;
}

async function ensurePeer(targetId, createOffer) {
  let entry = peers.get(targetId);
  if (!entry) entry = { pc: createPeer(targetId), makingOffer: false };
  if (localStream && !entry.pc.getSenders().some((sender) => sender.track?.kind === "audio")) {
    localStream.getTracks().forEach((track) => entry.pc.addTrack(track, localStream));
  }
  if (createOffer && entry.pc.signalingState === "stable") {
    entry.makingOffer = true;
    const offer = await entry.pc.createOffer();
    await entry.pc.setLocalDescription(offer);
    socket.emit("offer", { target: targetId, description: entry.pc.localDescription });
    entry.makingOffer = false;
  }
  return entry.pc;
}

joinButton.addEventListener("click", async () => {
  if (joined) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    hint.textContent = "Este navegador não permite acesso ao microfone nesta página.";
    return;
  }
  const name = nameInput.value.trim() || `Operador ${Math.floor(Math.random() * 90 + 10)}`;
  nameInput.value = name;
  joinButton.disabled = true;
  hint.textContent = "Aguardando permissão para usar o microfone...";
  try {
    await ensureLocalAudio();
    await loadAudioDevices();
    joined = true;
    nameInput.disabled = true;
    microphoneSelect.disabled = false;
    hint.textContent = "Segure um botão para transmitir áudio.";
    socket.auth = { name };
    socket.connect();
    renderUsers();
  } catch (error) {
    console.error(error);
    joinButton.disabled = false;
    hint.textContent = "Permita o uso do microfone para entrar na matriz.";
    deviceHint.textContent = "A permissão foi recusada ou o microfone não está disponível.";
  }
});

microphoneSelect.addEventListener("change", async () => {
  try {
    await changeMicrophone(microphoneSelect.value);
    deviceHint.textContent = "Microfone alterado.";
  } catch (error) {
    console.error(error);
    deviceHint.textContent = "Não foi possível trocar o microfone.";
  }
});

speakerSelect.addEventListener("change", async () => {
  try {
    await changeSpeaker(speakerSelect.value);
    deviceHint.textContent = "Alto-falante alterado.";
  } catch (error) {
    console.error(error);
    deviceHint.textContent = "Não foi possível trocar o alto-falante.";
  }
});

navigator.mediaDevices?.addEventListener("devicechange", () => {
  if (joined) loadAudioDevices().catch(console.error);
});

socket.on("connect", () => setConnection(true, "Conectado"));
socket.on("disconnect", () => setConnection(false, "Desconectado"));
socket.on("ready", (data) => { selfId = data.id; renderUsers(); });
socket.on("users", (data) => { users = data; renderUsers(); });
socket.on("offer", async ({ sender, description }) => {
  const pc = await ensurePeer(sender, false);
  await pc.setRemoteDescription(description);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit("answer", { target: sender, description: pc.localDescription });
});
socket.on("answer", async ({ sender, description }) => {
  const entry = peers.get(sender);
  if (entry) await entry.pc.setRemoteDescription(description);
});
socket.on("ice-candidate", async ({ sender, candidate }) => {
  const entry = peers.get(sender);
  if (entry) await entry.pc.addIceCandidate(candidate);
});
socket.on("ptt-state", ({ sender, senderName, active }) => {
  const target = cards.get(sender);
  if (!target) return;
  target.card.classList.toggle("talking", active);
  target.state.textContent = active ? `${senderName} está falando` : "Canal livre";
});

renderUsers();
