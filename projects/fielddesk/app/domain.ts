export type JobStatus = 'Новая' | 'Назначена' | 'В работе' | 'Ожидает' | 'Завершена';
export type SlaState = 'critical' | 'risk' | 'normal';
export type Filter = 'Все' | 'Новые' | 'Активные' | 'Проблемные';

export type JobState = {
  status: JobStatus;
  sla: SlaState;
};

export function nextStatus(status: JobStatus): JobStatus {
  if (status === 'Новая') return 'Назначена';
  if (status === 'Назначена' || status === 'Ожидает') return 'В работе';
  if (status === 'В работе') return 'Завершена';
  return 'Завершена';
}

export function needsAttention(job: JobState): boolean {
  return job.sla !== 'normal' && job.status !== 'Завершена';
}

export function matchesFilter(job: JobState, filter: Filter): boolean {
  if (filter === 'Все') return true;
  if (filter === 'Новые') return job.status === 'Новая';
  if (filter === 'Активные') return ['Назначена', 'В работе', 'Ожидает'].includes(job.status);
  return needsAttention(job);
}

export function createJobId(existingCount: number): string {
  return `FD-${String(242 + existingCount).padStart(3, '0')}`;
}
