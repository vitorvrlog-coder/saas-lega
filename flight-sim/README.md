# FALCÃO — Simulador de voo 3D em mundo aberto

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
| `src/main.js` | Cena, câmeras, laço principal, estados e menus |
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

Limitações conhecidas: sem vento/turbulência, sem consumo de combustível, árvores não colidem, sem multijogador, terreno por ruído (não dados reais), uma única aeronave jogável.
