/**
 *  Six functions of DOM plumbing. No imports.
 *
 *  WHY THIS EXISTS AT ALL, given that template strings plus `innerHTML` would be shorter:
 *
 *  `Population.enter(string calldata genome, uint256 endowmentAmount)` (Population.sol:654) is
 *  PERMISSIONLESS. Anybody holding testnet tUSDC and a little STT can spawn an organism whose
 *  `systemPrompt` is a string of their choosing, and this dashboard's whole point is to display
 *  genomes and the model output they produce. So every genome, every `lastReasoning`, and every
 *  `reasoning` in a `Believed` log is UNTRUSTED INPUT arriving from a public write path.
 *
 *  An `innerHTML` renderer would be one forgotten interpolation away from letting an entrant
 *  execute script in the operator's browser — where the operator's own RPC settings live. The
 *  fix is not to escape carefully; it is to make escaping unnecessary. `el()` puts every string
 *  child through `createTextNode`, so markup in a genome renders as the characters an entrant
 *  typed and can never become nodes. There is no `innerHTML` in this codebase and there should
 *  not be one: grep for it as a review check.
 *
 *  The one deliberate exception is `svg()`, which builds namespaced elements the same way and
 *  is still text-node-only for children.
 */

/** Attribute names go through here so a typo'd prop cannot become an event handler. */
const ON = /^on/i;

function apply(node, props) {
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;

    if (k === "class" || k === "className") {
      node.setAttribute("class", Array.isArray(v) ? v.filter(Boolean).join(" ") : String(v));
    } else if (k === "style" && typeof v === "object") {
      for (const [p, s] of Object.entries(v)) node.style.setProperty(p, String(s));
    } else if (k === "dataset") {
      for (const [p, s] of Object.entries(v)) node.dataset[p] = String(s);
    } else if (k === "text") {
      node.appendChild(document.createTextNode(String(v)));
    } else if (typeof v === "function") {
      // Listeners are passed as functions, never as `onclick="..."` strings, so no attribute
      // on this page ever contains executable text.
      node.addEventListener(k.replace(ON, "").toLowerCase(), v);
    } else if (v === true) {
      node.setAttribute(k, "");
    } else {
      node.setAttribute(k, String(v));
    }
  }
}

function fill(node, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false || c === true) continue;
    node.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function el(tag, props, ...children) {
  const node = document.createElement(tag);
  apply(node, props);
  fill(node, children);
  return node;
}

const SVG_NS = "http://www.w3.org/2000/svg";

export function svg(tag, props, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (typeof v === "function") node.addEventListener(k.replace(ON, "").toLowerCase(), v);
    else node.setAttribute(k === "className" ? "class" : k, String(v));
  }
  fill(node, children);
  return node;
}

export function frag(...children) {
  const f = document.createDocumentFragment();
  fill(f, children);
  return f;
}

/** Replace a container's contents in one shot. */
export function mount(target, ...children) {
  if (!target) return target;
  target.replaceChildren();
  fill(target, children);
  return target;
}

export function $(sel, root = document) {
  return root.querySelector(sel);
}

/** A labelled value, the page's most repeated shape. */
export function field(label, value, opts = {}) {
  return el(
    "div",
    { class: ["field", opts.class] },
    el("span", { class: "field-label", text: label }),
    el("span", { class: ["field-value", opts.tone && `tone-${opts.tone}`], title: opts.title }, value),
  );
}

export function link(href, text, opts = {}) {
  return el("a", { href, target: "_blank", rel: "noopener noreferrer", class: opts.class, title: opts.title }, text);
}
