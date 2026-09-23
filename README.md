# Intercom PTT

MVP de matriz de comunicação por voz. O áudio usa WebRTC em tempo real; Flask-SocketIO é usado apenas para presença, sinalização e estado do PTT. Nenhum áudio é gravado no servidor.

## Executar no Windows

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python app.py
```

Abra `http://localhost:5000` em duas abas ou em dois navegadores. Informe o identificador do operador, o nome da sala e o código da sala. Pessoas com o mesmo nome e código entram na mesma sala; códigos diferentes criam salas isoladas. A sala existe somente enquanto houver alguém conectado e é removida da memória quando o último participante sai.

Para microfone em produção, use HTTPS. O STUN configurado é público e serve para desenvolvimento; produção deve adicionar um servidor TURN para redes que bloqueiam conexões diretas.

## HTTPS local com Cloudflare Tunnel

O Cloudflare Tunnel cria uma URL HTTPS pública que encaminha as requisições para o Flask local. Assim, os usuários acessam pelo navegador sem instalar certificado no computador ou no celular.

### Instalar o cloudflared no Windows

Abra o PowerShell e execute:

```powershell
winget install Cloudflare.cloudflared
```

Feche e abra o PowerShell novamente, depois confirme a instalação:

```powershell
cloudflared --version
```

### Iniciar o Flask

No primeiro terminal, na pasta do projeto:

```powershell
.\.venv\Scripts\Activate.ps1
python app.py
```

Confirme que o servidor local está disponível em `http://localhost:5000`.

### Criar o túnel HTTPS

Abra um segundo terminal e execute:

```powershell
cloudflared tunnel --url http://localhost:5000
```

O comando permanecerá executando para manter o túnel aberto. Isso é esperado. Aguarde a URL exibida no terminal, parecida com:

```text
https://nome-aleatorio.trycloudflare.com
```

Abra essa URL no computador e no celular. O endereço usa HTTPS válido, então o navegador poderá solicitar o microfone para o WebRTC.

Não feche o terminal do `cloudflared` enquanto a aplicação estiver em uso. Para encerrar o túnel, pressione `Ctrl+C` nesse terminal.

### Testar o Flask antes do túnel

Se a URL HTTPS não aparecer ou o túnel não conectar, verifique primeiro se o Flask está funcionando:

```powershell
Invoke-WebRequest http://localhost:5000
```

Uma resposta com status `200` confirma que o Flask está acessível localmente.

### Fluxo da aplicação

```text
Celular ou computador do usuário
	|
	| https://...trycloudflare.com
	v
Cloudflare Tunnel
	|
	| http://localhost:5000
	v
Flask local
```

Esse túnel rápido não exige `cloudflared tunnel login`, domínio próprio, certificado local ou configuração de portas no roteador. A URL é temporária e muda quando o processo é encerrado. Para uma URL fixa, é necessário configurar um túnel nomeado com um domínio administrado pela Cloudflare.

## Servidor direcionador

O arquivo `redirect_server.py` inicia um servidor HTTP que redireciona qualquer acesso à raiz para o endereço definido em `address.json`.

Edite o destino:

```json
{
  "address": "https://seu-endereco.com"
}
```

Inicie o direcionador na porta 80:

```powershell
python redirect_server.py
```

Acesse o IP ou domínio do computador e o navegador será encaminhado para o endereço configurado. A porta 80 pode exigir que o PowerShell seja executado como administrador. Para testar sem privilégios, use outra porta:

```powershell
$env:REDIRECT_PORT = "8080"
python redirect_server.py
```

O direcionador é separado do servidor principal: `app.py` continua atendendo o Intercom na porta 5000.
