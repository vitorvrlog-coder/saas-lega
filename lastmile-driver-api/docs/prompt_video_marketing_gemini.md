# Prompt para vídeo de marketing — Heimdall Logtech

Cole isto no Gemini (Veo).

**Importante**: IA de vídeo erra muito texto/logo na tela — por isso o prompt abaixo evita pedir texto escrito ou logo específica. Adicione o texto final ("Heimdall — sua entrega, garantida.") depois, editando o vídeo pronto (CapCut, Canva, editor do celular).

---

Vídeo de 15 segundos, vertical (9:16), estilo realista e cinematográfico, sem nenhum texto ou logotipo na tela. Paleta de cores dominante: azul-marinho escuro (hex #13315C) e âmbar dourado (hex #E8A33D) — reforce isso nas roupas, luzes, elementos de cena e na interface dos celulares mostrados. Um motorista de entrega, uniforme azul-marinho, olha o celular e vê uma notificação do WhatsApp com um ícone âmbar de confirmação; ele sorri aliviado e caminha confiante até a van. Corta pra uma tela de computador limpa e moderna, fundo branco com detalhes azul-marinho e âmbar, mostrando um painel/dashboard com indicadores de entregas confirmadas. Iluminação quente, movimento de câmera suave. Música de fundo leve e moderna, instrumental, sem letra.

---

Se ainda sair cor errada, insista mandando de novo só essa frase isolada: "use exclusively navy blue #13315C and amber #E8A33D as the color palette throughout, no other colors."

---

## Alternativa: cena curta de abertura/loop pro site (não o vídeo do motorista acima)

O site de marketing (`marketing-site/`) hoje é fundo preto puro com dourado (`#c9a24b`/`#e8c374`), não mais o azul-marinho do app — esse prompt usa a paleta do site, pensado pra tocar em loop assim que a página carrega (curto, sem narrativa, só atmosfera de marca).

Cole isto no Gemini (Veo):

---

Vídeo curtíssimo de 4 segundos, formato quadrado ou 16:9, cinematográfico e abstrato, sem nenhum texto ou logotipo específico na tela, pensado pra rodar em loop perfeito (o último frame deve poder emendar com o primeiro sem corte perceptível). Fundo preto absoluto. Partículas de luz dourada (hex #c9a24b e #e8c374) flutuando devagar e convergindo suavemente em direção ao centro do quadro, como faíscas ou poeira dourada brilhante sendo atraída por um campo magnético invisível — nunca chegam a formar uma imagem ou símbolo reconhecível, só o movimento de convergência. Câmera quase estática, com uma deriva muito sutil (leve zoom in). Profundidade de campo rasa, glow suave em cada partícula, sem excesso de brilho estourado. Sem música, sem som — o vídeo é só o loop visual de fundo.

---

Se sair com cores erradas ou formando algo reconhecível: "abstract floating gold light particles only, hex #c9a24b and #e8c374, on pure black background — do not form any recognizable shape, symbol, or letter."

---

## Vídeo full-bleed pro fundo do hero (horizontal, tipo mahnic.com.br)

A Mahnic usa um vídeo horizontal cobrindo a largura inteira do hero, atrás do texto grande — diferente da cena vertical do motorista e do loop de partículas acima. Esse aqui é pra SUBSTITUIR o canvas de partículas (`#hero-particles` em `index.html`) por um `<video>` de verdade, cobrindo `.hero-section` inteira. Ponto crítico: o texto do hero (título, botões) fica por cima, então o vídeo precisa ficar **escuro e com pouco contraste no centro-esquerda** — é onde o texto se sobrepõe — senão a leitura fica ruim.

Cole isto no Gemini (Veo):

---

Vídeo de 8 segundos, formato horizontal widescreen (16:9), cinematográfico, tom sério e premium, sem nenhum texto ou logotipo na tela, pensado pra rodar em loop contínuo (primeiro e último frame devem combinar visualmente). Cena: um pátio logístico à noite, filmado em câmera lenta, com furgões de entrega parados em fileira e uma leve neblina baixa no chão. Iluminação quase toda em preto e azul-escuro quase preto, com pontos de luz âmbar/dourada (hex #c9a24b) vindos dos faróis dos veículos e de painéis de LED distantes, criando reflexos dourados no chão molhado. A composição deixa o terço esquerdo e o centro do quadro mais escuros e com menos elementos em movimento (espaço negativo pra texto sobreposto depois), enquanto o lado direito tem mais detalhe visual (veículos, luzes). Câmera em traveling lateral lentíssimo, quase imperceptível. Sem música, sem som.

---

Se sair claro demais ou com muito movimento no lado esquerdo: "keep the left two-thirds of the frame significantly darker and calmer, with minimal motion — that area will have text overlaid on top of the video, so it must stay low-contrast and readable-friendly. Concentrate visual detail, light, and motion on the right third only."

---

## Alternativa full-bleed: mapa de rotas acendendo (abstrato, ligado ao produto)

Em vez de cena realista de pátio/motorista (a IA de vídeo erra mais em gente e veículos reais), essa opção é 100% abstrata — uma malha de rotas de entrega se acendendo num mapa escuro, remetendo direto a "last-mile" sem depender de a IA acertar rostos, uniformes ou placas de veículo. Mesmo objetivo de composição: espaço negativo escuro à esquerda pro texto, detalhe visual à direita.

Cole isto no Gemini (Veo):

---

Vídeo de 8 segundos, formato horizontal widescreen (16:9), abstrato e elegante, sem nenhum texto, número ou logotipo na tela, pensado pra loop perfeito. Fundo preto absoluto, com o contorno esmaecido e minimalista de um mapa de ruas visto de cima (linhas finas cinza-azuladas quase invisíveis, como um mapa noturno). Sobre esse mapa, pequenos pontos e linhas dourados (hex #c9a24b) vão se acendendo e se conectando um a um formando rotas, como uma rede de entregas ativando em tempo real — o movimento de "acender" começa do lado direito do quadro e se espalha lentamente, deixando o terço esquerdo do quadro com poucas linhas acesas e mais escuro (espaço reservado pra texto sobreposto depois). Leve brilho (glow) dourado em cada ponto que acende. Câmera parada, sem movimento de traveling. Sem música, sem som.

---

Se a IA insistir em desenhar prédios, carros ou pessoas: "purely abstract minimalist map outline and glowing route lines only — no buildings, no vehicles, no people, no text, just thin lines and glowing dots on black."

---

## Mais 3 opções full-bleed (todas abstratas — evitam o risco de rosto/mão estranha da IA)

Mesmo objetivo de composição das anteriores: 16:9, loop perfeito, sem texto/logo, terço esquerdo mais escuro e calmo (onde o texto do hero fica sobreposto), detalhe visual mais concentrado à direita.

### A) Bolhas de chat subindo devagar

Vídeo de 8 segundos, formato horizontal widescreen (16:9), abstrato e minimalista, sem texto nem logotipo, loop perfeito. Fundo preto absoluto. Formas simples parecidas com balões de conversa (retângulos com cantos bem arredondados, sem nenhum texto dentro), em contorno fino dourado (hex #c9a24b) com preenchimento quase transparente, sobem devagar de baixo pra cima como bolhas, aparecendo mais no terço direito do quadro e ficando raras e mais transparentes no terço esquerdo. Glow suave em cada contorno. Câmera parada. Sem música, sem som.

*Se a IA tentar escrever texto dentro dos balões:* "chat bubble shapes must remain completely empty, no text, no characters, no icons inside them — just empty rounded rectangle outlines."

### B) Fio dourado tecendo uma rota

Vídeo de 8 segundos, formato horizontal widescreen (16:9), abstrato, elegante, sem texto nem logotipo, loop perfeito. Fundo preto absoluto. Um único fio/linha dourada fina (hex #c9a24b), como um traço de luz, se desenha lentamente no ar formando uma curva contínua e orgânica (não geométrica, tipo caligrafia fluida) — nunca forma letra, número ou símbolo reconhecível. O traço se concentra e se torna mais elaborado no terço direito do quadro, ficando mais esparso e reto no terço esquerdo. Fundo com leve textura de partículas de poeira dourada bem sutil. Câmera parada. Sem música, sem som.

*Se formar algo reconhecível:* "the golden line must remain a purely abstract flowing curve — never resembling a letter, digit, logo, or recognizable symbol."

### C) Contagem regressiva abstrata (reforça "resolvido em segundos")

Vídeo de 8 segundos, formato horizontal widescreen (16:9), abstrato, sem texto nem números legíveis, sem logotipo, loop perfeito. Fundo preto absoluto. Um anel fino de luz dourada (hex #c9a24b), como um relógio circular minimalista sem ponteiros nem números, gira suavemente enquanto pequenos segmentos de luz se acendem em sequência ao redor do anel, dando sensação de progresso/contagem. O anel fica posicionado no terço direito do quadro; o restante do quadro é preto liso. Glow suave, sem excesso de brilho. Câmera parada. Sem música, sem som.

*Se aparecerem números:* "the ring must have no numbers, no digits, no tick marks with text — only plain glowing segments lighting up around a bare circular ring."
