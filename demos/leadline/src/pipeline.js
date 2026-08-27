export const stages = ["new", "qualified", "proposal", "decision"];

function startOfDay(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function pipelineStats(deals, referenceDate = new Date()) {
  const today = startOfDay(referenceDate);
  return deals.reduce(
    (summary, deal) => {
      summary.total += Number(deal.amount) || 0;
      summary.weighted += ((Number(deal.amount) || 0) * (Number(deal.probability) || 0)) / 100;
      if (deal.nextAt && startOfDay(deal.nextAt) < today) summary.overdue += 1;
      return summary;
    },
    { total: 0, weighted: 0, overdue: 0 },
  );
}

export function moveDeal(deals, id, stage) {
  if (!stages.includes(stage)) throw new Error("Неизвестный этап");
  return deals.map((deal) => (deal.id === id ? { ...deal, stage } : deal));
}

export function removeDeal(deals, id) {
  return deals.filter((deal) => deal.id !== id);
}

export function upsertDeal(deals, candidate) {
  if (!candidate.id || !candidate.company?.trim() || !candidate.title?.trim())
    throw new Error("Укажите клиента и название сделки");
  if (!stages.includes(candidate.stage)) throw new Error("Неизвестный этап");

  const normalized = {
    ...candidate,
    company: candidate.company.trim(),
    title: candidate.title.trim(),
    amount: Math.max(0, Number(candidate.amount) || 0),
    probability: Math.min(100, Math.max(0, Number(candidate.probability) || 0)),
    next: candidate.next?.trim() || "Уточнить следующий шаг",
    note: candidate.note?.trim() || "Комментарий пока не добавлен.",
  };
  const exists = deals.some((deal) => deal.id === normalized.id);
  return exists
    ? deals.map((deal) => (deal.id === normalized.id ? normalized : deal))
    : [normalized, ...deals];
}

export function upcoming(deals) {
  return [...deals]
    .filter((deal) => deal.nextAt)
    .sort((left, right) => startOfDay(left.nextAt) - startOfDay(right.nextAt));
}

export function conversion(deals) {
  if (!deals.length) return 0;
  return Math.round((deals.filter((deal) => deal.stage === "decision").length / deals.length) * 100);
}
