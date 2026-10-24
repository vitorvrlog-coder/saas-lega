import { PrismaClient, Sistema } from "@prisma/client";

const prisma = new PrismaClient();

type KitSeed = { nome: string; itens: [Sistema, string, number?][] };

const KITS: KitSeed[] = [
  {
    nome: "Frontal leve",
    itens: [
      ["funilaria", "Para-choque dianteiro"],
      ["funilaria", "Grade"],
      ["eletrica", "Farol"],
      ["funilaria", "Suportes e fixadores"],
      ["arrefecimento", "Radiador"],
      ["arrefecimento", "Condensador do A/C"],
    ],
  },
  {
    nome: "Frontal média",
    itens: [
      ["funilaria", "Para-choque dianteiro"],
      ["funilaria", "Capô"],
      ["funilaria", "Grade"],
      ["eletrica", "Farol", 2],
      ["funilaria", "Para-lama"],
      ["estrutura", "Painel frontal / suporte do radiador"],
      ["funilaria", "Alma do para-choque"],
      ["arrefecimento", "Radiador"],
      ["arrefecimento", "Condensador do A/C"],
      ["arrefecimento", "Ventoinha"],
      ["motor", "Intercooler"],
      ["arrefecimento", "Reservatório de expansão"],
      ["estrutura", "Pontas de longarina"],
      ["seguranca", "Airbags e pré-tensionadores"],
    ],
  },
  {
    nome: "Motor desmontado",
    itens: [
      ["motor", "Turbina"],
      ["motor", "Coletor de escape"],
      ["motor", "Coletor de admissão"],
      ["motor", "Intercooler e mangueiras"],
      ["arrefecimento", "Radiador"],
      ["arrefecimento", "Ventoinha"],
      ["eletrica", "Chicote do motor"],
      ["eletrica", "Sensores do motor"],
      ["motor", "Kit juntas, óleo e fluidos"],
    ],
  },
  {
    nome: "Alagamento",
    itens: [
      ["eletrica", "Módulos eletrônicos"],
      ["eletrica", "Chicotes e conectores"],
      ["interior", "Carpete e forrações"],
      ["interior", "Bancos e trilhos"],
      ["motor", "Troca de óleo e fluidos"],
      ["eletrica", "Motor de partida"],
      ["eletrica", "Alternador"],
      ["seguranca", "Airbags"],
    ],
  },
  {
    nome: "Furto recuperado",
    itens: [
      ["eletrica", "Módulo do motor"],
      ["interior", "Central multimídia"],
      ["suspensao_direcao", "Rodas e pneus", 4],
      ["eletrica", "Bateria"],
      ["eletrica", "Faróis", 2],
      ["funilaria", "Retrovisores", 2],
      ["seguranca", "Airbags"],
      ["eletrica", "Chave e codificação"],
    ],
  },
];

async function main() {
  await prisma.parametros.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });

  if ((await prisma.kitDano.count()) === 0) {
    for (const [i, kit] of KITS.entries()) {
      await prisma.kitDano.create({
        data: {
          nome: kit.nome,
          ordem: i,
          itens: {
            create: kit.itens.map(([sistema, descricao, quantidade], j) => ({
              sistema,
              descricao,
              quantidade: quantidade ?? 1,
              ordem: j,
            })),
          },
        },
      });
    }
  }

  const nomeHilux = "Hilux 2026 2.8 diesel — Sodré Santoro, leilão 29137, lote 0222";
  if (!(await prisma.lote.findFirst({ where: { nome: nomeHilux } }))) {
    const itens: [Sistema, string, "observado" | "inferido"][] = [
      ["motor", "Turbina", "observado"],
      ["motor", "Coletor de escape", "observado"],
      ["arrefecimento", "Radiador", "inferido"],
      ["arrefecimento", "Condensador do A/C", "inferido"],
      ["arrefecimento", "Ventoinha", "inferido"],
      ["motor", "Intercooler e mangueiras", "inferido"],
      ["eletrica", "Bateria", "inferido"],
      ["motor", "Capa do motor", "observado"],
      ["motor", "Kit juntas, óleo e fluidos", "observado"],
    ];
    await prisma.lote.create({
      data: {
        nome: nomeHilux,
        leiloeiro: "Sodré Santoro",
        numeroLote: "0222",
        marca: "Toyota",
        modelo: "Hilux",
        ano: 2026,
        motorCambio: "2.8 diesel",
        tipoDano: "Peças retiradas do motor",
        status: "avaliando",
        docSituacao: "pendente",
        docNotas: "Confirmar no edital: monta/condição e possibilidade de transferência",
        observacoes: "Leilão 29137. Origem e condição a preencher.",
        itens: {
          create: itens.map(([sistema, descricao, informacao], i) => ({
            sistema,
            descricao,
            informacao,
            situacao: "ausente",
            quantidade: 1,
            validado: false,
            ordem: i,
          })),
        },
        riscos: {
          create: [
            { nome: "Dano interno no motor por lubrificação/turbo retirado", chancePct: 25, ordem: 0 },
            { nome: "Chicote e sensores danificados na desmontagem", chancePct: 30, ordem: 1 },
            { nome: "Dano estrutural frontal", chancePct: 20, ordem: 2 },
          ],
        },
      },
    });
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
