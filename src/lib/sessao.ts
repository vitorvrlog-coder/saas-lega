import "server-only";
import { cookies } from "next/headers";
import { COOKIE_NAME, tokenValido } from "./auth";

/** Defesa em profundidade: toda server action verifica a sessão, além do middleware. */
export async function exigirLogin() {
  if (!(await tokenValido((await cookies()).get(COOKIE_NAME)?.value))) throw new Error("Não autenticado");
}
