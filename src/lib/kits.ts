import { normalizar } from "./format";

/** Itens do kit cujo nome ainda não existe no lote (comparação sem acento/maiúsculas); também evita repetição dentro do próprio kit. */
export function itensNovosDoKit<T extends { descricao: string }>(existentes: string[], itensKit: T[]): T[] {
  const vistos = new Set(existentes.map(normalizar));
  const novos: T[] = [];
  for (const i of itensKit) {
    const k = normalizar(i.descricao);
    if (!k || vistos.has(k)) continue;
    vistos.add(k);
    novos.push(i);
  }
  return novos;
}
