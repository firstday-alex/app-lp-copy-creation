// The one data model everything normalizes to.
//
// Every source — a theme JSON template, an Online Store page body — parses into
// OutlineNode[]. Everything downstream (length rules, badges, export, the slot
// writer's prompt) reads `kind` and nothing else, so adding a source means adding
// a parser and changing nothing else.
//
// @typedef {'SECTION'|'BLOCK'|'GROUP'|'H1'|'H2'|'H3'|'H4'|'P'|'A'|'QUOTE'|'LI'|'CONTENT'|'IMAGE'} NodeKind
// @typedef {Object} OutlineNode
// @property {string}       id        stable within a template; the key saved drafts hang off
// @property {NodeKind}     kind      drives length rules, badge colour, export formatting
// @property {string}       [label]   where it came from, e.g. "settings.heading" or "rich-text"
// @property {string}       [text]    store copy; "" means an unfilled slot, kept on purpose
// @property {boolean}      [editable] true = a copy slot a writer can change
// @property {string}       [path]    sections.problem.blocks.b2.settings.text — a future write-back target
// @property {OutlineNode[]} children
//
// Two invariants hold this together and both are load-bearing:
//   1. `editable && text === ''` is the "needs copy" state. That is the whole point of
//      the tool, so empty strings are KEPT, never pruned.
//   2. KIND_BY_HINT is consulted BEFORE the config-key rejection. That ordering is why
//      `image_alt` survives despite the key containing "image".

/* ---------- length rules, per kind ---------- */
// Enforced in the slot-writer prompt AND re-checked server-side on the way back, so a
// headline can't come back as a paragraph even if the model ignores the instruction.
export const KIND_RULES = {
  H1:      { min: 6,  max: 14, note: 'one clear promise, no colon-stacking' },
  H2:      { min: 4,  max: 12, note: 'a section headline, not a sentence' },
  H3:      { min: 3,  max: 10, note: 'supports the heading above it' },
  H4:      { min: 3,  max: 10, note: 'supports the heading above it' },
  P:       { min: 18, max: 45, note: 'one idea, plain words' },
  LI:      { min: 3,  max: 14, note: 'parallel construction with its siblings' },
  A:       { min: 2,  max: 5,  note: 'starts with a verb; no "click here"' },
  QUOTE:   { min: 8,  max: 30, note: 'sounds like a person, not the brand' },
  IMAGE:   { min: 4,  max: 14, note: 'describe what is pictured, for screen readers' },
  CONTENT: { min: 3,  max: 30, note: 'unclassified copy slot' }
};

// How much copy one /api/slots request may be asked for, measured in lines (slots ×
// variants) rather than slots. The response is slots × variants × rules, so slot count
// alone doesn't bound it: 40 slots at 3 options each needs about twice the 16k token
// ceiling, which truncates after burning the whole time budget. The client batches to fit
// inside this; /api/slots enforces it; /api/outline?op=status publishes it so there is
// exactly one number.
// Sized so a pass lands near a third of the 16k ceiling. The headroom is not waste:
// max_tokens covers thinking as well as the answer (see lib/anthropic.js), and the real
// binding limit is the 60s function ceiling, not the token count — a pass that would fit in
// tokens can still be killed mid-generation, which returns nothing at all.
export const SLOT_UNIT_BUDGET = 36;

// A second, independent ceiling: at one option per slot the token budget alone would allow
// 36 slots in a pass, and 36 slots is more than the model attends to individually however
// well it fits. This bounds slots regardless of how few options are asked for.
export const SLOT_MAX_PER_PASS = 14;

const wordCount = s => (String(s || '').trim().match(/\S+/g) || []).length;

// A soft check — reports, never rewrites. `ok` is false only when the slot has copy AND
// that copy breaks the rule; an empty slot is "unfilled", not "wrong".
export function checkLength(kind, text){
  const rule = KIND_RULES[kind];
  const words = wordCount(text);
  if (!rule) return { ok: true, words, rule: null };
  if (!words) return { ok: true, words: 0, rule, empty: true };
  return {
    ok: words >= rule.min && words <= rule.max,
    words, rule,
    why: words < rule.min ? `${words} words — under the ${rule.min}-word floor for ${kind}`
       : words > rule.max ? `${words} words — over the ${rule.max}-word ceiling for ${kind}`
       : ''
  };
}

/* ---------- classification: is this string setting copy, or config? ---------- */

// Key hints map a setting key to a role. ORDER MATTERS, twice over:
//   - this list runs before the config-key rejection, so `image_alt` outranks "image";
//   - within the list, narrower keys come first, so `subtitle` is a subhead and not a
//     heading, and `page_title` is an H1 and not an H2.
const KIND_BY_HINT = [
  [/(^|_)(image_alt|alt_text|alt)($|_)/,                                    'IMAGE'],
  [/(^|_)(quote|testimonial|review_text|attribution)/,                      'QUOTE'],
  [/(^|_)(button_label|button_text|cta|link_label|label)/,                  'A'],
  [/(^|_)(subheading|sub_heading|subtitle|subhead|eyebrow|kicker|overline)/,'H3'],
  [/(^|_)(h1|page_title|hero_heading|main_heading)/,                        'H1'],
  [/(^|_)(heading|title|headline)/,                                         'H2'],
  [/(^|_)(bullet|list_item|item_text)/,                                     'LI'],
  [/(^|_)(text|body|description|subtext|paragraph|caption|content|rich_text|richtext|blurb|copy)/, 'P']
];

// Keys that are configuration whatever they hold. Only consulted when NO hint matched.
const CONFIG_KEY = /(color|colour|image|video|url|href|width|height|padding|margin|size|align|layout|column|ratio|opacity|delay|speed|duration|enable|show|hide|style|scheme|handle|position|icon|background|blur|radius|font|shape|product|collection|blog|menu|aspect|gap|autoplay|loop|count|limit|per_row|spacing|border|shadow|animation|direction|visible|sticky|transparent|overlay|_id$|^id$|^type$)/;

// Values that are configuration whatever the key is called.
const CONFIG_VALUE = [
  /^#[0-9a-fA-F]{3,8}$/,          // hex colour. The `#` is required on purpose — bare
                                  // [0-9a-f]{3,8} also matches English words ("added",
                                  // "cafe", "faced"), which would eat real copy.
  /^(rgba?|hsla?)\(/i,
  /^shopify:\/\//i,
  /^gid:\/\/shopify\//i,
  /^(https?:)?\/\//i,
  /^\/[\w\-./]*$/,                // site-relative URL
  /^(mailto|tel):/i,
  /^-?\d+(\.\d+)?\s*(px|rem|em|%|vh|vw|s|ms|deg|fr)?$/i,
  /^(true|false)$/i,
  /\.(png|jpe?g|gif|webp|svg|woff2?|mp4|webm|css|js)$/i
];

// A single all-lowercase token with no whitespace is an enum, not a sentence. This is
// what keeps `text_alignment: "center"` out — that key matches the `text` hint, so the
// hint and the config-key rejection both wave it through, and only this catches it.
// It applies to hinted keys too, for exactly that reason.
const ENUM_VALUE = /^[a-z0-9]+([_-][a-z0-9]+)*$/;

const hintKind = key => { for (const [re, kind] of KIND_BY_HINT) if (re.test(key)) return kind; return null; };

// Headings sit one level deeper inside a block than at section level: the same
// `heading` key is an H2 on the section and an H3 in one of its blocks.
const DEEPER = { H1:'H2', H2:'H3', H3:'H4', H4:'H4' };
const bump = (kind, depth) => depth === 'block' ? (DEEPER[kind] || kind) : kind;

/**
 * Classify one string setting.
 * @returns {NodeKind|null} null = configuration, drop it.
 */
export function classifySetting(key, value, depth){
  const k = String(key || '').toLowerCase();
  const v = String(value == null ? '' : value);
  const hint = hintKind(k);

  if (!hint && CONFIG_KEY.test(k)) return null;
  if (v && CONFIG_VALUE.some(re => re.test(v))) return null;
  if (v && ENUM_VALUE.test(v)) return null;
  // An empty string can only be classified by its key. Without a hint there is no way
  // to tell an unwritten headline from an unset colour, so drop it.
  if (!v && !hint) return null;

  return bump(hint || 'CONTENT', depth);
}

/* ---------- re-nesting ---------- */

const H_LEVEL = { H1:1, H2:2, H3:3, H4:4 };

// Turn a flat, in-order list into a tree where a heading owns everything that follows
// it until a heading of equal or higher rank. This is what makes the outline
// meaningfully expandable instead of one long list of settings.
export function nestByHeading(nodes){
  const root = [], stack = [];
  for (const n of nodes){
    const lvl = H_LEVEL[n.kind];
    if (lvl) while (stack.length && stack[stack.length - 1].lvl >= lvl) stack.pop();
    (stack.length ? stack[stack.length - 1].node.children : root).push(n);
    if (lvl) stack.push({ lvl, node: n });
  }
  return root;
}

/* ---------- tiny HTML reader (no DOM on the server, and no dependency) ---------- */

// Named entities that actually turn up in marketing copy: currency, dashes, smart
// quotes, symbols, fractions. Not the full HTML5 set — anything missing survives as
// literal `&name;` in the slot, which is visible and fixable rather than silently wrong.
const ENTITIES = {
  amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", nbsp:' ',
  mdash:'—', ndash:'–', hellip:'…', bull:'•', middot:'·', dagger:'†',
  rsquo:'’', lsquo:'‘', rdquo:'”', ldquo:'“', sbquo:'‚', bdquo:'„', laquo:'«', raquo:'»',
  pound:'£', euro:'€', yen:'¥', cent:'¢', dollar:'$',
  copy:'©', reg:'®', trade:'™', deg:'°', times:'×', divide:'÷', plusmn:'±', minus:'−',
  frac12:'½', frac14:'¼', frac34:'¾', sup2:'²', sup3:'³', micro:'µ',
  para:'¶', sect:'§', ensp:' ', emsp:' ', thinsp:' ', shy:'', prime:'′', Prime:'″',
  larr:'←', rarr:'→', uarr:'↑', darr:'↓', harr:'↔', check:'✓', cross:'✗'
};
const decode = s => String(s || '')
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
const squash = s => decode(s).replace(/\s+/g, ' ').trim();
const attr = (attrs, name) => {
  const m = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs || '');
  return m ? (m[2] ?? m[3] ?? m[4] ?? '') : null;
};

const BLOCK_KIND = { h1:'H1', h2:'H2', h3:'H3', h4:'H4', h5:'H4', h6:'H4', p:'P', li:'LI', blockquote:'QUOTE' };
const TAG_RE = /<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)\/?>/g;

/**
 * HTML → OutlineNode[]. Used for Online Store page bodies and for rich-text theme
 * settings, which are HTML in a JSON string.
 *
 * Paragraphs, list items, blockquotes, links and image alt text become slots; links and
 * images found inside a paragraph become that paragraph's children so the writer can see
 * which CTA belongs to which block of copy.
 */
export function parseHtmlOutline(html, opts){
  const o = opts || {};
  const prefix = o.idPrefix || 'html';
  const path = o.path || '';
  const flat = [];
  let seq = 0;
  const mk = (kind, text, label) => ({
    id: `${prefix}.${seq++}`, kind, label, text, editable: true, path, children: []
  });

  let block = null;    // the block element currently open
  let anchor = null;    // an <a> currently open
  let skip = 0;         // depth inside <script>/<style>/<noscript>
  let last = 0, m;

  const closeBlock = () => {
    if (!block) return;
    const text = squash(block.buf);
    // Empty blocks: in a theme template an empty setting is a slot the schema reserved,
    // so it is always kept. In hand-written HTML an empty element usually exists only
    // because someone typed it — an empty <p> is a spacer, not an intention. The one
    // exception is <li>: a blank item in a list of three is an unfinished bullet, and a
    // writer should see it.
    if (text || block.kids.length || block.kind === 'LI'){
      const node = mk(block.kind, text, block.label);
      node.children = block.kids;
      flat.push(node);
    }
    block = null;
  };
  const pushText = t => {
    if (!t || skip) return;
    if (anchor) anchor.buf += t;
    else if (block) block.buf += t;
  };

  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(html))){
    pushText(html.slice(last, m.index));
    last = TAG_RE.lastIndex;
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    const attrs = m[3] || '';

    if (tag === 'script' || tag === 'style' || tag === 'noscript'){
      skip = Math.max(0, skip + (closing ? -1 : 1));
      continue;
    }
    if (skip) continue;
    if (tag === 'br'){ pushText(' '); continue; }

    if (tag === 'img' && !closing){
      const alt = attr(attrs, 'alt');
      // alt="" is kept as an unfilled slot: on a landing page a missing image
      // description is exactly the kind of gap a copy pass should surface.
      if (alt !== null){
        const node = mk('IMAGE', squash(alt), 'img alt');
        (block ? block.kids : flat).push(node);
      }
      continue;
    }

    if (tag === 'a'){
      if (!closing){ anchor = { href: attr(attrs, 'href') || '', buf: '' }; continue; }
      if (anchor){
        const text = squash(anchor.buf);
        const node = mk('A', text, anchor.href ? `link → ${anchor.href}` : 'link');
        (block ? block.kids : flat).push(node);
        if (block) block.buf += anchor.buf;   // the link text still reads as part of the paragraph
        anchor = null;
      }
      continue;
    }

    const kind = BLOCK_KIND[tag];
    if (!kind) continue;
    // Opening a block while one is still open means the previous one was never closed —
    // common in pasted CMS HTML. Treat it as an implicit close rather than losing it.
    if (!closing){ closeBlock(); block = { kind, label: tag, buf: '', kids: [] }; }
    else closeBlock();
  }
  pushText(html.slice(last));
  closeBlock();

  return nestByHeading(flat);
}

/* ---------- theme JSON → OutlineNode[] ---------- */

const looksLikeHtml = v => /<(p|h[1-6]|ul|ol|li|br|strong|em|a)\b[^>]*>/i.test(v || '');

/**
 * Remove `/* *\/` and `//` comments from a theme JSON file.
 *
 * Shopify tolerates comments in JSON templates and theme developers use them for file
 * headers; JSON.parse does not. Stripping them cannot be a regex: `//` appears inside
 * perfectly ordinary values — `shopify://shop_images/x.png`, `https://…` — and those
 * values are what the config rejection keys off, so mangling them would silently turn
 * config into copy. So this tracks string state, with escapes, and only strips outside one.
 *
 * Block comments are replaced by the newlines they contained, so line numbers in a
 * downstream parse error still point at the real line in the original file.
 */
export function stripJsonComments(src){
  const s = String(src == null ? '' : src);
  let out = '', i = 0, inStr = false;
  while (i < s.length){
    const c = s[i];
    if (inStr){
      if (c === '\\'){ out += c + (s[i + 1] ?? ''); i += 2; continue; }
      if (c === '"') inStr = false;
      out += c; i++; continue;
    }
    if (c === '"'){ inStr = true; out += c; i++; continue; }
    if (c === '/' && s[i + 1] === '*'){
      const end = s.indexOf('*/', i + 2);
      const seg = s.slice(i, end < 0 ? s.length : end + 2);
      out += seg.replace(/[^\n]/g, '');
      i = end < 0 ? s.length : end + 2;
      continue;
    }
    if (c === '/' && s[i + 1] === '/'){
      let end = i + 2;
      while (end < s.length && s[end] !== '\n' && s[end] !== '\r') end++;
      i = end;                       // the newline itself is copied on the next pass
      continue;
    }
    out += c; i++;
  }
  return out;
}

// JSON.parse says what it choked on but not where, in a 200KB template. Say where.
function describeJsonError(err, text){
  const msg = err && err.message ? err.message : String(err);
  const m = /position (\d+)/.exec(msg);
  if (!m) return msg;
  const pos = Math.min(+m[1], text.length);
  const before = text.slice(0, pos);
  const line = before.split('\n').length;
  const col = pos - before.lastIndexOf('\n');
  const snippet = text.slice(Math.max(0, pos - 50), pos + 50).replace(/\s+/g, ' ').trim();
  return `${msg} (line ${line}, column ${col}) near: …${snippet}…`;
}

// One section's (or block's) settings, in key order, as a flat list of copy slots.
function settingsToNodes(settings, basePath, depth){
  if (!settings || typeof settings !== 'object') return [];
  const out = [];
  for (const [key, raw] of Object.entries(settings)){
    if (typeof raw !== 'string') continue;      // numbers/booleans/objects are never copy
    const kind = classifySetting(key, raw, depth);
    if (!kind) continue;
    const path = `${basePath}.${key}`;

    // Rich text is HTML in a string. Explode it into paragraphs and links rather than
    // handing a writer a wall of markup, and hang the pieces off the same setting path —
    // they share one write-back target, so paths are unique per setting, not per node.
    // Their ids are ordinal within the setting, which means adding a paragraph upstream
    // shifts the ids after it and detaches their drafts. Acceptable for now; the fix
    // would be hashing each piece's text into its id.
    if (looksLikeHtml(raw)){
      const kids = parseHtmlOutline(raw, { idPrefix: path, path });
      if (kids.length){
        out.push({ id: path, kind: 'GROUP', label: `${key} · rich text`, path, editable: false, children: kids });
        continue;
      }
    }
    out.push({ id: path, kind, label: key, text: raw, editable: true, path, children: [] });
  }
  return out;
}

const hasEditable = nodes => nodes.some(n => (n.editable && n.kind !== 'GROUP') || hasEditable(n.children || []));

/**
 * A theme JSON template (templates/page.*.json) → OutlineNode[].
 *
 * Section setting keys are theme-defined, so there is no schema to read — every string
 * setting is classified copy-vs-config by `classifySetting`. Sections that turn out to be
 * all configuration are dropped.
 */
export function parseThemeTemplate(source, filename){
  let doc;
  if (typeof source === 'string'){
    const cleaned = stripJsonComments(source);
    try { doc = JSON.parse(cleaned); }
    catch (e){ throw new Error(describeJsonError(e, cleaned)); }
  } else {
    doc = source || {};
  }
  const sections = doc.sections || {};
  const order = Array.isArray(doc.order) && doc.order.length ? doc.order : Object.keys(sections);

  const out = [];
  for (const key of order){
    const sec = sections[key];
    if (!sec || typeof sec !== 'object') continue;
    const secPath = `sections.${key}`;

    const own = settingsToNodes(sec.settings, `${secPath}.settings`, 'section');

    const blocks = [];
    const blockOrder = Array.isArray(sec.block_order) && sec.block_order.length
      ? sec.block_order : Object.keys(sec.blocks || {});
    for (const bk of blockOrder){
      const blk = (sec.blocks || {})[bk];
      if (!blk || typeof blk !== 'object') continue;
      const bPath = `${secPath}.blocks.${bk}`;
      const kids = settingsToNodes(blk.settings, `${bPath}.settings`, 'block');
      if (!kids.length) continue;
      blocks.push({
        id: bPath, kind: 'BLOCK', label: blk.type ? `block · ${blk.type}` : 'block',
        path: bPath, editable: false, children: nestByHeading(kids)
      });
    }

    // Heading-nesting applies to the section's OWN settings; blocks hang off the section
    // itself. Blocks are structurally siblings of the settings object, and JSON key order
    // is whatever the theme author typed — letting a subheading key that happens to sort
    // last swallow every block would make the outline shape depend on nothing real.
    const children = [...nestByHeading(own), ...blocks];
    if (!children.length || !hasEditable(children)) continue;   // all-config section

    out.push({
      id: secPath, kind: 'SECTION',
      label: sec.type ? `${key} · ${sec.type}` : key,
      path: secPath, editable: false, children
    });
  }
  return out;
}

/* ---------- walking, counting, exporting ---------- */

export function walk(nodes, fn, depth){
  (nodes || []).forEach(n => { fn(n, depth || 0); walk(n.children, fn, (depth || 0) + 1); });
}

// Every writable slot, flattened, in reading order.
export function slotsOf(nodes){
  const out = [];
  walk(nodes, n => { if (n.editable && n.kind !== 'GROUP') out.push(n); });
  return out;
}

export function countSlots(nodes){
  const slots = slotsOf(nodes);
  return { total: slots.length, empty: slots.filter(s => !String(s.text || '').trim()).length };
}

const MD_PREFIX = { H1:'# ', H2:'## ', H3:'### ', H4:'#### ', LI:'- ', A:'→ ', QUOTE:'> ', IMAGE:'alt: ' };

/**
 * The outline as markdown with drafts substituted in — paste into a doc or a ticket.
 * `drafts` is { [nodeId]: { value } }.
 */
export function toMarkdown(nodes, drafts, title){
  const d = drafts || {};
  const lines = title ? [`# ${title}`, ''] : [];
  walk(nodes, n => {
    if (n.kind === 'SECTION' || n.kind === 'BLOCK' || n.kind === 'GROUP'){
      if (n.kind === 'SECTION') lines.push('', `<!-- ${n.label || n.id} -->`);
      return;
    }
    const draft = d[n.id] && String(d[n.id].value || '').trim();
    const text = draft || String(n.text || '').trim();
    if (!text){ lines.push(`${MD_PREFIX[n.kind] || ''}[EMPTY SLOT — ${n.kind} · ${n.label || n.id}]`); return; }
    lines.push(`${MD_PREFIX[n.kind] || ''}${text}`);
    if (draft && draft !== String(n.text || '').trim()) lines.push(`  <!-- was: ${String(n.text || '').trim() || '(empty)'} -->`);
  });
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/**
 * Every slot with its path, the store copy, the draft and its status. Those `path`
 * values are the write-back targets if write-back is ever built.
 */
export function toExportJson(nodes, drafts, meta){
  const d = drafts || {};
  return {
    ...(meta || {}),
    exportedAt: new Date().toISOString(),
    slots: slotsOf(nodes).map(n => {
      const draft = d[n.id] || null;
      return {
        id: n.id, kind: n.kind, label: n.label || '', path: n.path || '',
        storeCopy: n.text || '',
        draft: draft ? draft.value : '',
        status: draft ? (draft.status || 'ai') : 'none',
        storeChangedSinceEdit: !!(draft && draft.sourceAtEdit != null && draft.sourceAtEdit !== (n.text || '')),
        length: checkLength(n.kind, (draft ? draft.value : '') || n.text || '')
      };
    })
  };
}
