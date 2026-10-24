"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITENS = [
  { href: "/", rotulo: "Painel" },
  { href: "/lotes", rotulo: "Lotes" },
  { href: "/pecas", rotulo: "Peças" },
  { href: "/parametros", rotulo: "Parâmetros" },
  { href: "/kits", rotulo: "Kits" },
];

export function Nav({ mobile }: { mobile?: boolean }) {
  const path = usePathname();
  const ativo = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <nav className={mobile ? "grid grid-cols-5" : "flex gap-1"}>
      {ITENS.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          className={
            mobile
              ? `py-3 text-center text-xs ${ativo(i.href) ? "font-semibold text-sky-700" : "text-slate-600"}`
              : `rounded-md px-3 py-1.5 text-sm ${ativo(i.href) ? "bg-sky-50 font-medium text-sky-700" : "text-slate-600 hover:bg-slate-100"}`
          }
        >
          {i.rotulo}
        </Link>
      ))}
    </nav>
  );
}
