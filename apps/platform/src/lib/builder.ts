// The visual builder's tree: groups holding conditions and bracketed sub-groups, with an AND / OR chosen between each
// pair. It is only a view of the formula: formula → tree → formula keeps the meaning and the grouping, so the visual
// builder and the formula editor always describe the same screen.
//
// Mixed joins follow the usual rule (as in TradingView and Chartink formulas): AND is applied before OR, so
// 1 AND 2 OR 3 means (1 AND 2) OR 3. A sub-group is a pair of brackets: 1 AND (2 OR 3). Brackets that the AND-first
// rule already implies are not shown as sub-groups, so the boxes on screen are exactly the brackets in the formula.

import { parseFormula, print, type Node, type Tf } from '@mtv/rules';
import { joinRowTf, splitRowTf } from './screener';

export type Join = 'AND' | 'OR';
export type Leaf = { kind: 'leaf'; id: string; not: boolean; tf: Tf | null | 'mixed'; text: string };
/** `joins[i]` sits between children[i] and children[i + 1]. */
export type Group = { kind: 'group'; id: string; not: boolean; children: Item[]; joins: Join[] };
export type Item = Leaf | Group;

let seq = 0;
export const newId = () => `n${++seq}`;
export const leaf = (text = '', tf: Leaf['tf'] = null): Leaf => ({ kind: 'leaf', id: newId(), not: false, tf, text });
export const group = (children: Item[] = [], join: Join = 'AND'): Group => ({ kind: 'group', id: newId(), not: false, children, joins: children.slice(1).map(() => join) });

function toItem(n: Node): Item {
  if (n.t === 'logic') return groupOf(n);
  if (n.t === 'not') {
    const inner = toItem(n.a);
    if (!inner.not) return { ...inner, not: true };
  }
  return { ...leaf(), ...splitRowTf(print(n)) };
}

/** A logic node as one group: an OR of AND-runs is flattened into one list (AND first), anything else stays bracketed. */
function groupOf(n: Node & { t: 'logic' }): Group {
  const g = group();
  const push = (item: Item, join: Join) => { if (g.children.length) g.joins.push(join); g.children.push(item); };
  n.items.forEach((x, k) => {
    if (n.op === 'OR' && x.t === 'logic' && x.op === 'AND') x.items.forEach((y, j) => push(toItem(y), k && !j ? 'OR' : 'AND'));
    else push(toItem(x), n.op);
  });
  return g;
}

/** The tree for a formula; null when the formula does not parse (fix it in the formula editor first). */
export function toTree(formula: string): Group | null {
  if (!formula.trim()) return group();
  const p = parseFormula(formula);
  if (!p.ok || p.type !== 'bool') return null;
  if (p.node.t === 'logic') return groupOf(p.node);
  const root = toItem(p.node);
  return root.kind === 'group' ? root : group([root]);
}

/** The children's formulas joined by AND before OR: runs split at each OR. Empty conditions are skipped. */
function seqText(g: Group): string {
  const runs: string[][] = [[]];
  g.children.forEach((c, i) => {
    const t = itemText(c);
    if (!t) return;
    if (runs[runs.length - 1].length && g.joins[i - 1] === 'OR') runs.push([]);
    runs[runs.length - 1].push(`(${t})`);
  });
  return runs.filter((r) => r.length).map((r) => r.join(' AND ')).join(' OR ');
}

function itemText(i: Item): string {
  let core: string;
  if (i.kind === 'leaf') {
    if (!i.text.trim()) return '';
    core = i.tf === 'mixed' ? i.text : joinRowTf(i.tf, i.text);
  } else {
    core = seqText(i);
    if (!core) return '';
  }
  return i.not ? `NOT (${core})` : core;
}

/** The formula for a tree, normalised when it parses (as typed otherwise, so errors still point somewhere useful). */
export function fromTree(root: Group): string {
  const raw = itemText(root);
  const p = parseFormula(raw);
  return p.ok ? p.formula : raw;
}

/** How a group with mixed joins reads, by row number: "(1 AND 2) OR 3". Null when all joins are the same. */
export function reading(g: Group): string | null {
  if (new Set(g.joins).size < 2) return null;
  const runs: number[][] = [[1]];
  g.joins.forEach((j, i) => (j === 'OR' ? runs.push([i + 2]) : runs[runs.length - 1].push(i + 2)));
  return runs.map((r) => (r.length > 1 && runs.length > 1 ? `(${r.join(' AND ')})` : r.join(' AND '))).join(' OR ');
}

// ---- edits (all return a new tree) ----

/** Applies `fn` to the item with this id; returning null removes it (and the join before it, or after it if first). */
export function mapItem(root: Group, id: string, fn: (i: Item) => Item | null): Group {
  if (root.id === id) return (fn(root) as Group) ?? root;
  const walk = (g: Group): Group => {
    const i = g.children.findIndex((c) => c.id === id);
    if (i < 0) return { ...g, children: g.children.map((c) => (c.kind === 'group' ? walk(c) : c)) };
    const r = fn(g.children[i]);
    if (r) return { ...g, children: g.children.map((c, k) => (k === i ? r : c)) };
    const joins = [...g.joins];
    joins.splice(i ? i - 1 : 0, 1);
    return { ...g, children: g.children.filter((_, k) => k !== i), joins };
  };
  return walk(root);
}

function inGroupOf(root: Group, id: string, fn: (g: Group, i: number) => Group): Group {
  const walk = (g: Group): Group => {
    const i = g.children.findIndex((c) => c.id === id);
    if (i >= 0) return fn(g, i);
    return { ...g, children: g.children.map((c) => (c.kind === 'group' ? walk(c) : c)) };
  };
  return walk(root);
}

/** Moves an item one place up or down within its group (the joins stay in place between the rows). */
export function moveItem(root: Group, id: string, d: -1 | 1): Group {
  return inGroupOf(root, id, (g, i) => {
    const j = i + d;
    if (j < 0 || j >= g.children.length) return g;
    const children = [...g.children];
    [children[i], children[j]] = [children[j], children[i]];
    return { ...g, children };
  });
}

/** A deep copy with fresh ids, inserted right after the original and joined to it the same way as the row before. */
export function duplicateItem(root: Group, id: string): Group {
  const clone = (x: Item): Item => (x.kind === 'group' ? { ...x, id: newId(), children: x.children.map(clone) } : { ...x, id: newId() });
  return inGroupOf(root, id, (g, i) => {
    const joins = [...g.joins];
    joins.splice(i, 0, g.joins[i - 1] ?? 'AND');
    return { ...g, children: [...g.children.slice(0, i + 1), clone(g.children[i]), ...g.children.slice(i + 1)], joins };
  });
}

/** Appends an item to a group, joined by `join` (default: the group's last join, or AND). */
export function addTo(root: Group, groupId: string, item: Item, join?: Join): Group {
  return mapItem(root, groupId, (g) => {
    const x = g as Group;
    return { ...x, children: [...x.children, item], joins: x.children.length ? [...x.joins, join ?? x.joins.at(-1) ?? 'AND'] : x.joins };
  });
}

/** Sets the join between row `index` and the next one. */
export function setJoin(root: Group, groupId: string, index: number, join: Join): Group {
  return mapItem(root, groupId, (g) => ({ ...(g as Group), joins: (g as Group).joins.map((j, k) => (k === index ? join : j)) }));
}

/** Sets every join of a group at once. */
export function setAllJoins(root: Group, groupId: string, join: Join): Group {
  return mapItem(root, groupId, (g) => ({ ...(g as Group), joins: (g as Group).joins.map(() => join) }));
}

// ---- one comparison, shown as "value  operator  value" ----

export type Op = '>' | '<' | '>=' | '<=' | '=' | '!=' | 'crosses above' | 'crosses below';
export const OPS: { value: Op; label: string }[] = [
  { value: '>', label: 'greater than' }, { value: '<', label: 'less than' },
  { value: '>=', label: 'at least' }, { value: '<=', label: 'at most' },
  { value: 'crosses above', label: 'crosses above' }, { value: 'crosses below', label: 'crosses below' },
  { value: '=', label: 'equal to' }, { value: '!=', label: 'not equal to' },
];
export type Comparison = { left: string; op: Op; right: string };

/** Splits a condition into left / operator / right when it is one comparison or crossing; null otherwise. */
export function toComparison(text: string): Comparison | null {
  const p = parseFormula(text);
  if (!p.ok) return null;
  const n = p.node;
  if (n.t === 'cmp') return { left: print(n.a), op: n.op, right: print(n.b) };
  if (n.t === 'call' && (n.fn === 'CROSSOVER' || n.fn === 'CROSSUNDER')) return { left: print(n.args[0]), op: n.fn === 'CROSSOVER' ? 'crosses above' : 'crosses below', right: print(n.args[1]) };
  return null;
}

export function fromComparison(c: Comparison): string {
  if (c.op === 'crosses above') return `CROSSOVER(${c.left}, ${c.right})`;
  if (c.op === 'crosses below') return `CROSSUNDER(${c.left}, ${c.right})`;
  return `${c.left} ${c.op} ${c.right}`;
}
