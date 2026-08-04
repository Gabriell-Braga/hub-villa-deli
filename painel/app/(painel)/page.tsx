import { redirect } from "next/navigation";

// A home do painel é a fila de pedidos — é onde o atendente passa o turno.
export default function Home() {
  redirect("/pedidos");
}
