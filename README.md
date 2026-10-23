# MitBar · Pub social 3D multiplayer

**MitBar** é um protótipo funcional de jogo social em terceira pessoa para computador e celular, com servidor Node.js e comunicação em tempo real. Você entra com seu nome, e-mail, idade e apelido do personagem, personaliza o visual e encontra outras pessoas em um pub virtual de três andares.

## Recursos implementados

- **Mundo 3D em terceira pessoa:** pub, lounge e sky bar. Mesas, balcões, sofás, iluminação, elevador interativo e câmera de acompanhamento.
- **Multiplayer online:** até 60 conexões por instância, avatares reais dos visitantes, posições sincronizadas e reconexão automática via Socket.IO.
- **Cadastro de entrada:** nome, e-mail, nome do personagem e idade; menores de 18 anos são barrados tanto no formulário quanto no servidor. A idade é **autodeclarada**, não existe verificação documental.
- **Aparência e gênero do personagem:** masculino, feminino ou neutro; escolha de tom de pele, cabelo, penteado e roupa.
- **Voz de proximidade:** áudio WebRTC entre jogadores no mesmo andar e a aproximadamente 11 unidades de distância; quem não ativa o microfone pode escutar. Microfone pode ser desligado.
- **Perfil de outro personagem:** clique/toque no avatar para ver **somente apelido e gênero do personagem** e a distância aproximada; nome real e e-mail não são expostos.
- **Convite de vídeo:** o jogador recebe uma solicitação que pode aceitar ou recusar; câmera e microfone não são ativados para a chamada antes da aceitação. Chamadas via WebRTC entre dois participantes.
- **Silenciar, bloquear e denunciar:** silenciamento individual no próprio dispositivo; bloqueio de sessão e registro básico de denúncias no console do servidor.
- **PC e smartphone:** WASD/setas + câmera com mouse, ou joystick virtual + movimento da câmera com toque.
- **Deploy no Render:** inclui `render.yaml` e endpoint `/health`.

## Requisitos

- Node.js **20 ou mais recente** e npm.
- Browser atualizado com WebGL 2 e WebRTC (Chrome, Edge, Firefox, Safari atualizado).
- Internet para carregar o módulo Three.js e as fontes via CDN (a biblioteca não está empacotada no ZIP).
- **HTTPS** para câmera e microfone na publicação (a URL Render já fornece TLS). `http://localhost` é aceito para desenvolvimento local.

## Instalação no PC

```bash
npm install
npm start
```

Abra **http://localhost:3000** em um navegador. Para dois usuários em dispositivos diferentes, publique num endereço HTTPS (ex.: Render). O servidor deve estar rodando para que o jogo funcione.

Em ambiente de desenvolvimento com reinício automático:

```bash
npm run dev
```

## Publicar no Render

1. Extraia o ZIP, abra a pasta `mitbar` no terminal e crie um repositório GitHub.
2. Execute:

```bash
git init
git add .
git commit -m "MitBar multiplayer 3D"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/mitbar.git
git push -u origin main
```

3. No [Render](https://dashboard.render.com/), selecione **New → Web Service** e conecte o repositório.
4. Configure a linguagem como **Node**, **Build Command:** `npm install`, **Start Command:** `npm start`.
5. Escolha um plano de sua preferência (o gratuito é adequado para experimentação, sujeito a limites) e publique. O Render fornecerá uma URL HTTPS (`https://...onrender.com`).
6. Compartilhe a mesma URL com outras pessoas para entrar no mesmo pub.

O arquivo `render.yaml` pode ser usado no método **New → Blueprint** para preenchimento automático de boa parte das configurações.

## Áudio/vídeo — STUN e TURN

As conexões de áudio/vídeo passam diretamente pelos navegadores sempre que possível. Por padrão, são configurados servidores **STUN públicos**. Algumas redes móveis, redes corporativas e configurações de NAT **exigem um servidor TURN de retransmissão** para que chamadas funcionem de modo confiável. Para implantar TURN, adicione estas variáveis de ambiente ao serviço:

```env
TURN_URLS=turn:seu-dominio.com:3478,turns:seu-dominio.com:5349
TURN_USERNAME=usuario-turn
TURN_CREDENTIAL=senha-turn
```

Os dados acima são **exemplos**, não credenciais reais. TURN deve estar implantado e configurado corretamente. Use credenciais temporárias com vencimento quando for lançar publicamente. Como o navegador precisa conhecer as credenciais para conectar ao TURN, o endpoint `/api/config` as disponibiliza ao cliente; **não reutilize senhas administrativas**.

Se o usuário bloquear o microfone, poderá permanecer no pub como ouvinte. Se o navegador impedir reprodução automática de som, use o botão **Ativar áudio**.

## Estrutura

```text
mitbar/
├── server.js             # Express, Socket.IO, presença, posições, vídeo e sinalização
├── package.json          # Dependências e scripts
├── render.yaml           # Configuração Render
├── .gitignore
├── README.md
└── public/
    ├── index.html        # Interface e formulário de acesso
    ├── styles.css        # Identidade visual e layout responsivo
    ├── main.js           # Jogo, controles, entrada, câmera e interface
    ├── world.js          # Cenários e avatares procedurais 3D
    ├── rtc.js            # WebRTC: voz de proximidade e chamadas de vídeo
    └── favicon.svg
```

## Transparência e limites antes de disponibilizar ao público

Este projeto é uma **primeira versão multiplayer funcional**, não um serviço social comercial pronto para uso em larga escala.

- O servidor mantém nome, e-mail e idade **apenas na memória enquanto a conexão está ativa**, para atender ao formulário. Eles não são gravados em arquivo ou banco de dados e não são usados para marketing. Não há login com senha nem confirmação de e-mail: o visitante preenche seus dados a cada entrada.
- A barreira 18+ usa idade digitada. Para efetivar restrição etária, é necessário integrar um serviço legítimo de verificação de idade, criar termos e política de privacidade e obedecer às leis aplicáveis.
- **Não há moderação operacional**: as denúncias aparecem em logs (marcador `[MITBAR_REPORT]`) sem painel, fila, retenção segura ou equipe de atendimento. Antes de abrir ao público, implementar moderação real, medidas antisstalking/abuso, rate limiting por IP, bloqueio persistente e canal de suporte.
- Bloqueios e silenciamentos são por ID de sessão; são perdidos quando a pessoa se reconecta. Cada participante pode voltar a entrar com um novo apelido.
- O jogo usa apenas uma sala compartilhada por **processo Node.js**. Escalar para várias instâncias do Render requer persistência/coordenação entre nós, adaptador Redis para Socket.IO e distribuição de mundo/salas.
- WebRTC em malha cria uma conexão de áudio para cada pessoa próxima, o que não é ideal para centenas de pessoas. Para expansão, recomenda-se um **SFU** (por exemplo LiveKit, mediasoup) e limites de conexões por região/ambiente.
- Física e detecção de colisões são simples. Visualmente os três andares são cenários separados, alternados no elevador; não há uma escada contínua em 3D nem móveis interativos.
- O e-mail não é enviado para propaganda. Para produção, é necessário informar tratamento de dados, consentimento, políticas de retenção e exclusão. O transporte da mídia WebRTC é criptografado; a implantação precisa de HTTPS.

## Solução de problemas

**Aparece uma tela preta:** confira WebGL/aceleração de hardware e se o navegador consegue carregar `cdn.jsdelivr.net`. Sem internet para o CDN, Three.js não carrega.

**Duas pessoas não se veem:** confirmem que abriram **a mesma URL do mesmo serviço**, não `localhost` em PCs diferentes. Verifique os logs do Render.

**As pessoas aparecem, mas não se escutam:** autorizem o microfone, aproximem-se no mesmo andar, verifiquem se não há silenciamento e usem **Ativar áudio**. Em redes restritas, configure TURN.

**Vídeo não abre no celular:** autorize câmera/microfone no navegador e use o site HTTPS; pode ser necessário TURN.

**Troca de andar falhou:** caminhe até a plataforma brilhante no fundo/esquerda (próximo à parede), pressione E ou Andares, e selecione **o andar imediatamente acima ou abaixo**.

**Servidor parou no plano gratuito:** confira as políticas do plano e os logs do serviço. Algumas instâncias gratuitas entram em repouso quando ociosas.
