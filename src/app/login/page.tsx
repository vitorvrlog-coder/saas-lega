"use client";

import { useActionState } from "react";
import { entrar } from "@/lib/actions/auth";

export default function Login() {
  const [erro, acao, enviando] = useActionState(entrar, null);
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form action={acao} className="w-full max-w-xs space-y-3 rounded-lg bg-white p-6 shadow">
        <h1 className="text-lg font-semibold">Avaliador de Leilão</h1>
        <input
          name="senha"
          type="password"
          placeholder="Senha"
          autoFocus
          className="w-full rounded-md border border-slate-300 px-3 py-2"
        />
        {erro && <p className="text-sm text-red-600">{erro}</p>}
        <button disabled={enviando} className="w-full rounded-md bg-sky-600 py-2 font-medium text-white disabled:opacity-60">
          Entrar
        </button>
      </form>
    </main>
  );
}
