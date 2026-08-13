// Fixture tests for the two parsers, runnable with no store and no API key.
//
// The parsers are heuristics. That is fine, but it means the only thing standing between
// a "small tweak" and silently swallowing a headline is this file. The discipline:
// anything you change in lib/outline.js needs a case here proving both that the new
// behaviour is caught AND that the old ones still are. This pattern has already caught
// two structural bugs; keep it.

import {
  parseThemeTemplate, parseHtmlOutline, slotsOf, countSlots, checkLength, toMarkdown,
  stripJsonComments
} from './outline.js';
import * as SCHEMAS from './tools.js';

/* ---------- structured-output schema limits ---------- */
// Not parser fixtures, but the same class of bug: invisible until a real call fails, and
// nothing else checks it. MODULE_SCHEMA shipped with 39 optional properties against a limit
// of 24, so module mode 400'd on every request from the moment structured outputs went in.
// The API's message reports the count it measured, and this counter was verified against a
// real rejection (both said 39) — so a green run here means the request will be accepted.
const OPTIONAL_LIMIT = 24;

function schemaProblems(node, path, opt, errs){
  if (!node || typeof node !== 'object') return;
  if (node.type === 'object'){
    const req = new Set(node.required || []);
    if (node.additionalProperties !== false) errs.push(`${path || '(root)'}: object is missing additionalProperties:false`);
    for (const r of req) if (!(node.properties || {})[r]) errs.push(`${path}: required "${r}" is not a declared property`);
    for (const [k, v] of Object.entries(node.properties || {})){
      if (!req.has(k)) opt.push(`${path}.${k}`);
      schemaProblems(v, `${path}.${k}`, opt, errs);
    }
  }
  if (node.type === 'array') schemaProblems(node.items, `${path}[]`, opt, errs);
  // Numeric/length constraints aren't supported by structured outputs — put the range in
  // the description instead.
  for (const k of ['minimum','maximum','minItems','maxItems','minLength','maxLength','pattern']){
    if (node[k] !== undefined) errs.push(`${path}: unsupported constraint "${k}" — state the range in the description`);
  }
}

/* ---------- fixture: a theme page template ---------- */
// Deliberately hostile: every rejection rule and every ordering rule has a case here.
export const THEME_FIXTURE = {
  sections: {
    hero: {
      type: 'hero-banner',
      settings: {
        heading: 'Vitamins made for how kids actually eat',   // H2 at section level
        subheading: '',                                        // unfilled slot — kept on purpose
        button_label: 'Shop the range',                        // A
        image_alt: 'A five-year-old eating breakfast',          // survives despite "image" in the key
        color_scheme: '#ff5a3c',                               // hex value → config
        text_alignment: 'center',                              // hint matches "text", ENUM must catch it
        image: 'shopify://shop_images/hero.png',               // shopify:// → config
        padding_top: '48px',                                   // number+unit → config
        full_width: 'true',                                    // boolean → config
        link: '/collections/all'                               // relative URL → config
      },
      block_order: ['b1', 'b2'],
      blocks: {
        b1: { type: 'column', settings: {
          heading: 'Bio-Matched dosing',                       // same key, in a block → H3
          text: 'Doses matched to what a growing child actually absorbs, not scaled down from an adult pill.'
        } },
        b2: { type: 'column', settings: {
          heading: 'One a day',
          text: '',                                            // unfilled slot inside a block
          icon: 'star'                                         // enum → config
        } }
      }
    },
    science: {
      type: 'rich-text',
      settings: {
        rich_text: '<h3>Behind the science</h3><p>Formulated with a paediatric nutritionist &amp; tested twice.</p><p>Read the <a href="/pages/science">full breakdown</a>.</p>'
      }
    },
    quote_block: {
      type: 'testimonial',
      settings: {
        quote: 'She asks for it. That has never happened with a vitamin.',
        attribution: ''
      }
    },
    layout_only: {
      type: 'spacer',
      settings: { padding_top: '64px', padding_bottom: '64px', color_scheme: '#ffffff', show_divider: 'false' }
    }
  },
  order: ['hero', 'science', 'quote_block', 'layout_only']
};

/* ---------- fixture: a theme template as real themes actually write them ---------- */
// Shaped after templates/page.lp-BTS-master.json on the production theme: a `/* */` file
// header, inline `//` notes, and values that contain `//` themselves. Shopify tolerates the
// comments; JSON.parse does not, and a regex strip would eat the URLs.
export const COMMENTED_TEMPLATE = `/*
 * ----------------------------------------------------------------------------
 * Landing page: Behind the Science (master)
 * Owner: growth · do not rename, the campaign links point at this handle
 * ----------------------------------------------------------------------------
 */
{
  // the hero, above the fold
  "sections": {
    "hero": {
      "type": "hero-banner",
      "settings": {
        "heading": "Behind the science",            // keep this under 6 words
        "image": "shopify://shop_images/hero.png",
        "link": "https://firstday.com/pages/science",
        "note": "50% off /* not a comment */ and // neither is this",
        "quote": "She said \\"finally\\" — // still inside the string",
        "subheading": ""
      }
    }
  },
  "order": ["hero"]
}`;

/* ---------- fixture: an Online Store page body ---------- */
export const HTML_FIXTURE = `
<h2>Why parents switch</h2>
<p>Most kids' vitamins are adult formulas &amp; shrunk down. <a href="/pages/how">See how ours differ</a>.</p>
<ul><li>No added sugar</li><li>Third-party tested</li><li></li></ul>
<blockquote>My daughter actually reminds me now.</blockquote>
<h3>What's inside</h3>
<p>Twelve nutrients at child-appropriate doses.
<img src="/x.png" alt="Label close-up">
<script>var tracking = "<p>not copy</p>";</script>
<p>Free shipping over &pound;30 &mdash; cancel anytime.</p>
`;

/* ---------- runner ---------- */

function run(){
  const results = [];
  const check = (name, fn) => {
    try {
      const detail = fn();
      results.push({ name, pass: true, detail: detail == null ? '' : String(detail) });
    } catch (e){
      results.push({ name, pass: false, detail: e.message });
    }
  };
  const eq = (actual, expected, what) => {
    if (String(actual) !== String(expected)) throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    return `${what} = ${JSON.stringify(actual)}`;
  };
  // `ok` reports nothing on success — its message describes the FAILURE, so echoing it
  // as the detail of a passing check reads as the opposite of what happened.
  const ok = (cond, msg) => { if (!cond) throw new Error(msg); };

  /* --- theme JSON --- */
  const theme = parseThemeTemplate(THEME_FIXTURE, 'templates/page.landing.json');
  const themeSlots = slotsOf(theme);
  const byPath = {};
  themeSlots.forEach(s => { byPath[s.path] = s; });
  const paths = Object.keys(byPath);

  check('all-config section is dropped', () =>
    eq(theme.some(s => s.id === 'sections.layout_only'), false, 'layout_only present'));

  check('sections keep the template order', () =>
    eq(theme.map(s => s.id).join(','), 'sections.hero,sections.science,sections.quote_block', 'section ids'));

  check('KIND_BY_HINT runs before the config-key rejection (image_alt survives)', () => {
    const n = byPath['sections.hero.settings.image_alt'];
    ok(n, 'image_alt was dropped — the hint list is no longer consulted before CONFIG_KEY');
    return eq(n.kind, 'IMAGE', 'image_alt kind');
  });

  check('ENUM_VALUE still catches a hinted key (text_alignment: "center")', () =>
    ok(!byPath['sections.hero.settings.text_alignment'],
       'text_alignment leaked in as copy — ENUM_VALUE must apply to hinted keys too'));

  check('CONFIG_VALUE rejects hex, shopify://, units, booleans, relative URLs', () => {
    ['color_scheme', 'image', 'padding_top', 'full_width', 'link'].forEach(k =>
      ok(!byPath[`sections.hero.settings.${k}`], `${k} leaked in as copy`));
    return '5 config values rejected';
  });

  check('empty strings are kept as unfilled slots when the key hints a role', () => {
    const n = byPath['sections.hero.settings.subheading'];
    ok(n, 'empty subheading was pruned — unfilled slots are the point of the tool');
    ok(n.editable === true && n.text === '', 'empty subheading is not an editable empty slot');
    return 'subheading kept as an empty H3 slot';
  });

  check('every surviving slot records where it came from', () =>
    ok(themeSlots.every(s => s.label), 'a slot came through with no origin label'));

  check('level rule: heading is H2 at section level, H3 inside a block', () => {
    eq(byPath['sections.hero.settings.heading'].kind, 'H2', 'section heading kind');
    return eq(byPath['sections.hero.blocks.b1.settings.heading'].kind, 'H3', 'block heading kind');
  });

  check('blocks hang off the section, not off a settings heading', () => {
    const hero = theme.find(s => s.id === 'sections.hero');
    const blocks = hero.children.filter(c => c.kind === 'BLOCK');
    eq(blocks.length, 2, 'blocks directly under the hero section');
    // Guard the reason for the rule: block placement must not depend on settings key order.
    const shuffled = parseThemeTemplate({
      ...THEME_FIXTURE,
      sections: { ...THEME_FIXTURE.sections, hero: { ...THEME_FIXTURE.sections.hero, settings:
        Object.fromEntries(Object.entries(THEME_FIXTURE.sections.hero.settings).reverse()) } }
    });
    const heroShuffled = shuffled.find(s => s.id === 'sections.hero');
    return eq(heroShuffled.children.filter(c => c.kind === 'BLOCK').length, 2,
              'blocks after reversing settings key order');
  });

  check('a settings heading still owns the settings that follow it', () => {
    const hero = theme.find(s => s.id === 'sections.hero');
    const h2 = hero.children.find(c => c.kind === 'H2');
    ok(h2, 'hero has no H2');
    const h3 = h2.children.find(c => c.kind === 'H3');
    ok(h3, 'the subheading is not nested under the heading');
    return eq(h3.children.some(c => c.kind === 'A'), true, 'button_label nested under the subheading');
  });

  check('rich text is exploded into paragraphs and links', () => {
    const sci = theme.find(s => s.id === 'sections.science');
    const group = sci.children.find(c => c.kind === 'GROUP');
    ok(group, 'rich_text was not exploded into a GROUP');
    const kinds = [];
    const collect = ns => ns.forEach(n => { kinds.push(n.kind); collect(n.children); });
    collect(group.children);
    ok(kinds.includes('H3'), 'rich text heading missing');
    ok(kinds.filter(k => k === 'P').length >= 2, 'rich text paragraphs missing');
    ok(kinds.includes('A'), 'rich text link missing');
    return `kinds: ${kinds.join(',')}`;
  });

  check('quote and attribution are copy slots', () => {
    eq(byPath['sections.quote_block.settings.quote'].kind, 'QUOTE', 'quote kind');
    return eq(byPath['sections.quote_block.settings.attribution'].text, '', 'attribution is an empty slot');
  });

  check('every slot has a path, and ids are unique', () => {
    ok(themeSlots.every(s => s.path), 'a slot has no path — write-back targeting would be impossible');
    // Ids must be unique because drafts key off them. Paths must NOT be assumed unique:
    // every piece of an exploded rich-text setting shares that setting's path, because
    // the setting is the single write-back target for all of them.
    eq(new Set(themeSlots.map(s => s.id)).size, themeSlots.length, 'unique slot ids');
    const shared = paths.length;
    ok(shared < themeSlots.length, 'rich-text pieces no longer share their setting path');
    return `${themeSlots.length} slots across ${shared} distinct paths`;
  });

  check('slot ids are stable across re-parses', () => {
    const again = slotsOf(parseThemeTemplate(THEME_FIXTURE, 'templates/page.landing.json'));
    return eq(again.map(s => s.id).join('|'), themeSlots.map(s => s.id).join('|'), 're-parsed ids');
  });

  check('theme fixture slot + empty counts', () => {
    const c = countSlots(theme);
    ok(c.total >= 10, `expected 10+ slots, got ${c.total}`);
    return eq(c.empty, 3, 'empty slots (subheading, b2.text, attribution)');
  });

  /* --- structured-output schemas --- */
  Object.entries(SCHEMAS).forEach(([name, schema]) => {
    check(`${name} is within the ${OPTIONAL_LIMIT}-optional-property limit`, () => {
      const opt = [], errs = [];
      schemaProblems(schema, '', opt, errs);
      ok(!errs.length, errs.join(' · '));
      ok(opt.length <= OPTIONAL_LIMIT,
         `${opt.length} optional properties — over the limit by ${opt.length - OPTIONAL_LIMIT}. `
         + `Every request using this schema will 400. Promote fields to \`required\` (say in the description what to emit when they don't apply): ${opt.join(', ')}`);
      return `${opt.length}/${OPTIONAL_LIMIT} optional · ${OPTIONAL_LIMIT - opt.length} spare`;
    });
  });

  check('schema property order keeps every check after the copy it scores', () => {
    // Constrained decoding emits fields in schema order, so a field can only be conditioned
    // on the fields above it. A check that sorts before the copy it grades is scoring
    // something the model has not written yet.
    const order = Object.keys(SCHEMAS.SLOTS_SCHEMA.properties);
    const iCritique = order.indexOf('self_critique'), iFinal = order.indexOf('slots');
    ok(order.indexOf('draft') < iCritique, 'draft must precede self_critique');
    ok(iCritique < iFinal, 'self_critique must precede the final slots it fixes');
    return order.join(' → ');
  });

  /* --- theme JSON with comments in it --- */
  check('a JSON template with a /* */ header and // notes parses', () => {
    const t = parseThemeTemplate(COMMENTED_TEMPLATE, 'templates/page.lp-BTS-master.json');
    eq(t.length, 1, 'sections parsed');
    const s = {}; slotsOf(t).forEach(n => { s[n.label] = n; });
    return eq(s.heading.text, 'Behind the science', 'heading survived the strip');
  });

  check('a value containing // is NOT treated as a comment', () => {
    const s = {};
    slotsOf(parseThemeTemplate(COMMENTED_TEMPLATE, 'x')).forEach(n => { s[n.label] = n; });
    // The whole point: strip comments without editing string contents.
    ok(s.note, 'the note setting was dropped entirely');
    eq(s.note.text, '50% off /* not a comment */ and // neither is this', 'note text intact');
    return eq(s.quote.text, 'She said "finally" — // still inside the string', 'escaped quote handled');
  });

  check('URL values survive the strip and are still rejected as config', () => {
    const paths = slotsOf(parseThemeTemplate(COMMENTED_TEMPLATE, 'x')).map(n => n.label);
    // If `shopify://` or `https://` had been mangled into `shopify:` / `https:` the
    // CONFIG_VALUE patterns would stop matching and config would leak in as copy.
    ok(!paths.includes('image'), 'shopify:// leaked in as copy — the strip damaged the value');
    return ok(!paths.includes('link'), 'https:// leaked in as copy — the strip damaged the value');
  });

  check('an empty setting inside a commented template is still an unfilled slot', () => {
    const s = {};
    slotsOf(parseThemeTemplate(COMMENTED_TEMPLATE, 'x')).forEach(n => { s[n.label] = n; });
    return ok(s.subheading && s.subheading.text === '', 'subheading was lost');
  });

  check('stripJsonComments leaves line numbers intact', () => {
    const before = COMMENTED_TEMPLATE.split('\n').length;
    const after = stripJsonComments(COMMENTED_TEMPLATE).split('\n').length;
    // Error messages quote a line number, so the strip must not shift them.
    return eq(after, before, 'line count after stripping');
  });

  check('a genuinely malformed template reports where it broke', () => {
    let msg = '';
    try { parseThemeTemplate('{ "sections": { "a": { "type": "x" } }\n  "order": [] }', 'bad.json'); }
    catch (e){ msg = e.message; }
    ok(msg, 'a malformed template parsed without complaint');
    return ok(/line \d+, column \d+/.test(msg), `error gives no position: ${msg}`);
  });

  /* --- HTML --- */
  const html = parseHtmlOutline(HTML_FIXTURE, { path: 'page.body' });
  const htmlSlots = slotsOf(html);
  const texts = htmlSlots.map(s => s.text);

  check('HTML nests by heading level', () => {
    eq(html.length, 1, 'top-level HTML nodes');
    eq(html[0].kind, 'H2', 'first HTML node kind');
    const h3 = html[0].children.find(c => c.kind === 'H3');
    return ok(h3, 'H3 is not nested under the H2 that precedes it');
  });

  check('a link inside a paragraph becomes that paragraph\'s child', () => {
    const p = htmlSlots.find(s => s.kind === 'P' && /adult formulas/.test(s.text || ''));
    ok(p, 'intro paragraph missing');
    const a = p.children.find(c => c.kind === 'A');
    ok(a, 'link is not a child of its paragraph');
    return eq(a.text, 'See how ours differ', 'link text');
  });

  check('list items, blockquotes and image alt text all become slots', () => {
    eq(htmlSlots.filter(s => s.kind === 'LI').length, 3, 'LI count (including the empty one)');
    eq(htmlSlots.filter(s => s.kind === 'QUOTE').length, 1, 'QUOTE count');
    return eq(htmlSlots.filter(s => s.kind === 'IMAGE').length, 1, 'IMAGE count');
  });

  check('an empty <li> is kept as an unfilled slot', () =>
    ok(htmlSlots.some(s => s.kind === 'LI' && s.text === ''), 'the empty <li> was pruned'));

  check('entities are decoded', () => {
    ok(texts.some(t => /formulas & shrunk/.test(t)), '&amp; was not decoded');
    return ok(texts.some(t => /£30 — cancel/.test(t)), '&pound;/&mdash; were not decoded');
  });

  check('script contents are never treated as copy', () =>
    ok(!texts.some(t => /not copy|var tracking/.test(t)), 'script content leaked into the outline'));

  check('an unclosed <p> is still captured', () =>
    ok(texts.some(t => /Twelve nutrients/.test(t)), 'the unclosed paragraph was lost'));

  check('HTML slots carry the page.body path', () =>
    ok(htmlSlots.every(s => s.path === 'page.body'), 'an HTML slot is missing its path'));

  /* --- length rules --- */
  check('length rules reject a paragraph in a headline slot', () => {
    const bad = checkLength('H1', 'This is a very long headline that runs on and on well past the point where a parent would have stopped reading it entirely');
    ok(!bad.ok, 'an over-length H1 passed');
    const cta = checkLength('A', 'Click here to shop the whole range today');
    ok(!cta.ok, 'an over-length CTA passed');
    const good = checkLength('H1', 'Vitamins made for how kids actually eat');
    ok(good.ok, `a valid H1 (${good.words} words) failed`);
    return `H1 ceiling ${bad.words}w rejected · CTA ${cta.words}w rejected · ${good.words}w H1 accepted`;
  });

  check('an empty slot is unfilled, not length-invalid', () =>
    ok(checkLength('P', '').ok === true && checkLength('P', '').empty === true,
       'an empty slot was reported as a length failure'));

  /* --- export --- */
  check('markdown export substitutes drafts and flags empty slots', () => {
    const md = toMarkdown(theme, {
      'sections.hero.settings.heading': { value: 'A vitamin kids ask for', status: 'edited' }
    }, 'Landing page');
    ok(md.includes('# A vitamin kids ask for') || md.includes('## A vitamin kids ask for'), 'draft was not substituted');
    ok(md.includes('was: Vitamins made for how kids actually eat'), 'the replaced store copy was not recorded');
    return ok(/EMPTY SLOT/.test(md), 'empty slots are not flagged in the markdown export');
  });

  return results;
}

/** Run the fixtures and render the result as markdown. */
export function selftestMarkdown(){
  const results = run();
  const failed = results.filter(r => !r.pass);
  const lines = [
    '# Parser selftest',
    '',
    failed.length ? `**${failed.length} of ${results.length} checks FAILED.**` : `**All ${results.length} checks passed.**`,
    '',
    'Fixtures only — no store, no API key, no database.',
    ''
  ];
  results.forEach(r => {
    lines.push(`- ${r.pass ? '✅' : '❌'} **${r.name}**${r.detail ? `  \n      ${r.detail}` : ''}`);
  });
  if (failed.length){
    lines.push('', '## Failures', '');
    failed.forEach(r => lines.push(`### ${r.name}`, '', '```', r.detail, '```', ''));
  }
  return { markdown: lines.join('\n'), pass: !failed.length, total: results.length, failed: failed.length };
}
