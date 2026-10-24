"use client";

import { useEffect, useState } from "react";
import type { Entidade } from "@/lib/campos";
import { decimalParaInput, parseDecimalBR } from "@/lib/format";
import { useAutoSave } from "./salvamento";

type Base<T> = {
  entidade: Entidade;
  id: string;
  campo: string;
  valor: T;
  onChange?: (v: T) => void;
  rotulo?: string;
  dica?: string;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
};

const inputCls =
  "w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:bg-slate-100";

export function Rotulo({
  rotulo,
  dica,
  erro,
  children,
  className = "",
}: {
  rotulo?: string;
  dica?: string;
  erro?: string | null;
  children: React.ReactNode;
  className?: string;
}) {
  if (!rotulo) return <>{children}</>;
  return (
    <label className={`block ${className}`}>
      <span className="mb-0.5 block text-xs font-medium text-slate-600">{rotulo}</span>
      {children}
      {erro ? <span className="text-xs text-red-600">{erro}</span> : dica ? <span className="text-xs text-slate-500">{dica}</span> : null}
    </label>
  );
}

export function CampoTexto({ multilinha, ...p }: Base<string | null> & { multilinha?: boolean }) {
  const { agendar, flush, erro } = useAutoSave(p.entidade, p.id, p.campo);
  const [texto, setTexto] = useState(p.valor ?? "");
  const [foco, setFoco] = useState(false);
  useEffect(() => {
    if (!foco) setTexto(p.valor ?? "");
  }, [p.valor, foco]);
  const mudar = (v: string) => {
    setTexto(v);
    p.onChange?.(v === "" ? null : v);
    agendar(v);
  };
  const comum = {
    value: texto,
    placeholder: p.placeholder,
    disabled: p.disabled,
    onFocus: () => setFoco(true),
    onBlur: () => {
      setFoco(false);
      flush();
    },
    className: `${inputCls} ${erro ? "border-red-500" : ""} ${p.rotulo ? "" : p.className ?? ""}`,
  };
  return (
    <Rotulo rotulo={p.rotulo} dica={p.dica} erro={erro} className={p.className}>
      {multilinha ? (
        <textarea rows={3} {...comum} onChange={(e) => mudar(e.target.value)} />
      ) : (
        <input type="text" {...comum} onChange={(e) => mudar(e.target.value)} />
      )}
    </Rotulo>
  );
}

/** Número em formato brasileiro. `valor` é a string decimal canônica ("1234.5") ou null. */
export function CampoDecimal({ casas = 2, prefixo, ...p }: Base<string | null> & { casas?: number; prefixo?: string }) {
  const { agendar, flush, erro } = useAutoSave(p.entidade, p.id, p.campo);
  const [texto, setTexto] = useState(decimalParaInput(p.valor, casas));
  const [foco, setFoco] = useState(false);
  const [invalido, setInvalido] = useState(false);
  useEffect(() => {
    if (!foco) setTexto(decimalParaInput(p.valor, casas));
  }, [p.valor, foco, casas]);
  const mudar = (v: string) => {
    setTexto(v);
    const canon = parseDecimalBR(v);
    if (v.trim() !== "" && canon === null) {
      setInvalido(true);
      return;
    }
    setInvalido(false);
    p.onChange?.(canon);
    agendar(canon);
  };
  return (
    <Rotulo rotulo={p.rotulo} dica={p.dica} erro={invalido ? "Número inválido" : erro} className={p.className}>
      <div className={`relative ${p.rotulo ? "" : p.className ?? ""}`}>
        {prefixo && (
          <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-xs text-slate-400">
            {prefixo}
          </span>
        )}
        <input
          type="text"
          inputMode="decimal"
          value={texto}
          placeholder={p.placeholder}
          disabled={p.disabled}
          onFocus={() => setFoco(true)}
          onBlur={() => {
            setFoco(false);
            flush();
          }}
          onChange={(e) => mudar(e.target.value)}
          className={`${inputCls} text-right tabular-nums ${prefixo ? "pl-7" : ""} ${invalido || erro ? "border-red-500" : ""}`}
        />
      </div>
    </Rotulo>
  );
}

export function CampoInteiro(p: Base<number | null>) {
  const { agendar, flush, erro } = useAutoSave(p.entidade, p.id, p.campo);
  const [texto, setTexto] = useState(p.valor?.toString() ?? "");
  return (
    <Rotulo rotulo={p.rotulo} dica={p.dica} erro={erro} className={p.className}>
      <input
        type="text"
        inputMode="numeric"
        value={texto}
        placeholder={p.placeholder}
        onBlur={flush}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, "");
          setTexto(v);
          p.onChange?.(v === "" ? null : Number(v));
          agendar(v);
        }}
        className={`${inputCls} tabular-nums`}
      />
    </Rotulo>
  );
}

export function CampoData(p: Base<string | null>) {
  const { agendar, erro } = useAutoSave(p.entidade, p.id, p.campo);
  return (
    <Rotulo rotulo={p.rotulo} dica={p.dica} erro={erro} className={p.className}>
      <input
        type="date"
        value={p.valor ?? ""}
        onChange={(e) => {
          const v = e.target.value || null;
          p.onChange?.(v);
          agendar(v, true);
        }}
        className={inputCls}
      />
    </Rotulo>
  );
}

export function CampoSelect<T extends string>({
  opcoes,
  vazio,
  ...p
}: Base<T | null> & { opcoes: Record<T, string>; vazio?: string }) {
  const { agendar, erro } = useAutoSave(p.entidade, p.id, p.campo);
  return (
    <Rotulo rotulo={p.rotulo} dica={p.dica} erro={erro} className={p.className}>
      <select
        value={p.valor ?? ""}
        disabled={p.disabled}
        onChange={(e) => {
          const v = (e.target.value || null) as T | null;
          p.onChange?.(v);
          agendar(v, true);
        }}
        className={`${inputCls} ${p.rotulo ? "" : p.className ?? ""}`}
      >
        {vazio !== undefined && <option value="">{vazio}</option>}
        {(Object.entries(opcoes) as [T, string][]).map(([k, r]) => (
          <option key={k} value={k}>
            {r}
          </option>
        ))}
      </select>
    </Rotulo>
  );
}

export function CampoBool(p: Base<boolean>) {
  const { agendar } = useAutoSave(p.entidade, p.id, p.campo);
  return (
    <label className={`inline-flex items-center gap-1.5 text-sm ${p.className ?? ""}`}>
      <input
        type="checkbox"
        checked={p.valor}
        onChange={(e) => {
          p.onChange?.(e.target.checked);
          agendar(e.target.checked, true);
        }}
        className="h-4 w-4 accent-sky-600"
      />
      {p.rotulo}
    </label>
  );
}
