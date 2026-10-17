# FALCÃO — Sobrevivência em mundo aberto + simulador de voo 3D

Dois modos no mesmo mundo:

- **NOVO JOGO (sobrevivência):** em terceira pessoa na Vila Esperança, uma cidade pós-apocalíptica ao lado do aeroporto. Há prédios com interiores e vários andares, zumbis, sobreviventes com IA (homens e mulheres), facções, comércio, missões, companheiros, base, ciclo dia/noite, picape e o caça do aeroporto.
- **VOO LIVRE:** o simulador de voo original (decolagem, voo e pouso com avaliação).

## Modo sobrevivência

**O mundo**
- **Vila Esperança:** 12 prédios exploráveis com portas, janelas, salas, escadas e telhados:
  - Hospital São Lucas (2 andares, com farmácia trancada);
  - Supermercado;
  - Delegacia (com arsenal trancado);
  - Edifício Aurora (4 andares e telhado);
  - cinco casas;
  - Oficina Mecânica;
  - Loja do Posto;
  - Galpão.
- **Interiores:** os interiores são modulares e cada andar é uma única malha. Os andares acima de você somem quando você está dentro do prédio.
- **Saque:** são 109 móveis com saque gerado por tipo de lugar. Hospital tem remédios, mercado tem comida, delegacia tem armas e oficina tem peças. Há também anotações com histórias dos antigos moradores.
- **Arredores:** a vila tem ruas, carros abandonados, o posto com cobertura e bombas, e o acampamento cercado da Colina Verde (barracas, horta e gerador). A estrada leva ao aeroporto, onde o caça F-X fica estacionado no pátio.

**Sobreviventes (IA)**
- **Quem são:** 14 personagens adultos com nome, idade, aparência, personalidade (coragem, generosidade, lealdade, sociabilidade), especialização, inventário, necessidades (fome, sede, sono), rotina e memória das suas ações.
- **Especializações:** médica, engenheira(o), atiradora, mecânica, exploradora, agricultora, comerciante, líder e outras. Nenhuma função depende do gênero.
- **Comportamento:**
  - usam navegação (grade multinível + A*, inclusive escadas e portas), visão e audição;
  - saqueiam prédios, trabalham na horta, patrulham, comerciam, conversam entre si e tratam feridos;
  - fogem quando ficam sem munição e lutam contra zumbis;
  - de noite voltam para casa e dormem.
- **Relações:** amizades, rivalidades e casais entre NPCs. Eles discutem por comida quando ela falta e reagem à morte de amigos.
- **Desempenho:** perto do jogador a simulação é detalhada. Longe, ela é simplificada.

**Facções:**
- **Colina Verde:** agricultores.
- **Mercadores do Posto:** comerciantes.
- **Clínica São Lucas:** comunidade médica.
- **Os Corvos:** saqueadores hostis.

Cada facção tem território, recursos, moral, reputação com você e relações com as outras. Os Corvos atacam outras comunidades e a sua base.

**Você:**
- **Sobrevivência:** vida, fome, sede, energia, sangramento e infecção por mordida (curada com antibiótico).
- **Inventário:** com peso. Dá para criar itens (receitas).
- **Combate:** armas brancas e de fogo, com munição, recarga e tiro na cabeça. O barulho atrai zumbis.
- **Interações:**
  - abrir e fechar portas (as trancadas pedem chave ou pé de cabra);
  - vasculhar móveis;
  - pular janelas;
  - revistar corpos;
  - consertar e abastecer a picape;
  - pegar combustível no posto;
  - abastecer o gerador da Colina;
  - entrar no caça.
- **Diálogos:** quem é você, situação, comércio (preço depende da confiança e da reputação), missões, presentes, conversa, recrutamento, ordens aos companheiros (seguir, esperar, defender, ir para a base, trocar equipamento) e relacionamento consensual entre adultos quando há afinidade e confiança.
- **Missões:** pessoais e de facção. Por exemplo: remédio para o Carlos, peças para o Rafael, combustível para o gerador da Colina, resgatar a Ana, limpar o Edifício Aurora, achar a chave do arsenal e ajudar a Kátia a deixar os Corvos.
- **Base:** reivindique uma casa, a oficina, o Aurora ou o galpão. Construa barricadas, muros, armadilhas, depósito, enfermaria, oficina, horta, tanque de água, gerador e torre de vigia. Os moradores recebem funções (guarda, agricultor, médico, mecânico, explorador), consomem comida e água do depósito e vão embora se faltar recurso. Também dá para dormir até o amanhecer.
- **Eventos dinâmicos:** hordas, pedidos de socorro pelo rádio, caixas de suprimentos, sobreviventes desaparecidos, comerciante itinerante, ataques dos Corvos, avião no céu e outros. Tudo fica registrado no diário (M).
- **Dia e noite:** o ciclo é contínuo. À noite enxerga-se menos, a lanterna ajuda e nascem mais zumbis.
- **Salvamento:** automático a cada 2 minutos e ao dormir. Também dá para salvar no menu de pausa ou da base. **CONTINUAR** carrega o jogo salvo.

**Controles a pé:**

| Ação | Tecla |
|---|---|
| Andar, correr, agachar, pular | WASD, Shift, C, Espaço |
| Câmera, atacar, mirar | mouse, clique esquerdo, clique direito |
| Interagir, recarregar, curar | E, R, Q |
| Mochila, mapa e diário, grupo, base | Tab ou I, M, G, B |
| Lanterna, trocar arma, pausa | F, 1–5, P ou Esc |
| Sair do caça (parado no solo) | X |

No celular, use o joystick à esquerda, arraste para girar a câmera e use os botões à direita.


Simulador de voo no navegador (Three.js + WebGL), com física de voo própria em JavaScript, relevo infinito gerado por regiões, aeroportos com pista, torre e hangares, cidades, rios, lagos, vegetação, cockpit funcional e HUD.

## Como executar

**Opção 1 — arquivo único (mais simples):** abra `dist/falcao-simulador.html` no navegador (clique duas vezes). Tudo (CSS, JS e Three.js) está embutido; não precisa de internet nem de servidor.

**Opção 2 — projeto modular:** abra `index.html` diretamente no navegador (os scripts são clássicos, funcionam em `file://`) ou sirva a pasta:

```bash
cd flight-sim
python3 -m http.server 8080     # depois acesse http://localhost:8080
```

Para regenerar o arquivo único depois de editar o código: `node build.js`.

> Use Chrome, Edge, Firefox ou Safari recentes com WebGL. Para desempenho ruim, abra **Configurações → Qualidade gráfica → Baixa**.

## Estrutura

| Arquivo | Função |
|---|---|
| `index.html`, `styles.css` | Interface, menus (PT-BR), widgets de manche/manete |
| `src/util.js` | Vetores, quaternions, ruído determinístico |
| `src/terrain.js` | Relevo infinito (`heightAt`), aeroportos, cidades, colisores, superfícies — sem THREE |
| `src/flightPhysics.js` | Modelo de voo 6-DOF, motores, trem de pouso com suspensão, colisões, avaliação de pouso — sem THREE |
| `src/world.js` | Blocos de terreno em streaming, água, céu, nuvens, árvores instanciadas, cidades, estradas, aeroportos |
| `src/aircraft.js` | Modelo 3D do caça e estrutura do cockpit |
| `src/controls.js` | Teclado, mouse (Pointer Lock), manche/manete virtuais, toque, remapeamento |
| `src/hud.js` | Instrumentos do painel e HUD de simulação |
| `src/audio.js` | Som procedural (WebAudio) |
| `src/settings.js` | Configurações persistentes |
| `src/town.js` | Vila Esperança: prédios modulares, colisão, linha de visada e navegação multinível (A*), sem THREE |
| `src/items.js` | Itens, saque por região, inventário, receitas e estruturas da base |
| `src/sim.js` | Mundo vivo: zumbis, sobreviventes com IA, facções, relações, missões, eventos e base, sem THREE |
| `src/dialogue.js` | Diálogos, comércio, recrutamento e relacionamentos |
| `src/humanoid.js` | Personagens 3D com animação procedural |
| `src/townRender.js` | Malhas da vila (andares fundidos, portas, vidros, ruas, objetos) |
| `src/foot.js` | Modo a pé: controle, câmera, combate, interações, interface, picape, base e salvamento |
| `src/main.js` | Cena, câmeras, laço principal, estados e menus |
| `tests/run.js` | Testes da lógica (`node tests/run.js`) |
| `assets/vendor/three.min.js` | Three.js r128 (local) |
| `build.js` | Gera `dist/falcao-simulador.html` |

Novos aeroportos: acrescente uma entrada em `AIRPORT_DEFS` (`src/terrain.js`) — pista, taxiways, pátio, hangares, torre, luzes e colisores são gerados automaticamente. Novas cidades: `CITY_DEFS`.

## Controles (padrão — todos remapeáveis em CONTROLES)

| Ação | Tecla |
|---|---|
| Aumentar / reduzir potência | **W** / **S** (ou roda do mouse) |
| Arfagem (nariz) | Mouse ↕ (para baixo = puxar) · setas ↑/↓ |
| Inclinação lateral | Mouse ↔ · setas ←/→ |
| Leme | **A** / **D** |
| Trim de arfagem | **Q** (nariz para baixo) / **E** (nariz para cima) |
| Trem de pouso | **F** |
| Flaps (recolhido → decolagem → aproximação → pouso) | **G** |
| Freios de roda (segurar) | **B** |
| Ligar / desligar motores | **R** |
| Pausa | **Espaço** |
| Alternar câmera externa (terceira pessoa → perseguição → livre) | **C** |
| Cockpit ↔ visão externa | **V** |
| Selecionar aeroporto de destino | **N** |
| Mostrar/ocultar HUD | **H** |
| Liberar mouse e abrir menu | **Esc** |

Clique na tela para capturar o mouse. Se o navegador não permitir Pointer Lock, o manche segue a posição do cursor, e o manche/manete na tela podem ser arrastados. No celular há manche, manete, pedais e botões na tela.

## Primeiro voo

1. **INICIAR VOO → DECOLAR** (você começa na cabeceira; há o parque de estacionamento como alternativa).
2. **R** liga os motores (≈ 6 s). O freio de estacionamento solta ao passar de 30 % de potência.
3. **W** até 100 %. O avião acelera progressivamente.
4. Em ~280 km/h puxe o manche suavemente (mouse para baixo / seta ↓). Ele decola sozinho pela sustentação.
5. **F** recolhe o trem (antes de 665 km/h). **G** ajusta os flaps.
6. Para pousar: **N** seleciona o destino; siga o rumo e o ILS simples (cruz rosa/ciano no HUD). Trem fora, flaps em POUSO, ≈ 260–290 km/h, razão de descida ≤ 3 m/s no toque; depois **S** e **B**.

## Física — como funciona e limitações

- **Integração:** passo fixo de 1/240 s (acumulador + interpolação visual), independente da taxa de quadros.
- **Aerodinâmica:** sustentação, arrasto (parasita, induzido, onda transônica, trem, flaps, efeito solo), força lateral, momentos de arfagem/rolagem/guinada com estabilidade estática e amortecimento. Densidade e velocidade do som variam com a altitude.
- **Estol:** ao passar do ângulo de ataque crítico (≈ 17°, maior com flaps) a sustentação cai, o arrasto sobe, surge um momento de nariz para baixo e uma queda de asa; vibração da câmera e alertas avisam antes.
- **Controles:** a autoridade das superfícies diminui com a velocidade (como no War Thunder), o manche tem zona neutra, curva suave e retorno ao centro ajustáveis.
- **Motores:** resposta com atraso (spool), pós-combustor acima de 80 %, partida de 6 s, superaquecimento por pós-combustor prolongado e queda de empuxo com a altitude.
- **Solo:** suspensão por mola-amortecedor em cada roda, atrito de rolamento/lateral/freio por tipo de superfície (asfalto, grama, areia), esterçamento da roda do nariz, pouso de barriga se o trem estiver recolhido.
- **Limites:** trem danificado acima de 665 km/h, flaps arrancados acima de 790 km/h, dano por mais de ~11 G ou acima de ~1 500 km/h.
- **Pouso:** a avaliação (PERFEITO / SEGURO / BRUSCO / ACIDENTE) vem da razão de descida, velocidade e inclinação no toque, alinhamento e desvio do eixo da pista, configuração e posição; acidentes destroem a aeronave.

Limitações conhecidas:
- **Voo:** não há vento nem turbulência, nem consumo de combustível no caça.
- **Mundo:** árvores não colidem, o terreno é gerado por ruído e há uma única aeronave jogável.
- **Sobrevivência:**
  - só os 12 prédios da Vila Esperança têm interior; as cidades distantes são cenário;
  - há uma única cidade jogável;
  - os diálogos são escritos e montados por regras (funcionam offline, sem IA generativa);
  - as "vozes" usam a síntese de voz do navegador;
  - os personagens são low-poly com animação procedural;
  - a picape usa física simplificada.

## Testes realizados

Física (Node, sem navegador — `FS.FlightModel` isolado): sinais de comando (rolagem à direita → inclinação positiva, puxar → arfagem positiva, leme à direita → rumo aumenta), taxas de rolagem por velocidade, g máximo por velocidade, velocidade máxima (≈ 1 260 km/h), decolagem completa (liftoff ≈ 378 km/h após ≈ 520 m), estol e recuperação, pouso automatizado com avaliação, frenagem até parar, táxi com esterçamento, pouso de barriga, colisão com edifício, inércia ao soltar os comandos.

Navegador (Chromium headless com WebGL por software): abertura sem erros de console, menus, decolagem real via teclado (R, W, setas, F), quatro câmeras, cockpit com instrumentos, pausa congelando a simulação, acidente (painel + reinício), pouso com painel de avaliação e frenagem até parar, layout em celular vertical/horizontal com toque, qualidade Alta com sombras e horário de entardecer.

Não verificados por falta de hardware no ambiente de teste: taxa de quadros em GPU real/celulares, som (WebAudio) e captura real do mouse (Pointer Lock).
