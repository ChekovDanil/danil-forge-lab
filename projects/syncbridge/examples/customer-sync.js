import { MemoryJournal, MemorySource, MemoryTarget, SyncBridge } from '../src/index.js';

const source = new MemorySource([
  { id: 'lead-101', profile: { name: '  Анна Смирнова ', email: 'ANNA@example.invalid' }, phone: '+7 (913) 555-10-20' },
  { id: 'lead-102', profile: { name: 'Илья Морозов', email: 'ILYA@example.invalid' }, phone: '+7 000 000-00-02' }
], { name: 'website-leads' });

const target = new MemoryTarget({ name: 'crm-contacts', keyField: 'email' });
const journal = new MemoryJournal();
const bridge = new SyncBridge({ source, target, journal });
const mapping = {
  fields: {
    name: { from: 'profile.name', transform: 'trim' },
    email: { from: 'profile.email', transforms: ['trim', 'lowercase'] },
    phone: { from: 'phone', transform: 'digits' }
  },
  required: ['name', 'email']
};

console.log('DRY RUN');
console.table((await bridge.run({ mapping, dryRun: true })).items.map(({ sourceId, status, payload }) => ({ sourceId, status, ...payload })));
console.log('SYNC');
console.log(await bridge.run({ mapping }));
console.log('TARGET');
console.table(target.values());
