// Tipos serializáveis (Decimal → string, Date → "AAAA-MM-DD") e rótulos em pt-BR.

export const STATUS = {
  triagem: "Triagem",
  avaliando: "Avaliando",
  dar_lance: "Dar lance",
  descartado: "Descartado",
  perdido: "Perdido",
  arrematado: "Arrematado",
  vendido: "Vendido",
} as const;
export type Status = keyof typeof STATUS;

export const ORIGEM = {
  seguradora: "Seguradora",
  financeira: "Financeira",
  locadora: "Locadora",
  orgao_publico: "Órgão público",
  outro: "Outro",
} as const;

export const SITUACAO_DOC = { pendente: "Pendente", verificada: "Verificada", bloqueada: "Bloqueada" } as const;
export type SituacaoDoc = keyof typeof SITUACAO_DOC;

export const SISTEMA = {
  motor: "Motor",
  arrefecimento: "Arrefecimento",
  eletrica: "Elétrica",
  funilaria: "Funilaria",
  estrutura: "Estrutura",
  suspensao_direcao: "Suspensão/Direção",
  transmissao: "Transmissão",
  interior: "Interior",
  seguranca: "Segurança",
  outros: "Outros",
} as const;
export type Sistema = keyof typeof SISTEMA;

export const SITUACAO_ITEM = {
  ausente: "Ausente",
  danificado: "Danificado",
  reparar: "Reparar",
  inspecionar: "Inspecionar",
  ok: "OK",
} as const;
export type SituacaoItem = keyof typeof SITUACAO_ITEM;

export const INFORMACAO = { observado: "Observado", inferido: "Inferido" } as const;

export const TIPO_PECA = { original: "Original", paralela: "Paralela", usada: "Usada" } as const;
export type TipoPeca = keyof typeof TIPO_PECA;

export type D = string | null; // decimal serializado

export type ParametrosDTO = {
  horaOficina: string;
  lucroMinimo: string;
  comissaoPct: string;
  taxasLeilao: string;
  transporte: string;
  documentacao: string;
  custosVenda: string;
  custoCapital: string;
  tributos: string;
};

export type ItemDTO = {
  id: string;
  loteId: string;
  ordem: number;
  sistema: Sistema;
  descricao: string;
  situacao: SituacaoItem;
  informacao: keyof typeof INFORMACAO;
  quantidade: string;
  precoOriginal: D;
  precoParalela: D;
  precoUsada: D;
  tipoProvavel: TipoPeca | null;
  horasMO: D;
  agregados: D;
  fontePreco: string | null;
  validado: boolean;
  custoReal: D;
};

export type RiscoDTO = { id: string; loteId: string; ordem: number; nome: string; chancePct: D; custo: D };

export type LoteDTO = {
  id: string;
  nome: string;
  leiloeiro: string | null;
  numeroLote: string | null;
  link: string | null;
  marca: string | null;
  modelo: string | null;
  versao: string | null;
  ano: number | null;
  motorCambio: string | null;
  km: number | null;
  origem: keyof typeof ORIGEM | null;
  tipoDano: string | null;
  condicaoEdital: string | null;
  lanceAtual: D;
  dataLeilao: string | null;
  cidadePatio: string | null;
  observacoes: string | null;
  status: Status;
  motivoDescarte: string | null;
  valorPerdido: D;
  docSituacao: SituacaoDoc;
  docNotas: string | null;
  fipe: D;
  vendaProvavel: D;
  vendaRapida: D;
  notasVenda: string | null;
  lucroMinimo: D;
  comissaoPct: D;
  taxasLeilao: D;
  transporte: D;
  documentacao: D;
  custosVenda: D;
  custoCapital: D;
  tributos: D;
  lanceArrematado: D;
  dataArremate: string | null;
  taxasReais: D;
  transporteReal: D;
  documentacaoReal: D;
  outrosGastos: D;
  precoVenda: D;
  dataVenda: string | null;
  custosVendaReais: D;
  createdAt: string;
  updatedAt: string;
};

export type LoteCompletoDTO = LoteDTO & { itens: ItemDTO[]; riscos: RiscoDTO[] };

export type CotacaoDTO = {
  id: string;
  peca: string;
  modelo: string | null;
  tipo: TipoPeca;
  preco: string;
  fornecedor: string;
  link: string | null;
  data: string;
  observacao: string | null;
  createdAt: string;
};

export function posCompraAtivo(status: Status): boolean {
  return status === "arrematado" || status === "vendido";
}
