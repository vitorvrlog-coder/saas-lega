import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_NAME, tokenValido } from "@/lib/auth";

export async function middleware(req: NextRequest) {
  if (await tokenValido(req.cookies.get(COOKIE_NAME)?.value)) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // Tudo exige login, exceto a tela de login, arquivos do Next e as páginas estáticas públicas.
  matcher: ["/((?!login|_next/|favicon.ico|terms.html|privacy.html|delete-data.html).*)"],
};
