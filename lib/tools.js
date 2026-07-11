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
