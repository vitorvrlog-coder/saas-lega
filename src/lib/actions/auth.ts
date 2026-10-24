"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME, criarToken, senhaCorreta } from "@/lib/auth";

export async function entrar(_: string | null, form: FormData): Promise<string | null> {
  if (!senhaCorreta(String(form.get("senha") ?? ""))) return "Senha incorreta";
  const { token, expira } = await criarToken();
  (await cookies()).set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: expira,
    path: "/",
  });
  redirect("/");
}

export async function sair() {
  (await cookies()).delete(COOKIE_NAME);
  redirect("/login");
}
