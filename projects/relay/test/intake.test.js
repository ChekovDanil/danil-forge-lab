import test from 'node:test';
import assert from 'node:assert/strict';
import { IntakeSession, budgets, buildLead, leadPriority, routeLead, urgencyOptions } from '../src/intake.js';

const make = () => new IntakeSession({ now: () => new Date('2026-08-27T08:00:00.000Z'), idFactory: () => 'TEST0001' });
function reachContact(s) { s.handle('Анна'); return s; }
function reachDescription(s) { reachContact(s).handle('anna@example.invalid'); s.handle('Telegram-бот'); return s; }
function reachBudget(s) { reachDescription(s).handle('Нужен бот для приёма заявок с сайта'); return s; }
function reachUrgency(s) { reachBudget(s).handle(budgets[1]); return s; }
function reachConfirm(s, urgent = false) { reachUrgency(s).handle(urgent ? urgencyOptions[0] : urgencyOptions[1]); return s; }

test('начинает с имени и проверяет длину', () => { const s=make(); assert.equal(s.prompt().text,'Как к вам обращаться?'); assert.match(s.handle('А').error,/минимум/); });
test('проверяет телефон или email', () => { const s=reachContact(make()); assert.match(s.handle('123').error,/телефон/); assert.equal(s.handle('anna@example.invalid').text,'Что требуется сделать?'); });
test('отклоняет телефон без российского префикса', () => { const s=reachContact(make()); assert.match(s.handle('19130000000').error,/телефон/); });
test('не принимает произвольную категорию и бюджет', () => { const s=reachContact(make()); s.handle('anna@example.invalid'); assert.match(s.handle('Космос').error,/вариант/); s.handle('Сайт'); s.handle('Нужен новый сайт с формой заявки'); assert.match(s.handle('много').error,/бюджет/); });
test('требует содержательное описание', () => { const s=reachDescription(make()); assert.match(s.handle('Сделать бота').error,/20/); });
test('позволяет вернуться к описанию', () => { const s=reachConfirm(make()); assert.match(s.handle('Изменить описание').text,/опишите/i); });
test('маршрутизирует категории в разные команды', () => { assert.equal(routeLead('Сайт').team,'Веб-команда'); assert.equal(routeLead('Telegram-бот').team,'Автоматизация'); assert.equal(routeLead('Другое').owner,'Менеджер'); });
test('срочная заявка получает высокий приоритет и короткий SLA', () => { assert.deepEqual(leadPriority(urgencyOptions[0]),{code:'high',label:'Высокий',sla:'Ответить за 30 минут'}); });
test('создаёт структурированную карточку только после подтверждения', () => { const s=reachConfirm(make()); assert.equal(s.lead(),null); s.handle('Отправить заявку'); const lead=s.lead(); assert.equal(lead.id,'RQ-TEST0001'); assert.equal(lead.route.owner,'Ирина'); assert.equal(lead.request.budget,budgets[1]); });
test('уведомление содержит канал и срочный приоритет', () => { const s=reachConfirm(make(),true); s.handle('Отправить заявку'); assert.equal(s.notification().priority,'high'); assert.equal(s.notification().recipient,'#automation'); assert.match(s.notification().title,/Срочная/); });
test('карточка содержит следующий шаг и теги', () => { const lead=buildLead({id:'RQ-1',createdAt:'now',name:'Иван',contact:'a@example.invalid',category:'Сайт',description:'Нужен сайт',budget:budgets[0],urgency:urgencyOptions[1]}); assert.match(lead.nextAction,/Алексей/); assert.equal(lead.tags.length,3); });
test('отмена очищает данные и фиксирует событие', () => { const s=reachContact(make()); s.handle('/cancel'); assert.deepEqual(s.data,{}); assert.equal(s.events.at(-1).type,'cancelled'); });
