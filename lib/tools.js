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
    rule_id:{ type:'string', description:'the rule it fails' },
    problem:{ type:'string' },
    fix:{ type:'string', description:'what the final version should do instead' } },
    required:['problem','fix'] }
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

export const MODULE_SCHEMA = {
  type: 'object',
  description: "Read a module's first-version image, grade it against the module rules, rewrite it, then re-check the rewrite.",
  additionalProperties: false,
  properties: {
    v1_read:{ type:'object', additionalProperties:false, description:'what the image actually shows — read it before judging it', properties:{
      visual:{ type:'string', description:'the image/scene in the module: who or what is pictured, what moment it is' },
      one_second_takeaway:{ type:'string', description:'what a parent understands about this module in one second of looking at it' },
      hierarchy:{ type:'string', description:'reading order and relative weight of the elements' },
      mobile_fold:{ type:'string', description:'whether the module reads within one page fold on mobile' },
      lines:{ type:'array', items:{ type:'object', additionalProperties:false, properties:{
        text:{type:'string', description:'the line, transcribed verbatim from the image'},
        type:{type:'string', description:'h1 / h2 / h3 / p / bullet / cta / eyebrow / caption'} }, required:['text'] } }
    }, required:['visual','one_second_takeaway','lines'] },
    v1_grade:{ type:'object', additionalProperties:false, properties:{
      score:{type:'integer', description:'0–100'},
      verdict:{type:'string', description:'one word: Strong / Mixed / Weak'},
      summary:{type:'string'}
    }, required:['score','summary'] },
    v1_module_checks:{ type:'array', description:'the first version scored against every module rule — all of them gate',
      items:{ type:'object', additionalProperties:false, properties:{
        id:{type:'string'}, name:{type:'string'}, score:{type:'integer', enum:[0,1,2]},
        issue:{type:'string'}, fix:{type:'string'} }, required:['id','score'] } },
    v1_copy_checks:{ type:'array', description:'the first version scored against each Copy_Checks rule',
      items:{ type:'object', additionalProperties:false, properties:{
        id:{type:'string'}, name:{type:'string'}, score:{type:'integer', enum:[0,1,2]}, justification:{type:'string'} },
        required:['id','score'] } },
    v1_line_issues:{ type:'array', items:{ type:'object', additionalProperties:false, properties:{
      line:{type:'string', description:'the first-version line, verbatim'},
      type:{type:'string'}, score:{type:'integer', enum:[0,1,2]},
      grounded:{type:'boolean'}, fact_sheet_id:{type:'string'},
      issue:{type:'string'}, suggested_rewrite:{type:'string'} }, required:['line','score','issue'] } },
    draft_rewrite:{ type:'string', description:'First pass at the rewritten module as markdown, in reading order. Not the first version you were shown — your own new one, written off the v1 grade above. This is the version you are going to criticise.' },
    self_critique: selfCritique('your draft_rewrite'),
    improved_module:{ type:'object', additionalProperties:false, description:'the rewritten module, with every fix from self_critique applied — this is the version that ships and the version every improved_* check below scores', properties:{
      headline:{type:'string'}, subhead:{type:'string'}, body:{type:'string'},
      bullets:{ type:'array', items:{type:'string'} }, cta:{type:'string'},
      visual_direction:{type:'string', description:'the specific, ownable moment the image should show for this copy to land'},
      markdown:{type:'string', description:'the whole rewritten module as markdown, in reading order'}
    }, required:['headline','markdown'] },
    improved_module_checks:{ type:'array', description:'the REWRITE re-checked against every module rule',
      items:{ type:'object', additionalProperties:false, properties:{
        id:{type:'string'}, name:{type:'string'}, score:{type:'integer', enum:[0,1,2]},
        pass:{type:'boolean'}, note:{type:'string'} }, required:['id','score','pass'] } },
    improved_copy_checks:{ type:'array', description:'the REWRITE scored against each Copy_Checks rule',
      items:{ type:'object', additionalProperties:false, properties:{
        id:{type:'string'}, name:{type:'string'}, score:{type:'integer', enum:[0,1,2]}, justification:{type:'string'} },
        required:['id','score'] } },
    improved_line_checks:{ type:'array', description:'every line of the REWRITE against the Copy_Checks pass logic',
      items:{ type:'object', additionalProperties:false, properties:{
        line:{type:'string'}, type:{type:'string'}, score:{type:'integer', enum:[0,1,2]},
        passes_logic:{type:'boolean', description:'satisfies all mandatory rules and at least one optional rule'},
        grounded:{type:'boolean'}, fact_sheet_id:{type:'string'}, note:{type:'string'} }, required:['line','score'] } },
    claim_mapping:{ type:'array', items:{ type:'object', additionalProperties:false, properties:{
      claim:{type:'string'}, fact_sheet_id:{type:'string'} }, required:['claim'] } },
    competitor_swap:{ type:'array', items:{ type:'object', additionalProperties:false, properties:{
      line:{type:'string'}, survives:{type:'boolean'}, rewrite:{type:'string'} }, required:['line','survives'] } },
    compliance_gate:{ type:'object', additionalProperties:false, properties:{
      pass:{type:'boolean'}, blockers:{type:'array', items:{type:'string'}} }, required:['pass'] },
    notes:{ type:'string' }
  },
  required:['v1_read','v1_grade','v1_module_checks','draft_rewrite','self_critique','improved_module','improved_module_checks','compliance_gate']
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
