/**
 *  Lineage layout: a snapshot array in, a drawable tree out. No DOM, no chain.
 *
 *  Facts this relies on, read out of `Population.sol` rather than assumed:
 *
 *    - Ids are 1-based (`prophetId = prophets.length` after the push, :595).
 *    - A child is spawned as `_spawn(parent.prophetId(), parent.generation() + 1, ...)`
 *      (:1369), so TREE DEPTH IS EXACTLY `generation`. The layout can trust the field
 *      instead of recomputing depth, and disagreement between the two is a bug worth seeing.
 *    - BOTH `spawnGenesis` (:489) and `enter` (:594) spawn with `parentId 0, generation 0`.
 *      A paying entrant is therefore a root, structurally identical to a founder. The only
 *      thing separating them is `birthWindow`: founders are minted before the first window,
 *      so theirs is 0. That is what `rootKind` reports, and it is a heuristic — a founder
 *      spawned after the population started running would read as an entrant.
 *
 *  The layout is an ordinary tidy dendrogram: leaves take consecutive slots in id order,
 *  and every parent sits at the mean of its children. Generation is the horizontal axis, so
 *  the drawing reads left to right as descent, and a long-lived lineage is visibly a long
 *  branch rather than a colour.
 */

/**
 *  @param rows  organisms, shaped like `Population.snapshot()` entries. Accepts bigint or
 *               number for every numeric field, because a fixture writes numbers and viem
 *               returns bigints.
 */
export function layout(rows) {
  const nodes = new Map();

  for (const r of rows ?? []) {
    const id = Number(r.id);
    nodes.set(id, {
      id,
      parentId: Number(r.parentId),
      generation: Number(r.generation),
      dead: Boolean(r.dead),
      birthWindow: Number(r.birthWindow),
      deathWindow: Number(r.deathWindow),
      streak: Number(r.streak),
      correctCount: Number(r.correctCount),
      wrongCount: Number(r.wrongCount),
      abstainCount: Number(r.abstainCount),
      windowsLived: Number(r.windowsLived),
      treasury: r.treasury ?? 0n,
      belief: Number(r.belief),
      thesis: Number(r.thesis),
      addr: r.addr,
      genomeHash: r.genomeHash,
      children: [],
      row: 0,
    });
  }

  // Wire children. A parent outside the set (impossible for a well-formed snapshot, since
  // `prophets` is append-only and the array is returned whole) is demoted to a root rather
  // than silently dropping the organism off the page.
  const roots = [];
  for (const n of nodes.values()) {
    const parent = n.parentId > 0 ? nodes.get(n.parentId) : null;
    if (parent && parent.id !== n.id) parent.children.push(n);
    else roots.push(n);
  }

  const byId = (a, b) => a.id - b.id;
  roots.sort(byId);
  for (const n of nodes.values()) n.children.sort(byId);

  // Post-order slot assignment. `seen` guards against a malformed parent chain looping;
  // it cannot happen on chain (a parent's id is always lower than its child's) but a fixture
  // typo should not hang the page.
  let slot = 0;
  const seen = new Set();

  const place = (n) => {
    if (seen.has(n.id)) return n.row;
    seen.add(n.id);
    if (!n.children.length) {
      n.row = slot++;
      return n.row;
    }
    const rows_ = n.children.map(place);
    n.row = (Math.min(...rows_) + Math.max(...rows_)) / 2;
    return n.row;
  };

  for (const r of roots) place(r);

  const all = [...nodes.values()];
  const edges = [];
  for (const n of all) {
    for (const c of n.children) edges.push({ from: n.id, to: c.id, dead: c.dead });
  }

  const generations = all.length ? Math.max(...all.map((n) => n.generation)) : 0;

  return {
    nodes: all.sort(byId),
    roots,
    edges,
    generations, // max generation index, so column count is this + 1
    rows: slot, // number of leaf slots, i.e. the vertical extent
    byId: nodes,
  };
}

/**
 *  Founder or paying entrant, for a root node. See the header: this is `birthWindow`-based
 *  and therefore a heuristic, not a contract-guaranteed distinction.
 */
export function rootKind(node) {
  if (Number(node.parentId) !== 0) return "child";
  return Number(node.birthWindow) === 0 ? "founder" : "entrant";
}

/**
 *  Deepest surviving line of descent, which is the single number that best answers "is this
 *  thing actually evolving?" — a population that only ever loses founders has a max living
 *  generation of 0 no matter how many organisms it has churned through.
 */
export function depthReached(tree) {
  const living = tree.nodes.filter((n) => !n.dead);
  return {
    living: living.length ? Math.max(...living.map((n) => n.generation)) : 0,
    ever: tree.generations,
  };
}

/**
 *  Per-generation census. Feeds the "selection over ideas" read: if generation 2 is all
 *  Reversion and generation 0 was half Momentum, the drift is visible without an indexer.
 */
export function census(tree) {
  const out = new Map();
  for (const n of tree.nodes) {
    const g = n.generation;
    if (!out.has(g)) out.set(g, { generation: g, alive: 0, dead: 0, total: 0, theses: new Map() });
    const bucket = out.get(g);
    bucket.total += 1;
    if (n.dead) bucket.dead += 1;
    else bucket.alive += 1;
    // Only living organisms' theses describe the population NOW; a dead organism's last
    // thesis is a historical artefact and counting it would blur exactly the signal wanted.
    if (!n.dead) bucket.theses.set(n.thesis, (bucket.theses.get(n.thesis) ?? 0) + 1);
  }
  return [...out.values()].sort((a, b) => a.generation - b.generation);
}
