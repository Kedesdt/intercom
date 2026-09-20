# Intercom PTT

MVP de matriz de comunicação por voz. O áudio usa WebRTC em tempo real; Flask-SocketIO é usado apenas para presença, sinalização e estado do PTT. Nenhum áudio é gravado no servidor.

## Executar no Windows

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python app.py
```

Abra `http://localhost:5000` em duas abas ou em dois navegadores. Informe nomes diferentes, entre na matriz e pressione o botão do outro operador.

Para microfone em produção, use HTTPS. O STUN configurado é público e serve para desenvolvimento; produção deve adicionar um servidor TURN para redes que bloqueiam conexões diretas.
