"use client";

import { useRouter } from "next/navigation";

export function LinhaClicavel({ href, children }: { href: string; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <tr onClick={() => router.push(href)} className="cursor-pointer border-t border-slate-100 hover:bg-sky-50">
      {children}
    </tr>
  );
}
