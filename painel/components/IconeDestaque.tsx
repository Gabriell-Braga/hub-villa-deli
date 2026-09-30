// ---------------------------------------------------------------------------
// Ícone grande de estado vazio / confirmação, num círculo neutro.
//
// Substitui os emojis que existiam nesses lugares (📭, 🔎, ✅...). Emoji muda
// de desenho conforme o sistema operacional, não segue a paleta do painel e é
// o sinal mais rápido de "tela feita às pressas".
// ---------------------------------------------------------------------------

const TRACOS: Record<string, string[]> = {
  caixa: ["M22 12h-6l-2 3h-4l-2-3H2", "M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"],
  busca: ["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z", "m21 21-4.35-4.35"],
  email: ["M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z", "m22 6-10 7L2 6"],
  link: ["M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71", "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"],
  ok: ["M20 6 9 17l-5-5"],
};

export default function IconeDestaque({
  nome,
  tom = "neutro",
}: {
  nome: keyof typeof TRACOS;
  tom?: "neutro" | "sucesso";
}) {
  return (
    <span
      className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full ring-1 ring-inset ${
        tom === "sucesso"
          ? "bg-emerald-50 text-emerald-600 ring-emerald-100"
          : "bg-gray-100 text-gray-500 ring-gray-200"
      }`}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
      >
        {TRACOS[nome].map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    </span>
  );
}
