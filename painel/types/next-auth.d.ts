import type { DefaultSession } from "next-auth";

// Estende os tipos do NextAuth com os campos que o Hub usa.
declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & { papel?: string };
  }

  interface User {
    papel?: string;
    /** JWT emitido pelo Worker. Só existe no cookie, nunca na sessão pública. */
    hubToken?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    papel?: string;
    hubToken?: string;
  }
}
