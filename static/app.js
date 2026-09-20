const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];
const socket = io({ autoConnect: false });
const peers = new Map();
const cards = new Map();
const vuMeters = new Map();
let audioContext = null;
let selfId = null;
let localStream = null;
let joined = false;
let users = [];
let selectedMicrophoneId = "";
let selectedSpeakerId = "";
let activeTargets = new Set();
let activeCard = null;

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

function getMicrophoneSupportMessage() {
  if (!window.isSecureContext) {
    return "O microfone exige HTTPS. Use http://localhost:5000 localmente ou publique a aplicação com HTTPS.";
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return "Este navegador não disponibilizou a API de microfone para esta página.";
  }
  return "";
}

function renderUsers() {
  const others = users.filter((user) => user.id !== selfId);
  userCount.textContent = `${others.length} ${others.length === 1 ? "conectado" : "conectados"}`;
  emptyState.classList.toggle("hidden", others.length > 0);
  matrix.replaceChildren();
  cards.clear();

  if (others.length > 0) {
    const allCard = document.createElement("article");
    allCard.className = "channel channel-all";
    allCard.innerHTML = `<div class="channel-top"><p class="operator">Todos os operadores</p><span class="channel-id">ALL</span></div><p class="channel-state">Canal livre</p><div class="vu-meter" aria-label="Nível de áudio recebido"><span class="vu-fill"></span></div><button class="talk-button" type="button" aria-label="Falar com todos"></button>`;
    allCard.tabIndex = joined ? 0 : -1;
    allCard.setAttribute("role", "button");
    allCard.setAttribute("aria-label", "Falar com todos os operadores");
    allCard.setAttribute("aria-disabled", String(!joined));
    bindPtt(allCard, "all");
    matrix.append(allCard);
    cards.set("all", { card: allCard, state: allCard.querySelector(".channel-state") });
  }

  others.forEach((user, index) => {
    const card = document.createElement("article");
    card.className = "channel";
    card.innerHTML = `<div class="channel-top"><p class="operator"></p><span class="channel-id">CH ${String(index + 1).padStart(2, "0")}</span></div><p class="channel-state">Canal livre</p><div class="vu-meter" aria-label="Nível de áudio recebido"><span class="vu-fill"></span></div><button class="talk-button" type="button" aria-label="Falar"></button>`;
    card.querySelector(".operator").textContent = user.name;
    card.tabIndex = joined ? 0 : -1;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Falar com ${user.name}`);
    card.setAttribute("aria-disabled", String(!joined));
    bindPtt(card, user.id);
    matrix.append(card);
    cards.set(user.id, { card, state: card.querySelector(".channel-state") });
  });
}

function getTargets(targetId) {
  return targetId === "all"
    ? users.filter((user) => user.id !== selfId).map((user) => user.id)
    : [targetId];
}

function updateTransmission(targetIds) {
  activeTargets = new Set(targetIds);
  const localTrack = localStream?.getAudioTracks()[0];
  peers.forEach((entry, targetId) => {
    entry.audioSender?.replaceTrack(activeTargets.has(targetId) ? localTrack : null).catch(console.error);
  });
  if (localTrack) localTrack.enabled = activeTargets.size > 0;
}

function clearTransmission() {
  const previousTargets = [...activeTargets];
  updateTransmission([]);
  previousTargets.forEach((target) => socket.emit("ptt-state", { target, active: false }));
  if (activeCard) {
    activeCard.dataset.pressed = "false";
    activeCard.classList.remove("talking");
    activeCard.querySelector(".channel-state").textContent = "Canal livre";
  }
  activeCard = null;
}

function updateVuMeter(targetId, stream) {
  if (!audioContext) audioContext = new AudioContext();
  audioContext.resume().catch(() => {});
  const previous = vuMeters.get(targetId);
  if (previous) cancelAnimationFrame(previous.frame);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  const samples = new Uint8Array(analyser.fftSize);
  const source = audioContext.createMediaStreamSource(stream);
  source.connect(analyser);
  const meter = { frame: 0 };
  vuMeters.set(targetId, meter);

  const draw = () => {
    analyser.getByteTimeDomainData(samples);
    let sum = 0;
    samples.forEach((sample) => {
      const normalized = (sample - 128) / 128;
      sum += normalized * normalized;
    });
    const level = Math.min(100, Math.round(Math.sqrt(sum / samples.length) * 240));
    const card = cards.get(targetId);
    const fill = card?.card.querySelector(".vu-fill");
    if (fill) fill.style.width = `${level}%`;
    meter.frame = requestAnimationFrame(draw);
  };
  draw();
}

function bindPtt(card, targetId) {
  const start = async (event) => {
    event.preventDefault();
    if (!joined || card.dataset.pressed === "true") return;
    clearTransmission();
    card.dataset.pressed = "true";
    activeCard = card;
    card.classList.add("talking");
    card.querySelector(".channel-state").textContent = "Transmitindo áudio";
    try {
      await ensureLocalAudio(false);
      if (card.dataset.pressed !== "true") return;
      const targetIds = getTargets(targetId);
      await Promise.all(targetIds.map((id) => ensurePeer(id, true)));
      if (card.dataset.pressed !== "true") return;
      updateTransmission(targetIds);
      targetIds.forEach((id) => socket.emit("ptt-state", { target: id, active: true }));
    } catch (error) {
      console.error(error);
      stopPtt(card, targetId);
      const supportMessage = getMicrophoneSupportMessage();
      if (supportMessage) {
        hint.textContent = supportMessage;
      } else if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
        hint.textContent = "A permissão do microfone foi recusada. Libere-a nas configurações do site e tente novamente.";
      } else if (error.name === "NotFoundError") {
        hint.textContent = "Nenhum microfone foi encontrado neste dispositivo.";
      } else {
        hint.textContent = "Não foi possível acessar o microfone.";
      }
    }
  };
  const stop = (event) => {
    event.preventDefault();
    stopPtt(card, targetId);
  };
  card.addEventListener("pointerdown", start);
  ["pointerup", "pointercancel", "pointerleave"].forEach((eventName) => card.addEventListener(eventName, stop));
  card.addEventListener("keydown", (event) => { if (event.code === "Space" || event.code === "Enter") start(event); });
  card.addEventListener("keyup", (event) => { if (event.code === "Space" || event.code === "Enter") stop(event); });
}

function stopPtt(card, targetId) {
  if (card.dataset.pressed !== "true") return;
  clearTransmission();
}

async function ensureLocalAudio(activate = true) {
  if (!localStream) {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: selectedMicrophoneId ? { deviceId: { exact: selectedMicrophoneId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true } : { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    localStream.getAudioTracks().forEach((track) => { track.enabled = false; });
    peers.forEach((entry) => {
      if (!entry.audioSender) {
        entry.audioSender = entry.pc.addTrack(localStream.getAudioTracks()[0], localStream);
      }
    });
  }
  localStream.getAudioTracks().forEach((track) => { track.enabled = activate; });
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
  peers.forEach((entry, targetId) => {
    entry.audioSender?.replaceTrack(activeTargets.has(targetId) ? replacementTrack : null);
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
  const entry = { pc, makingOffer: false, audioSender: null };
  peers.set(targetId, entry);
  if (localStream) entry.audioSender = pc.addTrack(localStream.getAudioTracks()[0], localStream);
  pc.onicecandidate = ({ candidate }) => { if (candidate) socket.emit("ice-candidate", { target: targetId, candidate }); };
  pc.ontrack = ({ streams }) => {
    if (streams[0]) {
      let audio = document.querySelector(`#audio-${CSS.escape(targetId)}`);
      if (!audio) { audio = document.createElement("audio"); audio.id = `audio-${targetId}`; audio.autoplay = true; document.body.append(audio); }
      audio.srcObject = streams[0];
      if (selectedSpeakerId && "setSinkId" in HTMLMediaElement.prototype) {
        audio.setSinkId(selectedSpeakerId).catch(console.error);
      }
      updateVuMeter(targetId, streams[0]);
      audio.play().catch(() => {});
    }
  };
  pc.onconnectionstatechange = () => { if (["failed", "closed"].includes(pc.connectionState)) peers.delete(targetId); };
  return pc;
}

async function ensurePeer(targetId, createOffer) {
  let entry = peers.get(targetId);
  if (!entry) {
    createPeer(targetId);
    entry = peers.get(targetId);
  }
  if (localStream && !entry.audioSender) {
    entry.audioSender = entry.pc.addTrack(localStream.getAudioTracks()[0], localStream);
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
  const supportMessage = getMicrophoneSupportMessage();
  if (supportMessage) {
    hint.textContent = supportMessage;
    deviceHint.textContent = "Abra a aplicação em um contexto seguro para liberar o microfone.";
    return;
  }
  const name = nameInput.value.trim() || `Operador ${Math.floor(Math.random() * 90 + 10)}`;
  nameInput.value = name;
  joined = true;
  nameInput.disabled = true;
  joinButton.disabled = true;
  hint.textContent = "Aguardando permissão para usar o microfone...";
  try {
    await ensureLocalAudio(false);
    await loadAudioDevices();
    microphoneSelect.disabled = false;
    hint.textContent = "Segure o cartão de um operador para falar.";
    socket.auth = { name };
    socket.connect();
    renderUsers();
  } catch (error) {
    console.error(error);
    joined = false;
    nameInput.disabled = false;
    joinButton.disabled = false;
    if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
      hint.textContent = "A permissão do microfone foi recusada. Libere-a nas configurações do site e tente novamente.";
    } else if (error.name === "NotFoundError") {
      hint.textContent = "Nenhum microfone foi encontrado neste dispositivo.";
    } else {
      hint.textContent = "Não foi possível acessar o microfone.";
    }
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
