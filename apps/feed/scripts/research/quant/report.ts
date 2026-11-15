// Writes docs/quant/experiments.md: the human-readable index of every registered experiment (ID, family, period, data
// version, costs, verdict, one-line result, caveats). The narrative results document is written by hand from the
// registry; this file is the audit trail. Run (apps/feed): npx tsx scripts/research/quant/report.ts
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { readRegistry } from './registry';

const out = path.resolve(import.meta.dirname, '../../../../../docs/quant/experiments.md');
const list = readRegistry();
const lines: string[] = ['# Experiment registry', '', `Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC from apps/feed/.data/research/experiments.jsonl (${list.length} entries). Detail files: apps/feed/.data/research/quant/<id>-*.json.`, ''];
lines.push('| ID | Family | Name | Period (role) | Data to | Verdict | Result |', '|---|---|---|---|---|---|---|');
for (const e of list) lines.push(`| ${e.id} | ${e.family} | ${e.name} | ${e.period.from} → ${e.period.to} (${e.period.role}) | EOD ${e.data.eodLast ?? '-'}, F&O ${e.data.fnoLast ?? '-'}, git ${e.data.git} | ${e.verdict} | ${(e.notes ?? '').replace(/\|/g, '/')} |`);
lines.push('');
for (const e of list) {
  lines.push(`## ${e.id} — ${e.name}`, '', `- Hypothesis: ${e.hypothesis}`, `- Script: \`${e.script}\``, `- Ran: ${e.ranAt.slice(0, 16).replace('T', ' ')} UTC; data: EOD to ${e.data.eodLast}, F&O ${e.data.fnoFirst} → ${e.data.fnoLast}, minutes to ${e.data.minutesLast}, commit ${e.data.git}`, `- Costs: ${e.costs.broker}; ${e.costs.slippage}; charges ${e.costs.charges}`, `- Params: \`${JSON.stringify(e.params)}\``, `- Validation: \`${JSON.stringify(e.validation)}\``, `- Caveats: ${e.caveats.join(' ')}`, `- Verdict: **${e.verdict}**. ${e.notes ?? ''}`, '');
}
writeFileSync(out, lines.join('\n'));
console.log(`wrote ${out} (${list.length} experiments)`);
