"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { salvarCampo } from "@/lib/actions/campo";
import type { Entidade } from "@/lib/campos";

type Estado = { pendentes: number; erro: string | null; salvoEm: number | null };

const Ctx = createContext<{
  estado: Estado;
  rastrear: <T>(p: Promise<T>, erroDe?: (r: T) => string | null) => Promise<T>;
} | null>(null);

export function SalvamentoProvider({ children }: { children: React.ReactNode }) {
  const [estado, setEstado] = useState<Estado>({ pendentes: 0, erro: null, salvoEm: null });

  const rastrear = useCallback(async <T,>(p: Promise<T>, erroDe?: (r: T) => string | null) => {
    setEstado((e) => ({ ...e, pendentes: e.pendentes + 1 }));
    try {
      const r = await p;
      const erro = erroDe?.(r) ?? null;
      setEstado((e) => ({ pendentes: e.pendentes - 1, erro, salvoEm: erro ? e.salvoEm : Date.now() }));
      return r;
    } catch (err) {
      setEstado((e) => ({ ...e, pendentes: e.pendentes - 1, erro: "Erro de conexão ao salvar" }));
      throw err;
    }
  }, []);

  // Avisa antes de sair da página com salvamento pendente.
  useEffect(() => {
    const h = (ev: BeforeUnloadEvent) => {
      if (estado.pendentes > 0) ev.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [estado.pendentes]);

  return <Ctx.Provider value={{ estado, rastrear }}>{children}</Ctx.Provider>;
}

export function useRastrear() {
  const c = useContext(Ctx);
  if (!c) throw new Error("SalvamentoProvider ausente");
  return c.rastrear;
}

export function IndicadorSalvamento() {
  const c = useContext(Ctx);
  if (!c) return null;
  const { pendentes, erro, salvoEm } = c.estado;
  if (pendentes > 0) return <span className="text-xs text-amber-700">● Salvando…</span>;
  if (erro) return <span className="text-xs text-red-700">● {erro}</span>;
  if (salvoEm) return <span className="text-xs text-emerald-700">✓ Salvo</span>;
  return null;
}

/**
 * Agenda o salvamento de um campo com debounce. `agendar(valor)` espera 600 ms sem novas alterações;
 * `agendar(valor, true)` salva na hora. Alterações pendentes são enviadas ao desmontar.
 */
export function useAutoSave(entidade: Entidade, id: string, campo: string) {
  const rastrear = useRastrear();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendente = useRef<{ valor: unknown } | null>(null);
  const fila = useRef<Promise<unknown>>(Promise.resolve());
  const [erro, setErro] = useState<string | null>(null);

  const enviar = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const p = pendente.current;
    if (!p) return;
    pendente.current = null;
    // Encadeia para manter a ordem das gravações do mesmo campo.
    fila.current = fila.current
      .catch(() => {})
      .then(() =>
        rastrear(salvarCampo(entidade, id, campo, p.valor), (r) => (r.ok ? null : r.erro)).then((r) =>
          setErro(r.ok ? null : r.erro),
        ),
      );
  }, [entidade, id, campo, rastrear]);

  const agendar = useCallback(
    (valor: unknown, imediato = false) => {
      pendente.current = { valor };
      if (timer.current) clearTimeout(timer.current);
      if (imediato) enviar();
      else timer.current = setTimeout(enviar, 600);
    },
    [enviar],
  );

  useEffect(() => () => enviar(), [enviar]);

  return { agendar, flush: enviar, erro };
}
