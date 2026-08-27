# Content Patch

A framework-free rehearsal of safe CMS maintenance on synthetic content. It demonstrates the workflow around a change, not a live WordPress connection.

## Included

- page inventory with link, metadata, and media issues;
- filters and per-page issue selection;
- explicit dry-run plan;
- mandatory backup checkpoint before applying changes;
- reversible local apply and rollback;
- session report and responsive operator interface.

## Honest boundary

The project does not connect to WordPress, a database, a website, or an external API. All pages, paths, findings, and reports are fictional and stay in browser memory. Production maintenance would require owner-provided access, a verified backup, a staging environment where available, and an agreed change window.

## Run

```bash
npm start
```

Open `http://127.0.0.1:3450`. Run the pure workflow tests with `npm test`.

Portfolio source code. All rights reserved.
