/** Horário de funcionamento do agente (fuso de São Paulo). */

export interface Horario {
  horaInicio: number;
  horaFim: number;
  diasSemana: number[];
}

export function agoraSP(agora = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo',
      weekday: 'short',
      hour: 'numeric',
      hourCycle: 'h23',
    })
      .formatToParts(agora)
      .map((x) => [x.type, x.value]),
  );
  const dias: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { dia: dias[p.weekday as string] ?? 0, hora: Number(p.hour) };
}

export function dentroDoHorario(c: Horario, agora = new Date()): boolean {
  const { dia, hora } = agoraSP(agora);
  return c.diasSemana.includes(dia) && hora >= c.horaInicio && hora < c.horaFim;
}

const NOME_DIA = ['no domingo', 'na segunda', 'na terça', 'na quarta', 'na quinta', 'na sexta', 'no sábado'];

/** Quando o time volta, em palavras: "hoje a partir das 8h", "amanhã a partir das 8h", "na segunda…". */
export function proximaAbertura(c: Horario, agora = new Date()): string | null {
  const { dia, hora } = agoraSP(agora);
  for (let d = 0; d <= 7; d++) {
    const diaSemana = (dia + d) % 7;
    if (!c.diasSemana.includes(diaSemana)) continue;
    if (d === 0 && hora >= c.horaInicio) continue;
    const quando = d === 0 ? 'hoje' : d === 1 ? 'amanhã' : NOME_DIA[diaSemana];
    return `${quando} a partir das ${c.horaInicio}h`;
  }
  return null;
}
