export const approvalTransitions = { pending: ['approved', 'changes_requested'], changes_requested: ['pending'], approved: [] };

export function projectProgress(stages) {
  if (!stages.length) return 0;
  const weighted = stages.some((stage) => Number.isFinite(stage.weight));
  if (!weighted) return Math.round(stages.filter((stage) => stage.status === 'done').length / stages.length * 100);
  const totalWeight = stages.reduce((sum, stage) => sum + (Number(stage.weight) || 0), 0);
  if (!totalWeight) return 0;
  const completed = stages.reduce((sum, stage) => sum + (Number(stage.weight) || 0) * Math.min(100, Math.max(0, Number(stage.progress) || 0)) / 100, 0);
  return Math.round(completed / totalWeight * 100);
}

export function updateApproval(items, id, status, note = '') {
  return items.map((item) => {
    if (item.id !== id) return item;
    if (!approvalTransitions[item.status]?.includes(status)) throw new Error('Недопустимый переход согласования');
    return { ...item, status, note: String(note).trim(), updatedAt: new Date().toISOString() };
  });
}

export function financeSummary(invoices) {
  return invoices.reduce((out, item) => {
    out.total += item.amount;
    if (item.status === 'paid') out.paid += item.amount;
    if (item.status === 'due') out.due += item.amount;
    return out;
  }, { total: 0, paid: 0, due: 0 });
}

export function sortActivity(items) {
  return [...items].sort((a, b) => new Date(b.at) - new Date(a.at));
}

export function deadlineState(dueAt, now = new Date()) {
  const difference = new Date(dueAt).getTime() - new Date(now).getTime();
  const hours = Math.ceil(Math.abs(difference) / 3_600_000);
  if (difference < 0) return { state: 'overdue', label: hours >= 24 ? `${Math.ceil(hours / 24)} дн.` : `${hours} ч.` };
  if (difference <= 24 * 3_600_000) return { state: 'soon', label: `${hours} ч.` };
  return { state: 'normal', label: `${Math.ceil(hours / 24)} дн.` };
}

export function approvalSummary(items, now = new Date()) {
  return items.reduce((summary, item) => {
    if (item.status === 'approved') summary.approved += 1;
    else summary.pending += 1;
    if (item.status !== 'approved' && deadlineState(item.dueAt, now).state === 'overdue') summary.overdue += 1;
    return summary;
  }, { pending: 0, approved: 0, overdue: 0 });
}

export function canRequestChanges(comment) {
  return String(comment).trim().length >= 8;
}

export function canPublish(item) {
  return item.status === 'pending' && Boolean(item.fileUrl);
}
