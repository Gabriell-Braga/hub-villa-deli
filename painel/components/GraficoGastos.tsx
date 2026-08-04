"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Estatisticas } from "@/lib/tipos";
import { COR_PROVEDOR } from "@/lib/tipos";
import { brl, diaCurto } from "@/lib/formato";
import { MARCA } from "@/config/marca";

// ---------------------------------------------------------------------------
// Gráficos do relatório (Recharts).
//
// Ficam em componente "use client" separado de propósito: Recharts só roda no
// browser, e isolar aqui evita transformar a página inteira em client component.
// ---------------------------------------------------------------------------

const EIXO = { fontSize: 12, fill: "#9CA3AF" };

function CaixaTooltip({
  active,
  payload,
  label,
  formatar,
}: {
  active?: boolean;
  payload?: Array<{ value: number; name: string }>;
  label?: string;
  formatar: (v: number) => string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-md">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="text-sm font-semibold text-gray-900">
          {formatar(p.value)}
        </p>
      ))}
    </div>
  );
}

export function GastoPorDia({ dados }: { dados: Estatisticas["serieDiaria"] }) {
  if (dados.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-gray-400">
        Sem entregas no período.
      </div>
    );
  }

  const serie = dados.map((d) => ({ ...d, rotulo: diaCurto(d.dia) }));

  return (
    <ResponsiveContainer width="100%" height={256}>
      <AreaChart data={serie} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <defs>
          <linearGradient id="gradGasto" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={MARCA.cores.primaria} stopOpacity={0.28} />
            <stop offset="100%" stopColor={MARCA.cores.primaria} stopOpacity={0} />
          </linearGradient>
        </defs>

        <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
        <XAxis dataKey="rotulo" tick={EIXO} tickLine={false} axisLine={false} />
        <YAxis
          tick={EIXO}
          tickLine={false}
          axisLine={false}
          width={64}
          tickFormatter={(v: number) => `R$ ${v}`}
        />
        <Tooltip content={<CaixaTooltip formatar={brl} />} />
        <Area
          type="monotone"
          dataKey="gasto"
          stroke={MARCA.cores.primaria}
          strokeWidth={2}
          fill="url(#gradGasto)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function EntregasPorPlataforma({
  dados,
}: {
  dados: Estatisticas["porPlataforma"];
}) {
  if (dados.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-gray-400">
        Nenhuma entrega despachada este mês.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={256}>
      <BarChart data={dados} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
        <XAxis dataKey="nome" tick={EIXO} tickLine={false} axisLine={false} />
        <YAxis tick={EIXO} tickLine={false} axisLine={false} width={40} allowDecimals={false} />
        <Tooltip
          cursor={{ fill: "#F9FAFB" }}
          content={<CaixaTooltip formatar={(v) => `${v} entregas`} />}
        />
        <Bar dataKey="entregas" radius={[6, 6, 0, 0]}>
          {dados.map((d) => (
            <Cell key={d.provider} fill={COR_PROVEDOR[d.provider] ?? MARCA.cores.primaria} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
