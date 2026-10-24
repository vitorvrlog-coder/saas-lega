// Sessão por cookie assinado com HMAC-SHA256 (Web Crypto: funciona no middleware e no Node).
export const COOKIE_NAME = "sessao";
const DURACAO_MS = 30 * 24 * 60 * 60 * 1000;

async function hmac(valor: string): Promise<string> {
  const segredo = process.env.AUTH_SECRET;
  if (!segredo) throw new Error("AUTH_SECRET não configurado");
  const enc = new TextEncoder();
  const chave = await crypto.subtle.importKey("raw", enc.encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const assinatura = await crypto.subtle.sign("HMAC", chave, enc.encode(valor));
  return Array.from(new Uint8Array(assinatura), (b) => b.toString(16).padStart(2, "0")).join("");
}

function iguais(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function criarToken(): Promise<{ token: string; expira: Date }> {
  const expira = Date.now() + DURACAO_MS;
  return { token: `${expira}.${await hmac(String(expira))}`, expira: new Date(expira) };
}

export async function tokenValido(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const [expira, assinatura] = token.split(".");
  if (!expira || !assinatura || Number(expira) < Date.now()) return false;
  return iguais(assinatura, await hmac(expira));
}

export function senhaCorreta(senha: string): boolean {
  const esperada = process.env.APP_PASSWORD;
  return !!esperada && iguais(senha, esperada);
}
