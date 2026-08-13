// Structured-output schemas. These live server-side so the model's output shape is
// authoritative and the browser only ever sends {system, user, model}.
//
// These are passed as output_config.format.schema (structured outputs), not as tool
// input_schema. Two rules that come with that: every object needs
// `additionalProperties: false`, and numeric range constraints (minimum/maximum)
// aren't supported — put the range in the description instead.
//
// Property ORDER is load-bearing. Constrained decoding emits fields in schema order,
// so a field can only be conditioned on the fields above it. That's why `copy` sits
// after `draft` and `self_critique`, and why the checks sit after `copy`.

// The draft → critique → final loop, shared by every mode that produces copy. The
// version written AFTER the critique is the only one conditioned on it, so the field
// that ships always sits below `self_critique`.
const selfCritique = subject => ({
  type: 'array',
  description: `What is wrong with ${subject} above, judged against the rubric. Be specific and unsparing; a critique that finds nothing is a critique you did not do.`,
  items:{ type:'object', additionalProperties:false, properties:{
    line:{ type:'string', description:'the line at fault, verbatim' },
    rule_id:{ type:'string', description:'the rule it fails, or "—" when the problem is not rule-specific' },
    problem:{ type:'string' },
    fix:{ type:'string', description:'what the final version should do instead' } },
    // All four are required. Structured outputs cap a schema at 24 OPTIONAL properties
    // (anything absent from `required`) — the grammar compiler rejects the whole request
    // past that. A critique that names neither the line nor the rule is also the weaker
    // artifact, so requiring them costs nothing worth keeping.
    required:['line','rule_id','problem','fix'] }
});

export const COPY_SCHEMA = {
  type: 'object',
  description: 'Final landing-page copy with per-rule scoring and the compliance gate.',
  additionalProperties: false,
  properties: {
    big_promise_used:{ type:'string' },
    inferred_promise:{ type:'boolean' },
    draft:{ type:'string', description:'First pass at the copy, in the template composition, markdown. Write it before judging anything — this is the version you are going to criticise.' },
    self_critique: selfCritique('the draft'),
    copy:{ type:'string', description:'Final copy in the template composition, markdown. Apply every fix from self_critique. This is the version that ships and the version every check below scores.' },
    lp_checks:{ type:'array', description:'the FINAL copy against each LP requirement',
      items:{ type:'object', additionalProperties:false, properties:{
        id:{type:'string'}, name:{type:'string'}, present:{type:'boolean'}, evidence:{type:'string'} },
        required:['id','present'] } },
    module_checks:{ type:'array', items:{ type:'object', additionalProperties:false, properties:{
      id:{type:'string'}, name:{type:'string'}, pass:{type:'boolean'}, note:{type:'string'} },
      required:['id','pass'] } },
    copy_checks:{ type:'array', description:'the FINAL copy against each Copy_Checks rule',
      items:{ type:'object', additionalProperties:false, properties:{
        id:{type:'string'}, name:{type:'string'}, score:{type:'integer', enum:[0,1,2]},
        justification:{type:'string'}, fix_applied:{type:'string'} }, required:['id','score'] } },
    claim_mapping:{ type:'array', items:{ type:'object', additionalProperties:false, properties:{
      claim:{type:'string'}, fact_sheet_id:{type:'string'} }, required:['claim'] } },
    competitor_swap:{ type:'array', items:{ type:'object', additionalProperties:false, properties:{
      line:{type:'string'}, survives:{type:'boolean'}, rewrite:{type:'string'} }, required:['line','survives'] } },
    compliance_gate:{ type:'object', additionalProperties:false, properties:{
      pass:{type:'boolean'}, blockers:{type:'array', items:{type:'string'}} }, required:['pass'] },
    notes:{ type:'string' }
  },
  required:['draft','self_critique','copy','lp_checks','copy_checks','compliance_gate']
};

export const AUDIT_SCHEMA = {
  type: 'object',
  description: 'Grade an existing landing page against the quality system and return an improved, evidence-grounded rewrite.',
  additionalProperties: false,
  properties: {
    grade:{ type:'object', additionalProperties:false, properties:{
      score:{type:'integer', description:'0–100'},
      verdict:{type:'string', description:'one word: Strong / Mixed / Weak'},
      summary:{type:'string'}
    }, required:['score','summary'] },
    lp_checks:{ type:'array', items:{ type:'object', additionalProperties:false, properties:{
      id:{type:'string'}, name:{type:'string'}, present:{type:'boolean'}, evidence:{type:'string'} }, required:['id','present'] } },
    module_checks:{ type:'array', items:{ type:'object', additionalProperties:false, properties:{
      id:{type:'string'}, name:{type:'string'}, pass:{type:'boolean'}, note:{type:'string'} }, required:['id','pass'] } },
    copy_checks:{ type:'array', items:{ type:'object', additionalProperties:false, properties:{
      id:{type:'string'}, name:{type:'string'}, score:{type:'integer', enum:[0,1,2]}, justification:{type:'string'} }, required:['id','score'] } },
    line_issues:{ type:'array', items:{ type:'object', additionalProperties:false, properties:{
      line:{type:'string'}, type:{type:'string'}, score:{type:'integer', enum:[0,1,2]},
      grounded:{type:'boolean'}, fact_sheet_id:{type:'string'},
      issue:{type:'string'}, suggested_rewrite:{type:'string'} }, required:['line','score','issue'] } },
    draft_rewrite:{ type:'string', description:'First pass at the rewritten page, in the template composition, markdown. Not the page you were given — your own new version, written off the grade above. This is the version you are going to criticise.' },
    self_critique: selfCritique('your draft_rewrite'),
    improved_copy:{ type:'string', description:'the full improved landing page in the template composition, markdown, grounded strictly in the provided evidence. Apply every fix from self_critique — this is the version that ships.' },
    compliance_gate:{ type:'object', additionalProperties:false, properties:{
      pass:{type:'boolean'}, blockers:{type:'array', items:{type:'string'}} }, required:['pass'] },
    notes:{ type:'string' }
  },
  required:['grade','draft_rewrite','self_critique','improved_copy','compliance_gate']
};

// This is the largest schema, and structured outputs cap a schema at 24 OPTIONAL
// properties — every property absent from its object's `required` list, counted across the
// whole tree including array `items`. Past that the grammar compiler rejects the request
// outright: "Schemas contains too many optional parameters (N), which would make grammar
// compilation inefficient."
//
// It was written with 39, so module mode failed on every call from the moment structured
// outputs went in. Almost everything here is now required, with each description saying
// what to emit when the field doesn't apply — a required field with nowhere to go invites
// a fabricated value, so "" / [] / "—" are spelled out rather than left to inference.
// Fields that carry prose only on a failure stay optional on purpose: a justification for a
// rule that scored 2 is the single largest thing in a response and says nothing a reader needs.
//
// Before adding a property here, re-run the optional-property count. 24 is a hard ceiling.
export const MODULE_SCHEMA = {
  type: 'object',
  description: "Read a module's first-version image, grade it against the module rules, rewrite it, then re-check the rewrite.",
  additionalProperties: false,
  properties: {
    v1_read:{ type:'object', additionalProperties:false, description:'what the image actually shows — read it before judging it', properties:{
      visual:{ type:'string', description:'the image/scene in the module: who or what is pictured, what moment it is' },
      one_second_takeaway:{ type:'string', description:'what a parent understands about this module in one second of looking at it' },
      hierarchy:{ type:'string', description:'reading order and relative weight of the elements' },
      mobile_fold:{ type:'string', description:'whether the module reads within one page fold on mobile. A module rule gates on this, so answer it even if you have to say what you could not tell from the image.' },
      lines:{ type:'array', items:{ type:'object', additionalProperties:false, properties:{
        text:{type:'string', description:'the line, transcribed verbatim from the image'},
        type:{type:'string', description:'h1 / h2 / h3 / p / bullet / cta / eyebrow / caption — "unclear" if the styling does not tell you'} }, required:['text','type'] } }
    }, required:['visual','one_second_takeaway','hierarchy','mobile_fold','lines'] },
    v1_grade:{ type:'object', additionalProperties:false, properties:{
      score:{type:'integer', description:'0–100'},
      verdict:{type:'string', description:'one word: Strong / Mixed / Weak'},
      summary:{type:'string'}
    }, required:['score','verdict','summary'] },
    v1_module_checks:{ type:'array', description:'the first version scored against every module rule — all of them gate',
      items:{ type:'object', additionalProperties:false, properties:{
        id:{type:'string'}, name:{type:'string', description:'the rule name from the sheet'},
        score:{type:'integer', enum:[0,1,2]},
        issue:{type:'string', description:'what falls short — only when the score is 0 or 1; omit for a 2'},
        fix:{type:'string', description:'what to change — only when the score is 0 or 1; omit for a 2'} },
        required:['id','name','score'] } },
    v1_copy_checks:{ type:'array', description:'the first version scored against each Copy_Checks rule',
      items:{ type:'object', additionalProperties:false, properties:{
        id:{type:'string'}, name:{type:'string'}, score:{type:'integer', enum:[0,1,2]},
        justification:{type:'string', description:'only when the score is 0 or 1; omit for a 2'} },
        required:['id','name','score'] } },
    v1_line_issues:{ type:'array', description:'the first version line by line. Empty array if no line has a problem.',
      items:{ type:'object', additionalProperties:false, properties:{
      line:{type:'string', description:'the first-version line, verbatim'},
      type:{type:'string', description:'h1 / h2 / h3 / p / bullet / cta'},
      score:{type:'integer', enum:[0,1,2]},
      grounded:{type:'boolean', description:'false if the line makes a falsifiable claim the provided evidence does not support; true if it makes no such claim'},
      fact_sheet_id:{type:'string', description:'the row it leans on; omit when the line makes no factual claim'},
      issue:{type:'string'},
      suggested_rewrite:{type:'string', description:'omit when no rewrite is possible without new facts'} },
      required:['line','type','score','grounded','issue'] } },
    draft_rewrite:{ type:'string', description:'First pass at the rewritten module as markdown, in reading order. Not the first version you were shown — your own new one, written off the v1 grade above. This is the version you are going to criticise.' },
    self_critique: selfCritique('your draft_rewrite'),
    improved_module:{ type:'object', additionalProperties:false, description:'the rewritten module, with every fix from self_critique applied — this is the version that ships and the version every improved_* check below scores', properties:{
      headline:{type:'string'},
      subhead:{type:'string', description:'omit if the module should not have one'},
      body:{type:'string', description:'omit if the module is headline-and-CTA only'},
      bullets:{ type:'array', items:{type:'string'}, description:'omit if the module has no list' },
      cta:{type:'string', description:'the button or link text. Empty string if this module genuinely has no CTA.'},
      visual_direction:{type:'string', description:'the specific, ownable moment the image should show for this copy to land'},
      markdown:{type:'string', description:'the whole rewritten module as markdown, in reading order'}
    }, required:['headline','cta','visual_direction','markdown'] },
    improved_module_checks:{ type:'array', description:'the REWRITE re-checked against every module rule',
      items:{ type:'object', additionalProperties:false, properties:{
        id:{type:'string'}, name:{type:'string'}, score:{type:'integer', enum:[0,1,2]},
        pass:{type:'boolean'},
        note:{type:'string', description:'only when the rule does not pass; omit otherwise'} },
        required:['id','name','score','pass'] } },
    improved_copy_checks:{ type:'array', description:'the REWRITE scored against each Copy_Checks rule',
      items:{ type:'object', additionalProperties:false, properties:{
        id:{type:'string'}, name:{type:'string'}, score:{type:'integer', enum:[0,1,2]},
        justification:{type:'string', description:'only when the score is 0 or 1; omit for a 2'} },
        required:['id','name','score'] } },
    improved_line_checks:{ type:'array', description:'every line of the REWRITE against the Copy_Checks pass logic',
      items:{ type:'object', additionalProperties:false, properties:{
        line:{type:'string'}, type:{type:'string', description:'h1 / h2 / h3 / p / bullet / cta'},
        score:{type:'integer', enum:[0,1,2]},
        passes_logic:{type:'boolean', description:'satisfies all mandatory rules and at least one optional rule'},
        grounded:{type:'boolean', description:'false if a falsifiable claim is unsupported by the provided evidence'},
        fact_sheet_id:{type:'string', description:'omit when the line makes no factual claim'},
        note:{type:'string', description:'omit when the line passes cleanly'} },
        required:['line','type','score','passes_logic','grounded'] } },
    claim_mapping:{ type:'array', description:'every falsifiable claim in the rewrite and the row it maps to. Empty array if the rewrite makes no factual claims.',
      items:{ type:'object', additionalProperties:false, properties:{
      claim:{type:'string'},
      fact_sheet_id:{type:'string', description:'blank marks a claim you could not ground — the gate should block on it'} },
      required:['claim'] } },
    competitor_swap:{ type:'array', description:'each line with a competitor name swapped in. Empty array only if the rewrite has no claim-bearing lines.',
      items:{ type:'object', additionalProperties:false, properties:{
      line:{type:'string'}, survives:{type:'boolean'},
      rewrite:{type:'string', description:'a First-Day-only rewrite — only when the line survives the swap'} },
      required:['line','survives'] } },
    compliance_gate:{ type:'object', additionalProperties:false, properties:{
      pass:{type:'boolean'},
      blockers:{type:'array', items:{type:'string'}, description:'empty array when the gate passes'} },
      required:['pass','blockers'] },
    notes:{ type:'string', description:'anything the team needs to know; empty string if nothing' }
  },
  required:['v1_read','v1_grade','v1_module_checks','v1_copy_checks','v1_line_issues','draft_rewrite','self_critique','improved_module','improved_module_checks','improved_copy_checks','improved_line_checks','claim_mapping','competitor_swap','compliance_gate','notes']
};

// Slot mode: writing copy into the slots of a real page's outline, rather than a page
// from scratch. Same draft → critique → final loop as everything else, but the final
// shape is per-slot variants so a writer can pick a line at a time.
//
// Option 1 is closest to what is on the page today and later options get bolder — that
// ordering is what makes the variants useful to choose between rather than N synonyms.
export const SLOTS_SCHEMA = {
  type: 'object',
  description: 'Copy for each requested slot of a landing page, grounded in the provided evidence and scored against Copy_Checks.',
  additionalProperties: false,
  properties: {
    page_promise:{ type:'string', description:'The single thing this page promises the buyer, inferred from the outline and brief. Every slot below must serve it. State it even if the brief already declared one.' },
    draft:{ type:'array', description:'First pass — one line per requested slot, in the order given. Write these before judging anything; this is the version you are going to criticise.',
      items:{ type:'object', additionalProperties:false, properties:{
        id:{type:'string', description:'the slot id, exactly as given'},
        text:{type:'string'} }, required:['id','text'] } },
    self_critique: selfCritique('the draft lines above'),
    slots:{ type:'array', description:'The FINAL variants per slot, with every fix from self_critique applied. One entry per requested slot, same ids, same order.',
      items:{ type:'object', additionalProperties:false, properties:{
        id:{type:'string', description:'the slot id, exactly as given'},
        kind:{type:'string', description:'the slot kind you were given (H1/H2/P/A/…)'},
        variants:{ type:'array', description:'Option 1 stays closest to the current copy and the current length; each later option is a bigger swing. Never more than the requested number.',
          items:{ type:'object', additionalProperties:false, properties:{
            text:{type:'string', description:'the copy itself, and nothing else — no labels, no quotes, no markdown'},
            grounded:{type:'boolean', description:'true only if every falsifiable claim in this line is supported by the provided evidence'},
            fact_sheet_id:{type:'string', description:'the Product Info / claim / quote row this line leans on, blank if it makes no factual claim'},
            verify:{ type:'array', description:'one entry per fact you needed and did not have; each becomes an inline [VERIFY: …] in the line itself',
              items:{type:'string'} },
            // Response size is slots × variants × rules, and it is what makes a big request
            // truncate. A justification on a rule that scored 2 says nothing a reader needs,
            // so it is bought back here: scores for every rule, prose only where it failed.
            copy_checks:{ type:'array', description:'This variant against the Copy_Checks: every mandatory rule, plus the optional rules this line actually satisfies. Give a justification ONLY where the score is 0 or 1 — a rule that scored 2 needs the score and nothing else. Do not justify passes.',
              items:{ type:'object', additionalProperties:false, properties:{
                id:{type:'string'}, score:{type:'integer', enum:[0,1,2]},
                justification:{type:'string', description:'why it fell short, and only when the score is 0 or 1. Omit entirely for a 2.'} },
                required:['id','score'] } },
            note:{type:'string', description:'what this option is doing differently from the others, in one clause'}
          }, required:['text','grounded'] } }
      }, required:['id','variants'] } },
    compliance_gate:{ type:'object', additionalProperties:false, properties:{
      pass:{type:'boolean'}, blockers:{type:'array', items:{type:'string'}} }, required:['pass'] },
    notes:{ type:'string', description:'anything the writer needs to know: slots you could not fill without new facts, conflicts between the brief and what is already on the page.' }
  },
  required:['page_promise','draft','self_critique','slots','compliance_gate']
};

// Simple mode: a short summary in, a header / subheader / body out, written to drive one
// named goal. Any of the three parts can be switched off, so each is a required field that
// carries an empty string when it wasn't asked for — that way "off" is unambiguous rather
// than indistinguishable from "the model forgot".
//
// The goal is the whole point: the same summary written for "add to cart" and for "keep
// reading" are different pieces of copy, and `goal_read` makes the model commit to that
// difference before it writes anything.
export const SIMPLE_SCHEMA = {
  type: 'object',
  description: 'Short-form copy — header, subheader and body — written from a one-line summary to drive a single named goal.',
  additionalProperties: false,
  properties: {
    goal_read:{ type:'string', description:'What the chosen goal demands of this copy: what the reader must feel or believe at the end for them to take that specific action, and what would stop them. One or two sentences. Write this before drafting.' },
    draft:{ type:'object', additionalProperties:false, description:'First pass. Write it before judging anything — this is the version you are going to criticise.', properties:{
      header:{ type:'string' }, subheader:{ type:'string' }, body:{ type:'string' } },
      required:['header','subheader','body'] },
    self_critique: selfCritique('the draft above, judged on whether it actually drives the stated goal'),
    copy:{ type:'object', additionalProperties:false, description:'The FINAL copy with every fix from self_critique applied. Empty string for any part that was not requested — never write a part that was switched off, and never merge it into another part.', properties:{
      header:{ type:'string', description:'empty string if a header was not requested' },
      subheader:{ type:'string', description:'empty string if a subheader was not requested' },
      body:{ type:'string', description:'empty string if body copy was not requested' } },
      required:['header','subheader','body'] },
    goal_fit:{ type:'object', additionalProperties:false, description:'How the final copy drives the goal, and how you would know if it did not.', properties:{
      mechanism:{ type:'string', description:'the specific reason this wording moves someone to that action' },
      next_action:{ type:'string', description:'the exact next thing the reader should do after reading — for a CTA goal, the words that should be on the button' },
      risk:{ type:'string', description:'the most likely reason a reader stops instead, and what in the copy is meant to answer it' } },
      required:['mechanism','next_action','risk'] },
    grounded:{ type:'boolean', description:'true only if every falsifiable claim in the final copy is supported by the provided evidence' },
    fact_sheet_ids:{ type:'array', description:'the Product Info / claim / quote rows the copy leans on. Empty array if it makes no factual claim.', items:{type:'string'} },
    verify:{ type:'array', description:'one entry per fact you needed and did not have; each must also appear inline in the copy as [VERIFY: …]. Empty array if none.', items:{type:'string'} },
    copy_checks:{ type:'array', description:'the FINAL copy against each Copy_Checks rule. Justification only where the score is 0 or 1 — a rule that scored 2 needs the score and nothing else.',
      items:{ type:'object', additionalProperties:false, properties:{
        id:{type:'string'}, score:{type:'integer', enum:[0,1,2]},
        justification:{type:'string', description:'why it fell short; omit for a 2'} },
        required:['id','score'] } },
    compliance_gate:{ type:'object', additionalProperties:false, properties:{
      pass:{type:'boolean'}, blockers:{type:'array', items:{type:'string'}, description:'empty array when the gate passes'} },
      required:['pass','blockers'] },
    notes:{ type:'string', description:'anything the writer needs to know; empty string if nothing' }
  },
  required:['goal_read','draft','self_critique','copy','goal_fit','grounded','fact_sheet_ids','verify','copy_checks','compliance_gate','notes']
};

export const REVIEW_SCHEMA = {
  type: 'object',
  description: 'An independent holistic + line-by-line review of the landing-page copy.',
  additionalProperties: false,
  properties: {
    holistic:{ type:'object', additionalProperties:false, properties:{
      score:{type:'integer', description:'0–100'},
      verdict:{type:'string', description:'one word: Strong / Mixed / Weak'},
      summary:{type:'string'},
      strengths:{type:'array', items:{type:'string'}},
      risks:{type:'array', items:{type:'string'}}
    }, required:['score','summary'] },
    lines:{ type:'array', items:{ type:'object', additionalProperties:false, properties:{
      line:{type:'string', description:'the copy line, verbatim'},
      type:{type:'string', description:'headline / subhead / body / bullet / cta / etc'},
      score:{type:'integer', enum:[0,1,2]},
      rubric_flags:{type:'array', items:{type:'string'}},
      grounded:{type:'boolean', description:'true if every falsifiable claim in the line is supported by provided evidence'},
      fact_sheet_id:{type:'string'},
      notes:{type:'string'},
      suggested_rewrite:{type:'string', description:'evidence-safe rewrite, or blank if none is possible without new facts'}
    }, required:['line','score','notes'] } },
    overall_compliance:{ type:'object', additionalProperties:false, properties:{
      pass:{type:'boolean'}, blockers:{type:'array', items:{type:'string'}} }, required:['pass'] }
  },
  required:['holistic','lines','overall_compliance']
};
