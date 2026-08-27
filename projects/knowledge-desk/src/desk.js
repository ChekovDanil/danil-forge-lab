import { decide, validateDecision } from "./engine.js";
import { knowledgeBase } from "./knowledge.js";

export class KnowledgeDesk {
  constructor({ articles = knowledgeBase, now = () => new Date().toISOString() } = {}) {
    this.articles = articles;
    this.now = now;
    this.questions = [];
    this.feedback = [];
  }

  ask(question, context = {}) {
    const decision = decide(question, context, this.articles);
    if (!validateDecision(decision, this.articles)) throw new Error("invalid_evidence");
    const record = Object.freeze({
      id: `Q-${String(this.questions.length + 1).padStart(3, "0")}`,
      question: String(question).trim(),
      context: Object.freeze({ ...context }),
      decision: structuredClone(decision),
      createdAt: this.now()
    });
    this.questions.push(record);
    return structuredClone(record);
  }

  addFeedback(questionId, value, note = "") {
    if (!this.questions.some((item) => item.id === questionId)) throw new Error("question_not_found");
    if (!['accepted', 'corrected'].includes(value)) throw new Error("invalid_feedback");
    const entry = Object.freeze({ questionId, value, note: String(note).trim(), createdAt: this.now() });
    this.feedback.push(entry);
    return structuredClone(entry);
  }

  snapshot() {
    const approved = this.articles.filter((item) => item.status === "approved");
    const counts = this.questions.reduce((acc, item) => {
      acc[item.decision.type] = (acc[item.decision.type] ?? 0) + 1;
      return acc;
    }, { answer: 0, clarify: 0, handoff: 0 });
    return structuredClone({
      product: "Atlas Cloud",
      articles: approved.map(({ answer: _answer, fragments: _fragments, keywords: _keywords, ...item }) => item),
      questions: this.questions,
      feedback: this.feedback,
      stats: { approvedSources: approved.length, ...counts }
    });
  }
}
