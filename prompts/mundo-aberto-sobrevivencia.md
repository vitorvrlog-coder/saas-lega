# Prompt — Falcão: mundo aberto pós-apocalíptico

> Prompt consolidado para o Claude (Claude Code) continuar o projeto deste repositório.
> Junta o simulador de voo já existente (`flight-sim/`) com a expansão de sobrevivência, cidades exploráveis e sobreviventes com IA.

---

## CONTEXTO E PAPEL

Você é um desenvolvedor sênior de jogos, especialista em JavaScript, Three.js/WebGL, simulação física, IA de personagens (máquinas de estados, árvores de comportamento, navegação) e arquitetura de mundos abertos.

Este repositório já contém um jogo funcional em `flight-sim/`: o **Falcão**, um simulador de voo 3D em mundo aberto. Ele roda no navegador, inclusive no celular. O novo objetivo é transformar esse jogo em um **mundo aberto pós-apocalíptico de sobrevivência**. Nele o jogador caminha em terceira pessoa, explora cidades abandonadas, enfrenta zumbis, conhece sobreviventes controlados por IA e, mais adiante, usa veículos e as aeronaves que já existem.

Leia o código existente antes de começar. Reaproveite o que já funciona e não reescreva sistemas que já estão testados sem um motivo claro.

---

## PARTE A — BASE EXISTENTE (preservar e reaproveitar)

O que já está implementado e deve continuar funcionando:

- **Arquitetura**: scripts clássicos sem bundler, com namespace global `FS`. Funciona em `file://`. `node build.js` gera um único HTML em `dist/` com tudo embutido, inclusive o Three.js r128 local em `assets/vendor/`.
- **`src/terrain.js`**: relevo determinístico e infinito (`heightAt`), aeroportos, cidades, colisores de construções (`hitsBuilding`) e tipos de superfície. Não depende de THREE e roda no Node para testes.
- **`src/world.js`**: terreno carregado por blocos de 1600 m com raio configurável, água, céu com dia e entardecer, nuvens instanciadas, árvores instanciadas por bloco, cidades instanciadas, estradas e aeroportos com pista, táxi, pátio, hangares, torre e luzes.
- **`src/flightPhysics.js`**: modelo de voo 6-DOF com passo fixo de 1/240 s. Tem sustentação, arrasto, estol, motores com atraso e pós-combustor, trem de pouso com suspensão, freios, esterçamento e colisões, além da avaliação de pouso (perfeito, seguro, brusco ou acidente).
- **`src/aircraft.js`**: modelo 3D do caça, com superfícies, trem e flaps animados, e o cockpit com painel de instrumentos.
- **`src/controls.js`**: teclado, Pointer Lock, manche e manete virtuais, toque e teclas remapeáveis.
- **`src/hud.js`**, **`src/audio.js`**, **`src/settings.js`**, **`src/main.js`**: HUD, som procedural, configurações persistentes, câmeras e menus em português do Brasil.

Regras para a base:

- A pilotagem, a decolagem e o pouso das aeronaves devem continuar funcionando exatamente como hoje. Na Etapa 10 eles passam a ser acessados dentro do mundo: o jogador anda até um avião estacionado e entra nele.
- Mantenha a separação entre lógica pura (sem THREE, testável no Node) e renderização.
- Mantenha o funcionamento no celular (controles por toque e qualidade "Baixa") e o build de arquivo único.
- Ao trocar de modo entre a pé, em veículo e em aeronave, só um conjunto de controles fica ativo por vez.

---

## PARTE B — O JOGO DE SOBREVIVÊNCIA (núcleo que a expansão pressupõe)

Implemente antes da expansão, porque ela depende disto:

1. **Personagem em terceira pessoa**:
   - Movimento: andar, correr, agachar, pular, subir escadas e interagir.
   - Câmera orbital com colisão, para não atravessar paredes.
   - Controles por teclado e mouse, mais joystick virtual no celular.
2. **Sobrevivência**:
   - Vida, fome, sede, cansaço e ferimentos (sangramento e infecção).
   - Inventário com peso e espaços.
   - Coleta, consumo e crafting simples.
3. **Combate**:
   - Corpo a corpo e à distância, com munição limitada e ruído que atrai inimigos.
   - Dano localizado ou por zona.
4. **Zumbis com IA básica**:
   - Estados: vagando, ouvindo, perseguindo, atacando e perdendo o alvo.
   - Percepção por visão e audição.
   - Hordas com custo baixo de processamento.
5. **Salvamento persistente** do estado do jogador e do mundo (localStorage ou IndexedDB, com fallback em memória).

---

## PARTE C — EXPANSÃO: CIDADES VIVAS, PRÉDIOS EXPLORÁVEIS E SOBREVIVENTES COM IA

Quero expandir o jogo de sobrevivência zumbi para um mundo aberto 3D muito mais ambicioso. As inspirações são a exploração urbana de The Last of Us, a liberdade de Minecraft e os sistemas de sobrevivência de Project Zomboid e DayZ.

IMPORTANTE: não quero apenas um mapa vazio com zumbis. O mundo deve parecer ter sido habitado por milhares de pessoas antes do apocalipse. Ele precisa ter cidades abandonadas, sobreviventes humanos, facções, construções exploráveis e acontecimentos dinâmicos.

### 1. Cidades gigantescas e exploráveis

Crie um mundo aberto com várias regiões distintas:

- Centro urbano com arranha-céus, prédios comerciais e apartamentos.
- Bairros residenciais com casas, quintais, garagens e ruas.
- Hospitais abandonados com medicamentos e equipamentos médicos.
- Supermercados com alimentos e materiais.
- Delegacias com equipamentos de proteção e armas.
- Oficinas mecânicas com ferramentas e peças para veículos.
- Postos de combustível.
- Aeroportos com hangares, aviões e pistas. Reaproveite os aeroportos e o caça que já existem.
- Bases militares abandonadas.
- Indústrias, depósitos e centros logísticos.
- Florestas, fazendas, rios e pequenas cidades.
- Acampamentos de sobreviventes e comunidades fortificadas.

Cada região deve ter características próprias, recursos específicos, perigos e oportunidades.

**Prédios com vários andares**

Os edifícios devem ser realmente exploráveis. O jogador poderá:

- Entrar pelas portas e janelas.
- Subir e descer escadas.
- Explorar apartamentos e escritórios.
- Encontrar objetos em gavetas, armários e caixas.
- Abrir portas trancadas usando chaves ou ferramentas.
- Encontrar sobreviventes escondidos.
- Descobrir zumbis em quartos, corredores e escadarias.
- Encontrar documentos, pistas e histórias de antigos moradores.
- Usar telhados para observar a cidade e identificar ameaças.
- Construir posições defensivas em edifícios selecionados.

Não faça prédios que sejam apenas cenário inacessível. Prefira um número menor de edifícios totalmente exploráveis a milhares de fachadas falsas. Os prédios que aparecem apenas ao longe podem continuar instanciados como hoje, desde que fique claro quais deles podem ser explorados.

Implemente interiores modulares (salas, corredores e escadas montados a partir de peças) para reduzir o consumo de memória. Os interiores só devem ser gerados quando o jogador estiver por perto.

### 2. Sobreviventes humanos controlados por IA

O mundo deve ter NPCs humanos independentes do jogador. Eles precisam ter:

- Nome, aparência, idade adulta e personalidade.
- Modelo corporal e roupas variados.
- Vozes e diálogos.
- Necessidades de alimentação, água e descanso.
- Inventário e equipamentos próprios.
- Capacidade de lutar, fugir, esconder-se e negociar.
- Memória das interações com o jogador.
- Rotinas e objetivos pessoais.
- Relações com outros sobreviventes.
- Capacidade de formar grupos e comunidades.
- Possibilidade de morrer, desaparecer ou mudar de lugar.

Os NPCs não devem ficar parados esperando o jogador. Eles circulam pelo mundo, procuram recursos, saqueiam edifícios, defendem abrigos e reagem aos acontecimentos.

**Sobreviventes homens e mulheres**

Inclua uma população diversificada de NPCs adultos, homens e mulheres, com aparências, personalidades, histórias, roupas, habilidades e funções diferentes. As personagens femininas devem ser personagens completas e independentes, não decorativas.

Exemplos de especializações:

- Médica, capaz de tratar ferimentos.
- Engenheira, capaz de reparar equipamentos e veículos.
- Atiradora especializada em combate à distância.
- Mecânica, capaz de consertar carros e aeronaves.
- Exploradora especializada em encontrar recursos.
- Agricultora, capaz de produzir alimentos.
- Comerciante, responsável por negociar recursos.
- Líder, capaz de organizar uma comunidade.
- Sobrevivente comum, com habilidades que podem ser desenvolvidas.

Nenhuma função é limitada por gênero: qualquer personagem pode ter qualquer especialização.

### 3. Recrutamento e companheiros

O jogador pode conhecer sobreviventes durante as explorações e, dependendo das decisões tomadas, convidá-los a acompanhá-lo. Implemente:

- Sistema de confiança.
- Diálogos com diferentes respostas.
- Missões pessoais dos NPCs.
- Pedidos de ajuda.
- Possibilidade de o NPC aceitar ou recusar o recrutamento.
- Comandos para seguir, esperar, defender e voltar à base.
- Distribuição de equipamentos.
- Gestão de munição, alimentos e medicamentos.
- Tratamento de ferimentos dos companheiros.
- Possibilidade de os companheiros morrerem em combate.
- Evolução de habilidades com o tempo.

A confiança depende das ações do jogador: promessas cumpridas, recursos compartilhados e decisões tomadas. Alguns sobreviventes serão amigáveis, outros desconfiados, e alguns poderão tentar roubar ou atacar o jogador.

### 4. Personalidade e relacionamentos sociais

Crie um sistema social que torne os NPCs mais humanos. Cada personagem tem traços como:

- Coragem ou medo.
- Generosidade ou egoísmo.
- Lealdade ou oportunismo.
- Sociabilidade ou comportamento reservado.
- Experiência de combate.
- Preferência por determinados grupos.
- Confiança ou desconfiança em relação ao jogador.

Os personagens podem formar amizades, rivalidades, alianças e relacionamentos consensuais entre adultos, quando fizer sentido na narrativa. Esses relacionamentos surgem de diálogos, convivência, confiança e acontecimentos do jogo, e nunca são obrigatórios. Os NPCs reagem à morte de companheiros, à perda de recursos, a ataques contra a comunidade e às decisões do jogador.

### 5. Facções e comunidades

Crie diferentes grupos de sobreviventes espalhados pelo mapa, por exemplo:

- Comunidade pacífica que cultiva alimentos.
- Grupo de comerciantes que controla uma região.
- Milícia que protege uma área urbana.
- Grupo hostil que saqueia outros sobreviventes.
- Comunidade médica que ajuda pessoas feridas.
- Grupo de exploradores que procura veículos e combustível.

Cada facção tem:

- Território e base.
- Recursos e reputação.
- Líderes.
- Relações com outras facções.
- Objetivos próprios.
- Patrulhas e rotinas.
- Capacidade de negociar, recrutar e entrar em conflito.

O jogador pode negociar, trabalhar para essas comunidades, tornar-se aliado ou inimigo e até fundar a própria facção.

### 6. Base principal e administração da comunidade

O jogador pode transformar uma casa, um galpão, um posto ou outro local adequado em sua base. Na base ele pode:

- Construir muros e barricadas.
- Instalar portões e armadilhas.
- Criar depósitos.
- Montar uma enfermaria.
- Instalar oficinas.
- Plantar alimentos.
- Armazenar água.
- Instalar geradores.
- Estacionar e reparar veículos.
- Designar NPCs para tarefas.
- Organizar turnos de vigilância.
- Receber novos sobreviventes.
- Defender a comunidade contra ataques.

Os NPCs recrutados trabalham de acordo com suas habilidades e as ordens recebidas. A comunidade precisa de alimentos, água, medicamentos e segurança. Quando esses recursos acabam, podem surgir conflitos, doenças, abandono e outros problemas.

### 7. IA dos sobreviventes

Implemente comportamentos realistas e eficientes. Exemplos:

- Um NPC procura comida num supermercado.
- Dois sobreviventes discutem a divisão de recursos.
- Uma médica trata um companheiro ferido.
- Um grupo volta à base antes de anoitecer.
- Um sobrevivente foge quando fica sem munição.
- Uma patrulha investiga tiros disparados nas proximidades.
- Um comerciante oferece recursos em troca de medicamentos.
- Um NPC pede ajuda para encontrar um familiar desaparecido.
- Uma comunidade procura novos integrantes.
- Um grupo hostil prepara uma emboscada.
- Um sobrevivente abandona o grupo se perder a confiança no jogador.

Os NPCs usam navegação, percepção visual e auditiva, memória de curto prazo e objetivos.

Não dependa de chamadas caras de IA generativa para cada ação. Use máquinas de estados, árvores de comportamento ou utility AI e sistemas de decisão locais. Diálogos mais elaborados ficam reservados para situações específicas e devem continuar funcionando offline, a partir de diálogos escritos e montados por regras.

### 8. Eventos dinâmicos no mundo

Crie acontecimentos que ocorram sem intervenção direta do jogador, por exemplo:

- Uma comunidade pede socorro pelo rádio.
- Uma horda invade um bairro.
- Um grupo de sobreviventes encontra uma base abandonada.
- Um comerciante chega a um acampamento.
- Uma facção conquista ou perde território.
- Um veículo com suprimentos aparece numa estrada.
- Um sobrevivente desaparece durante uma expedição.
- Um sinal de rádio indica a localização de um possível abrigo.
- Uma comunidade precisa de combustível para manter um gerador.
- Um avião ou helicóptero é avistado numa região distante. Use o modelo de voo existente para aeronaves controladas pela IA quando isso estiver implementado.

Os acontecimentos ficam registrados no estado do mundo, para que o jogador possa descobrir suas consequências depois.

### 9. Cidades com ciclo de vida

Implemente um ciclo de dia e noite com impacto real na jogabilidade. Evolua os presets de dia e entardecer que já existem para um ciclo contínuo.

Durante o dia:

- Visibilidade maior.
- Exploração mais segura em determinadas áreas.
- Atividade comercial e circulação de sobreviventes.
- Oportunidades de coleta e negociação.

Durante a noite:

- Visibilidade reduzida.
- Necessidade de iluminação.
- Risco maior em certas regiões.
- Sobreviventes procurando abrigo.
- Possibilidade de emboscadas e ataques.

Esses comportamentos devem ser configuráveis, sem obrigar todos os NPCs a seguir a mesma rotina.

### 10. Requisitos técnicos

O jogo continua sendo um mundo 3D em terceira pessoa, com movimentação, combate, sobrevivência, veículos e aeronaves. Para manter o desempenho:

- Use carregamento por regiões, ampliando o sistema de blocos existente.
- Descarregue áreas distantes que não sejam necessárias.
- Use LOD para prédios, objetos e personagens.
- Limite a simulação detalhada de NPCs distantes.
- Use instanciamento para objetos repetidos.
- Implemente navegação para NPCs: grade ou navmesh por região, com portas e escadas como conexões.
- Armazene o estado das regiões visitadas.
- Não processe centenas de NPCs com simulação completa ao mesmo tempo.

NPCs distantes usam simulação simplificada, abstrata e por intervalos. Quando o jogador se aproxima, o sistema ativa os comportamentos detalhados e reconstrói o estado do NPC de forma coerente.

O jogo precisa continuar rodando no navegador e no celular, com uma qualidade "Baixa" jogável.

### 11. Implementação por etapas

Não tente criar tudo de uma vez. Implemente nesta ordem:

1. Uma pequena cidade 3D com ruas, casas e prédios exploráveis.
2. Um personagem controlável em terceira pessoa.
3. Inventário, coleta e sobrevivência.
4. Zumbis com IA básica.
5. Cinco a dez sobreviventes com IA funcional.
6. Diálogos, comércio e recrutamento.
7. Uma base que possa receber companheiros.
8. Facções e eventos dinâmicos.
9. Expansão do mapa e novas cidades.
10. Integração com veículos e com as aeronaves existentes: entrar e sair do caça e decolar de dentro do mundo.
11. Otimização e salvamento persistente.

Ao concluir cada etapa, teste antes de avançar. Cada etapa deve deixar o jogo jogável e manter o simulador de voo funcionando. Escreva testes da lógica pura no Node (IA, sobrevivência, economia e facções) e faça uma verificação no navegador, sem erros no console.

---

## RESULTADO ESPERADO

Quero caminhar por uma cidade abandonada e entrar em prédios. Quero encontrar sobreviventes homens e mulheres, conversar com eles, conquistar sua confiança e recrutá-los. Quero formar um grupo, explorar lugares perigosos, encontrar recursos, construir uma base e participar de conflitos entre comunidades. Quando quiser, quero entrar num caça num aeroporto e voar pelo mesmo mundo.

O mundo deve continuar funcionando mesmo quando eu não estiver vendo cada acontecimento.

**Prioridade máxima:** um mundo explorável e funcional, com NPCs que tenham comportamentos próprios. Uma cidade menor, detalhada e viva vale mais que um mapa gigantesco e vazio.

---

## OBSERVAÇÃO SOBRE A PLATAFORMA

Um mundo com dezenas de prédios com interior, muitos NPCs, zumbis, veículos e aeronaves exige bastante arquitetura e otimização. Se o navegador se tornar um limite real de desempenho (principalmente no celular), registre isso e proponha alternativas, como a migração para Godot ou Unity, em vez de sacrificar a jogabilidade. Até lá, continue no stack atual (Three.js), que já tem terreno, mundo, física de voo e controles funcionando.
