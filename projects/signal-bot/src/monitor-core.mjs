const clone = (value) => structuredClone(value);

export const defaultServices = [
  { id: 'api', name: 'Public API', target: '/health', status: 'healthy', latencyMs: 118, mutedUntil: null },
  { id: 'payments', name: 'Payments', target: '/payments/ping', status: 'healthy', latencyMs: 164, mutedUntil: null },
  { id: 'sync', name: 'Catalog sync', target: 'queue:catalog', status: 'healthy', latencyMs: 92, mutedUntil: null },
];

function isQuietHour(date, start, end) {
  const hour = date.getUTCHours();
  return start > end ? hour >= start || hour < end : hour >= start && hour < end;
}

function severityFor(status) {
  if (status === 'down') return 'critical';
  if (status === 'degraded') return 'warning';
  return 'ok';
}

function incidentMessage(service, incident, state) {
  if (state === 'resolved') {
    return `Восстановлено: ${service.name}. Сервис отвечает ${incident.lastLatencyMs} мс. Инцидент закрыт автоматически.`;
  }
  const prefix = incident.severity === 'critical' ? 'Сбой' : 'Проверить';
  return `${prefix}: ${service.name}. ${incident.summary} Последняя проверка: ${incident.lastLatencyMs} мс.`;
}

export class MonitorEngine {
  constructor(options = {}) {
    this.quietStart = options.quietStart ?? 22;
    this.quietEnd = options.quietEnd ?? 7;
    this.groupWindowMinutes = options.groupWindowMinutes ?? 15;
    this.services = clone(options.services ?? defaultServices);
    this.incidents = [];
    this.messages = [];
    this.sequence = 1;
  }

  reset() {
    this.services = clone(defaultServices);
    this.incidents = [];
    this.messages = [];
    this.sequence = 1;
    return this.snapshot();
  }

  applyCheck({ serviceId, status, latencyMs, at = new Date().toISOString(), summary = '' }) {
    const service = this.services.find((item) => item.id === serviceId);
    if (!service) throw new Error(`Unknown service: ${serviceId}`);
    if (!['healthy', 'degraded', 'down'].includes(status)) throw new Error(`Unknown status: ${status}`);

    const timestamp = new Date(at);
    if (Number.isNaN(timestamp.getTime())) throw new Error('Invalid check time');
    service.status = status;
    service.latencyMs = latencyMs;
    const active = this.incidents.find((item) => item.serviceId === serviceId && item.state !== 'resolved');

    if (status === 'healthy') {
      if (!active) return { action: 'none', service: clone(service) };
      active.state = 'resolved';
      active.resolvedAt = timestamp.toISOString();
      active.lastLatencyMs = latencyMs;
      const message = this.addMessage(service, active, timestamp, 'resolved', 'send');
      return { action: 'resolved', incident: clone(active), message: clone(message) };
    }

    const severity = severityFor(status);
    let incident = active;
    let action = 'grouped';
    if (!incident) {
      action = 'created';
      incident = {
        id: `INC-${String(this.sequence++).padStart(3, '0')}`,
        serviceId,
        serviceName: service.name,
        severity,
        state: 'open',
        summary: summary || (status === 'down' ? 'Нет ответа от проверки.' : 'Ответ медленнее рабочего порога.'),
        startedAt: timestamp.toISOString(),
        updatedAt: timestamp.toISOString(),
        lastLatencyMs: latencyMs,
        checks: 1,
        acknowledgedBy: null,
      };
      this.incidents.unshift(incident);
    } else {
      incident.severity = severity === 'critical' ? 'critical' : incident.severity;
      incident.updatedAt = timestamp.toISOString();
      incident.lastLatencyMs = latencyMs;
      incident.checks += 1;
      if (summary) incident.summary = summary;
    }

    const muted = service.mutedUntil && new Date(service.mutedUntil) > timestamp;
    const quiet = isQuietHour(timestamp, this.quietStart, this.quietEnd);
    const delivery = muted ? 'muted' : quiet && incident.severity !== 'critical' ? 'digest' : action === 'grouped' ? 'grouped' : 'send';
    const message = this.addMessage(service, incident, timestamp, 'incident', delivery);
    return { action, delivery, incident: clone(incident), message: clone(message) };
  }

  acknowledge(incidentId, by = 'Вы', at = new Date().toISOString()) {
    const incident = this.incidents.find((item) => item.id === incidentId && item.state !== 'resolved');
    if (!incident) throw new Error(`Active incident not found: ${incidentId}`);
    incident.state = 'acknowledged';
    incident.acknowledgedBy = by;
    incident.acknowledgedAt = new Date(at).toISOString();
    const service = this.services.find((item) => item.id === incident.serviceId);
    const message = {
      id: `MSG-${String(this.messages.length + 1).padStart(3, '0')}`,
      kind: 'acknowledgement',
      delivery: 'send',
      createdAt: incident.acknowledgedAt,
      text: `Принято: ${service.name}. Инцидент ${incident.id} взял в работу ${by}.`,
    };
    this.messages.unshift(message);
    return { incident: clone(incident), message: clone(message) };
  }

  mute(serviceId, minutes = 30, at = new Date().toISOString()) {
    const service = this.services.find((item) => item.id === serviceId);
    if (!service) throw new Error(`Unknown service: ${serviceId}`);
    const now = new Date(at);
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 1440) throw new Error('Mute must be between 1 and 1440 minutes');
    service.mutedUntil = new Date(now.getTime() + minutes * 60_000).toISOString();
    return clone(service);
  }

  statusText() {
    const active = this.incidents.filter((item) => item.state !== 'resolved');
    const critical = active.filter((item) => item.severity === 'critical').length;
    const warning = active.filter((item) => item.severity === 'warning').length;
    return active.length === 0
      ? 'Все 3 сервиса отвечают. Активных инцидентов нет.'
      : `Активных инцидентов: ${active.length}. Критических: ${critical}. Требуют проверки: ${warning}.`;
  }

  addMessage(service, incident, timestamp, kind, delivery) {
    const message = {
      id: `MSG-${String(this.messages.length + 1).padStart(3, '0')}`,
      incidentId: incident.id,
      serviceId: service.id,
      kind,
      delivery,
      createdAt: timestamp.toISOString(),
      text: incidentMessage(service, incident, kind === 'resolved' ? 'resolved' : 'incident'),
    };
    this.messages.unshift(message);
    return message;
  }

  snapshot() {
    return {
      services: clone(this.services),
      incidents: clone(this.incidents),
      messages: clone(this.messages),
      summary: this.statusText(),
      boundary: 'Telegram delivery is not connected in this portfolio demo.',
    };
  }
}

export function buildScenario(name) {
  if (name === 'normal') return [];
  if (name === 'quiet') return [
    { serviceId: 'sync', status: 'degraded', latencyMs: 2_440, at: '2026-08-27T23:18:00.000Z', summary: 'Очередь отстаёт на 14 минут.' },
  ];
  if (name === 'critical') return [
    { serviceId: 'api', status: 'down', latencyMs: 10_000, at: '2026-08-27T23:21:00.000Z', summary: 'Три проверки подряд завершились таймаутом.' },
    { serviceId: 'api', status: 'down', latencyMs: 10_000, at: '2026-08-27T23:24:00.000Z', summary: 'Таймаут подтверждён повторной проверкой.' },
  ];
  throw new Error(`Unknown scenario: ${name}`);
}
