// Structured-output tool schemas. These live server-side so the model's output
// shape is authoritative and the browser only ever sends {system, user, model}.

export const EMIT_COPY = {
  name: 'emit_copy',
  description: 'Return the final landing-page copy with per-rule scoring and the compliance gate.',
  input_schema: { type:'object', properties:{
    big_promise_used:{ type:'string' },
    inferred_promise:{ type:'boolean' },
    copy:{ type:'string', description:'Final copy in the template composition, markdown.' },
    lp_checks:{ type:'array', items:{ type:'object', properties:{
      id:{type:'string'}, name:{type:'string'}, present:{type:'boolean'}, evidence:{type:'string'} },
      required:['id','present'] } },
    module_checks:{ type:'array', items:{ type:'object', properties:{
      id:{type:'string'}, name:{type:'string'}, pass:{type:'boolean'}, note:{type:'string'} },
      required:['id','pass'] } },
    copy_checks:{ type:'array', items:{ type:'object', properties:{
      id:{type:'string'}, name:{type:'string'}, score:{type:'integer', enum:[0,1,2]},
      justification:{type:'string'}, fix_applied:{type:'string'} }, required:['id','score'] } },
    claim_mapping:{ type:'array', items:{ type:'object', properties:{
      claim:{type:'string'}, fact_sheet_id:{type:'string'} }, required:['claim'] } },
    competitor_swap:{ type:'array', items:{ type:'object', properties:{
      line:{type:'string'}, survives:{type:'boolean'}, rewrite:{type:'string'} }, required:['line','survives'] } },
    compliance_gate:{ type:'object', properties:{
      pass:{type:'boolean'}, blockers:{type:'array', items:{type:'string'}} }, required:['pass'] },
    notes:{ type:'string' }
  }, required:['copy','lp_checks','copy_checks','compliance_gate'] }
};

export const EMIT_AUDIT = {
  name: 'emit_audit',
  description: 'Grade an existing landing page against the quality system and return an improved, evidence-grounded rewrite.',
  input_schema: { type:'object', properties:{
    grade:{ type:'object', properties:{
      score:{type:'integer', minimum:0, maximum:100},
      verdict:{type:'string', description:'one word: Strong / Mixed / Weak'},
      summary:{type:'string'}
    }, required:['score','summary'] },
    lp_checks:{ type:'array', items:{ type:'object', properties:{
      id:{type:'string'}, name:{type:'string'}, present:{type:'boolean'}, evidence:{type:'string'} }, required:['id','present'] } },
    module_checks:{ type:'array', items:{ type:'object', properties:{
      id:{type:'string'}, name:{type:'string'}, pass:{type:'boolean'}, note:{type:'string'} }, required:['id','pass'] } },
    copy_checks:{ type:'array', items:{ type:'object', properties:{
      id:{type:'string'}, name:{type:'string'}, score:{type:'integer', enum:[0,1,2]}, justification:{type:'string'} }, required:['id','score'] } },
    line_issues:{ type:'array', items:{ type:'object', properties:{
      line:{type:'string'}, type:{type:'string'}, score:{type:'integer', enum:[0,1,2]},
      grounded:{type:'boolean'}, fact_sheet_id:{type:'string'},
      issue:{type:'string'}, suggested_rewrite:{type:'string'} }, required:['line','score','issue'] } },
    improved_copy:{ type:'string', description:'the full improved landing page in the template composition, markdown, grounded strictly in the provided evidence.' },
    compliance_gate:{ type:'object', properties:{
      pass:{type:'boolean'}, blockers:{type:'array', items:{type:'string'}} }, required:['pass'] },
    notes:{ type:'string' }
  }, required:['grade','improved_copy','compliance_gate'] }
};

export const EMIT_MODULE = {
  name: 'emit_module',
  description: 'Read a module\'s first-version image, grade it against the module rules, rewrite it, then re-check the rewrite.',
  input_schema: { type:'object', properties:{
    v1_read:{ type:'object', description:'what the image actually shows — read it before judging it', properties:{
      visual:{ type:'string', description:'the image/scene in the module: who or what is pictured, what moment it is' },
      one_second_takeaway:{ type:'string', description:'what a parent understands about this module in one second of looking at it' },
      hierarchy:{ type:'string', description:'reading order and relative weight of the elements' },
      mobile_fold:{ type:'string', description:'whether the module reads within one page fold on mobile' },
      lines:{ type:'array', items:{ type:'object', properties:{
        text:{type:'string', description:'the line, transcribed verbatim from the image'},
        type:{type:'string', description:'h1 / h2 / h3 / p / bullet / cta / eyebrow / caption'} }, required:['text'] } }
    }, required:['visual','one_second_takeaway','lines'] },
    v1_grade:{ type:'object', properties:{
      score:{type:'integer', minimum:0, maximum:100},
      verdict:{type:'string', description:'one word: Strong / Mixed / Weak'},
      summary:{type:'string'}
    }, required:['score','summary'] },
    v1_module_checks:{ type:'array', description:'the first version scored against every module rule',
      items:{ type:'object', properties:{
        id:{type:'string'}, name:{type:'string'}, score:{type:'integer', enum:[0,1,2]},
        gating:{type:'boolean', description:'true for ACTIVE rules, false for advisory ones'},
        issue:{type:'string'}, fix:{type:'string'} }, required:['id','score'] } },
    v1_copy_checks:{ type:'array', description:'the first version scored against each Copy_Checks rule',
      items:{ type:'object', properties:{
        id:{type:'string'}, name:{type:'string'}, score:{type:'integer', enum:[0,1,2]}, justification:{type:'string'} },
        required:['id','score'] } },
    v1_line_issues:{ type:'array', items:{ type:'object', properties:{
      line:{type:'string', description:'the first-version line, verbatim'},
      type:{type:'string'}, score:{type:'integer', enum:[0,1,2]},
      grounded:{type:'boolean'}, fact_sheet_id:{type:'string'},
      issue:{type:'string'}, suggested_rewrite:{type:'string'} }, required:['line','score','issue'] } },
    improved_module:{ type:'object', description:'the rewritten module', properties:{
      headline:{type:'string'}, subhead:{type:'string'}, body:{type:'string'},
      bullets:{ type:'array', items:{type:'string'} }, cta:{type:'string'},
      visual_direction:{type:'string', description:'the specific, ownable moment the image should show for this copy to land'},
      markdown:{type:'string', description:'the whole rewritten module as markdown, in reading order'}
    }, required:['headline','markdown'] },
    improved_module_checks:{ type:'array', description:'the REWRITE re-checked against every module rule',
      items:{ type:'object', properties:{
        id:{type:'string'}, name:{type:'string'}, score:{type:'integer', enum:[0,1,2]},
        pass:{type:'boolean'}, gating:{type:'boolean'}, note:{type:'string'} }, required:['id','score','pass'] } },
    improved_copy_checks:{ type:'array', description:'the REWRITE scored against each Copy_Checks rule',
      items:{ type:'object', properties:{
        id:{type:'string'}, name:{type:'string'}, score:{type:'integer', enum:[0,1,2]}, justification:{type:'string'} },
        required:['id','score'] } },
    improved_line_checks:{ type:'array', description:'every line of the REWRITE against the Copy_Checks pass logic',
      items:{ type:'object', properties:{
        line:{type:'string'}, type:{type:'string'}, score:{type:'integer', enum:[0,1,2]},
        passes_logic:{type:'boolean', description:'satisfies all mandatory rules and at least one optional rule'},
        grounded:{type:'boolean'}, fact_sheet_id:{type:'string'}, note:{type:'string'} }, required:['line','score'] } },
    claim_mapping:{ type:'array', items:{ type:'object', properties:{
      claim:{type:'string'}, fact_sheet_id:{type:'string'} }, required:['claim'] } },
    competitor_swap:{ type:'array', items:{ type:'object', properties:{
      line:{type:'string'}, survives:{type:'boolean'}, rewrite:{type:'string'} }, required:['line','survives'] } },
    compliance_gate:{ type:'object', properties:{
      pass:{type:'boolean'}, blockers:{type:'array', items:{type:'string'}} }, required:['pass'] },
    notes:{ type:'string' }
  }, required:['v1_read','v1_grade','v1_module_checks','improved_module','improved_module_checks','compliance_gate'] }
};

export const EMIT_REVIEW = {
  name: 'emit_review',
  description: 'Return an independent holistic + line-by-line review of the landing-page copy.',
  input_schema: { type:'object', properties:{
    holistic:{ type:'object', properties:{
      score:{type:'integer', minimum:0, maximum:100},
      verdict:{type:'string', description:'one word: Strong / Mixed / Weak'},
      summary:{type:'string'},
      strengths:{type:'array', items:{type:'string'}},
      risks:{type:'array', items:{type:'string'}}
    }, required:['score','summary'] },
    lines:{ type:'array', items:{ type:'object', properties:{
      line:{type:'string', description:'the copy line, verbatim'},
      type:{type:'string', description:'headline / subhead / body / bullet / cta / etc'},
      score:{type:'integer', enum:[0,1,2]},
      rubric_flags:{type:'array', items:{type:'string'}},
      grounded:{type:'boolean', description:'true if every falsifiable claim in the line is supported by provided evidence'},
      fact_sheet_id:{type:'string'},
      notes:{type:'string'},
      suggested_rewrite:{type:'string', description:'evidence-safe rewrite, or blank if none is possible without new facts'}
    }, required:['line','score','notes'] } },
    overall_compliance:{ type:'object', properties:{
      pass:{type:'boolean'}, blockers:{type:'array', items:{type:'string'}} }, required:['pass'] }
  }, required:['holistic','lines','overall_compliance'] }
};
