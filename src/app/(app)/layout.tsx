import Link from "next/link";
import { IndicadorSalvamento, SalvamentoProvider } from "@/components/salvamento";
import { sair } from "@/lib/actions/auth";
import { Nav } from "@/components/nav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SalvamentoProvider>
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-2">
          <Link href="/" className="font-semibold text-slate-900">
            Leilão
          </Link>
          <div className="hidden sm:block">
            <Nav />
          </div>
          <div className="ml-auto flex items-center gap-3">
            <IndicadorSalvamento />
            <form action={sair}>
              <button className="text-xs text-slate-500 hover:text-slate-800">Sair</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 pt-4 pb-24 sm:pb-8">{children}</main>
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white sm:hidden">
        <Nav mobile />
      </div>
    </SalvamentoProvider>
  );
}
