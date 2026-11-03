// The visual builder's tree: groups (AND / OR, optionally NOT) holding conditions and more groups. It is only a view
// of the formula: formula → tree → formula keeps the meaning and the grouping, so the visual builder and the formula
// editor always describe the same screen.

import { parseFormula, print, type Node, type Tf } from '@mtv/rules';
import { joinRowTf, splitRowTf } from './screener';

export type Leaf = { kind: 'leaf'; id: string; not: boolean; tf: Tf | null | 'mixed'; text: string };
export type Group = { kind: 'group'; id: string; not: boolean; op: 'AND' | 'OR'; children: Item[] };
export type Item = Leaf | Group;

let seq = 0;
export const newId = () => `n${++seq}`;
export const leaf = (text = '', tf: Leaf['tf'] = null): Leaf => ({ kind: 'leaf', id: newId(), not: false, tf, text });
export const group = (op: 'AND' | 'OR' = 'AND', children: Item[] = []): Group => ({ kind: 'group', id: newId(), not: false, op, children });

function toItem(n: Node): Item {
  if (n.t === 'logic') return { ...group(n.op), children: n.items.map(toItem) };
  if (n.t === 'not') {
    const inner = toItem(n.a);
    if (!inner.not) return { ...inner, not: true };
    return { ...leaf(), ...splitRowTf(print(n)) };
  }
  return { ...leaf(), ...splitRowTf(print(n)) };
}

/** The tree for a formula; null when the formula does not parse (fix it in the formula editor first). */
export function toTree(formula: string): Group | null {
  if (!formula.trim()) return group();
  const p = parseFormula(formula);
  if (!p.ok || p.type !== 'bool') return null;
  const root = toItem(p.node);
  return root.kind === 'group' ? root : { ...group(), children: [root] };
}

function itemText(i: Item): string {
  let core: string;
  if (i.kind === 'leaf') {
    if (!i.text.trim()) return '';
    core = i.tf === 'mixed' ? i.text : joinRowTf(i.tf, i.text);
  } else {
    const parts = i.children.map(itemText).filter(Boolean);
    if (!parts.length) return '';
    core = parts.map((p) => `(${p})`).join(` ${i.op} `);
  }
  return i.not ? `NOT (${core})` : core;
}

/** The formula for a tree, normalised when it parses (as typed otherwise, so errors still point somewhere useful). */
export function fromTree(root: Group): string {
  const parts = root.children.map(itemText).filter(Boolean);
  if (!parts.length) return '';
  const raw = root.not ? `NOT (${parts.map((p) => `(${p})`).join(` ${root.op} `)})` : parts.map((p) => `(${p})`).join(` ${root.op} `);
  const p = parseFormula(raw);
  return p.ok ? p.formula : raw;
}

// ---- edits (all return a new tree) ----

export function mapItem(root: Group, id: string, fn: (i: Item) => Item | null): Group {
  const walk = (g: Group): Group => ({
    ...g,
    children: g.children.flatMap((c) => {
      if (c.id === id) { const r = fn(c); return r ? [r] : []; }
      return [c.kind === 'group' ? walk(c) : c];
    }),
  });
  return root.id === id ? (fn(root) as Group) ?? root : walk(root);
}

/** Moves an item one place up or down within its group. */
export function moveItem(root: Group, id: string, d: -1 | 1): Group {
  const walk = (g: Group): Group => {
    const i = g.children.findIndex((c) => c.id === id);
    if (i >= 0) {
      const j = i + d;
      if (j < 0 || j >= g.children.length) return g;
      const children = [...g.children];
      [children[i], children[j]] = [children[j], children[i]];
      return { ...g, children };
    }
    return { ...g, children: g.children.map((c) => (c.kind === 'group' ? walk(c) : c)) };
  };
  return walk(root);
}

/** A deep copy with fresh ids, inserted right after the original. */
export function duplicateItem(root: Group, id: string): Group {
  const clone = (i: Item): Item => (i.kind === 'group' ? { ...i, id: newId(), children: i.children.map(clone) } : { ...i, id: newId() });
  const walk = (g: Group): Group => {
    const i = g.children.findIndex((c) => c.id === id);
    if (i >= 0) return { ...g, children: [...g.children.slice(0, i + 1), clone(g.children[i]), ...g.children.slice(i + 1)] };
    return { ...g, children: g.children.map((c) => (c.kind === 'group' ? walk(c) : c)) };
  };
  return walk(root);
}

export function addTo(root: Group, groupId: string, item: Item): Group {
  return mapItem(root, groupId, (g) => (g.kind === 'group' ? { ...g, children: [...g.children, item] } : g));
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
