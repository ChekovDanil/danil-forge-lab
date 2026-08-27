import { knowledgeBase } from "./knowledge.js";

const endings = /(иями|ами|ого|ему|ыми|ими|ить|ать|ять|ах|ях|ов|ев|ом|ам|ям|ы|и|а|я|у|ю|е|о)$/u;
const synonyms = new Map([
  ["скача", "экспорт"], ["выгруз", "экспорт"], ["таблиц", "csv"],
  ["логин", "доступ"], ["войти", "доступ"], ["сотрудник", "роль"],
  ["платеж", "оплата"], ["деньг", "оплата"], ["запрос", "api"]
]);

export function normalize(value = "") {
  return String(value)
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/giu, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 1)
    .map((token) => token.replace(endings, ""))
    .map((token) => synonyms.get(token) ?? token);
}

function queryContext(question, supplied = {}) {
  const text = question.toLocaleLowerCase("ru-RU");
  const plan = supplied.plan ?? (/\bpro\b|про тариф/u.test(text) ? "pro" : /\bbasic\b|базов/u.test(text) ? "basic" : null);
  const region = supplied.region ?? (/\beu\b|европ/u.test(text) ? "EU" : /\bru\b|росси/u.test(text) ? "RU" : null);
  return { plan, region };
}

function articleText(article) {
  return [article.title, article.topic, ...article.keywords, ...article.fragments.map((item) => item.text)].join(" ");
}

export function retrieve(question, suppliedContext = {}, articles = knowledgeBase) {
  const tokens = normalize(question);
  const context = queryContext(question, suppliedContext);
  return articles
    .filter((article) => article.status === "approved")
    .filter((article) => !context.plan || article.plan === "all" || article.plan === context.plan)
    .filter((article) => !context.region || article.region === "all" || article.region === context.region)
    .map((article) => {
      const haystack = normalize(articleText(article));
      const title = normalize(article.title);
      const score = tokens.reduce((total, token) => {
        const exact = haystack.filter((word) => word === token).length;
        const partial = exact ? 0 : haystack.some((word) => word.startsWith(token) || token.startsWith(word)) ? 1 : 0;
        const titleBoost = title.some((word) => word === token || word.startsWith(token) || token.startsWith(word)) ? 2 : 0;
        return total + exact + partial + titleBoost;
      }, 0);
      return { article, score };
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || b.article.version - a.article.version || a.article.id.localeCompare(b.article.id));
}

function sensitiveIntent(question) {
  const text = question.toLocaleLowerCase("ru-RU");
  if (/дважды|двойно|вернут|возврат|списан|оспор|чарджбэк/u.test(text)) return { code: "financial_dispute", queue: "Финансы", urgency: "high" };
  if (/удали(те|ть)|персональн|паспорт|взлом|чужой доступ/u.test(text)) return { code: "sensitive_action", queue: "Безопасность", urgency: "high" };
  return null;
}

function citation(article) {
  return {
    sourceId: article.id,
    title: article.title,
    version: article.version,
    effectiveAt: article.effectiveAt,
    fragment: article.fragments[0]
  };
}

function handoff(question, reason, candidates = []) {
  return {
    type: "handoff",
    evidence: candidates.length ? "conflict" : "restricted",
    reason: reason.code,
    queue: reason.queue,
    urgency: reason.urgency,
    answer: "Автоматический ответ остановлен. Вопрос передан специалисту вместе с найденными источниками.",
    citations: candidates.slice(0, 3).map(({ article }) => citation(article)),
    packet: {
      question,
      gap: reason.code === "source_conflict" ? "Два действующих источника дают разные правила." : "Запрос требует решения уполномоченного специалиста.",
      nextAction: reason.code === "financial_dispute" ? "Проверить идентификатор операции и журнал списаний." : reason.code === "source_conflict" ? "Выбрать действующую редакцию и отозвать вторую." : "Проверить полномочия и подтвердить действие вручную."
    }
  };
}

export function decide(question, suppliedContext = {}, articles = knowledgeBase) {
  const cleaned = String(question ?? "").trim();
  if (cleaned.length < 3) throw new Error("question_too_short");
  const results = retrieve(cleaned, suppliedContext, articles);
  const risk = sensitiveIntent(cleaned);
  if (risk) {
    const threshold = Math.max(2, (results[0]?.score ?? 2) - 2);
    return handoff(cleaned, risk, results.filter((item) => item.score >= threshold));
  }
  if (!results.length || results[0].score < 2) {
    return {
      type: "clarify",
      evidence: "insufficient",
      reason: "no_supported_source",
      answer: "Уточните, о каком разделе или действии идёт речь. Например: доступ, роли, экспорт, оплата или API.",
      citations: []
    };
  }

  const topScore = results[0].score;
  const near = results.filter((item) => item.score >= topScore - 1);
  const samePolicy = results.filter((item) => item.article.policyKey === results[0].article.policyKey);
  const sameVersion = samePolicy.filter((item) => item.article.version === results[0].article.version);
  const conflictingAnswers = new Set(sameVersion.map((item) => item.article.answer));
  if (sameVersion.length > 1 && conflictingAnswers.size > 1) {
    return handoff(cleaned, { code: "source_conflict", queue: "Редактор базы", urgency: "high" }, sameVersion);
  }

  const context = queryContext(cleaned, suppliedContext);
  const planVariants = new Set(samePolicy.map((item) => item.article.plan).filter((plan) => plan !== "all"));
  if (!context.plan && planVariants.size > 1) {
    return {
      type: "clarify",
      evidence: "ambiguous",
      reason: "plan_required",
      answer: "Уточните тариф: Basic или Pro. Доступный вариант экспорта зависит от тарифа.",
      citations: samePolicy.slice(0, 2).map(({ article }) => citation(article))
    };
  }

  const selected = samePolicy.sort((a, b) => b.article.version - a.article.version)[0] ?? results[0];
  return {
    type: "answer",
    evidence: "sufficient",
    reason: "approved_source",
    answer: selected.article.answer,
    claims: [{ text: selected.article.answer, sourceIds: [selected.article.id] }],
    citations: [citation(selected.article)]
  };
}

export function validateDecision(decision, articles = knowledgeBase) {
  const approved = new Set(articles.filter((article) => article.status === "approved").map((article) => article.id));
  if (decision.type === "answer" && (!decision.claims?.length || decision.claims.some((claim) => !claim.sourceIds?.length))) return false;
  return decision.citations.every((item) => approved.has(item.sourceId));
}
