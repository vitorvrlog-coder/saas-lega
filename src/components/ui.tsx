export function Bloco({
  titulo,
  acoes,
  children,
  className = "",
}: {
  titulo?: React.ReactNode;
  acoes?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-lg border border-slate-200 bg-white p-4 shadow-sm ${className}`}>
      {(titulo || acoes) && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {titulo && <h2 className="text-base font-semibold text-slate-800">{titulo}</h2>}
          {acoes && <div className="ml-auto flex flex-wrap gap-2">{acoes}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Botao({
  variante = "secundario",
  className = "",
  ...p
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variante?: "primario" | "secundario" | "perigo" | "link" }) {
  const v = {
    primario: "bg-sky-600 text-white hover:bg-sky-700",
    secundario: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
    perigo: "border border-red-200 bg-white text-red-700 hover:bg-red-50",
    link: "text-sky-700 hover:underline px-1",
  }[variante];
  return (
    <button
      {...p}
      className={`rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${v} ${className}`}
    />
  );
}

export function Selo({ cor = "cinza", children }: { cor?: "cinza" | "verde" | "vermelho" | "amarelo" | "azul"; children: React.ReactNode }) {
  const c = {
    cinza: "bg-slate-100 text-slate-700",
    verde: "bg-emerald-100 text-emerald-800",
    vermelho: "bg-red-100 text-red-800",
    amarelo: "bg-amber-100 text-amber-800",
    azul: "bg-sky-100 text-sky-800",
  }[cor];
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${c}`}>{children}</span>;
}
