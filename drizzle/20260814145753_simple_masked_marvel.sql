ALTER TABLE "orchestrator_conversation_turns" ADD COLUMN "skill_run_snapshot" jsonb DEFAULT '{"version":"legacy_not_recorded"}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "orchestrator_conversation_turns" ADD COLUMN "skill_run_hash" text DEFAULT 'LEGACY_NOT_RECORDED' NOT NULL;--> statement-breakpoint
ALTER TABLE "orchestrator_conversation_turns" ADD CONSTRAINT "orchestrator_conversation_turns_skill_run" CHECK (
    ("orchestrator_conversation_turns"."skill_run_hash" = 'LEGACY_NOT_RECORDED' and "orchestrator_conversation_turns"."skill_run_snapshot" = '{"version":"legacy_not_recorded"}'::jsonb)
    or ("orchestrator_conversation_turns"."skill_run_hash" = 'UNAVAILABLE_NOT_BOUND' and "orchestrator_conversation_turns"."skill_run_snapshot" = '{"version":"unavailable_not_bound"}'::jsonb)
    or ("orchestrator_conversation_turns"."skill_run_hash" ~ '^[a-f0-9]{64}$'
      and jsonb_typeof("orchestrator_conversation_turns"."skill_run_snapshot") = 'object'
      and "orchestrator_conversation_turns"."skill_run_snapshot" ?& array['version', 'receiptRef', 'receiptHash', 'evidenceContextHash', 'intent', 'selectedSkills', 'evidence', 'handler', 'authority']
      and "orchestrator_conversation_turns"."skill_run_snapshot" - array['version', 'receiptRef', 'receiptHash', 'evidenceContextHash', 'intent', 'selectedSkills', 'evidence', 'handler', 'authority'] = '{}'::jsonb
      and "orchestrator_conversation_turns"."skill_run_snapshot" #>> '{version}' = 'orchestrator-skill-run/1.0.0'
      and "orchestrator_conversation_turns"."skill_run_snapshot"::text !~* '"(name|campaignRef|accountRef|spend|outcome|cpa|title|detail|action|sql|token|secret|authorization|prompt|policy|rule)"[[:space:]]*:')
  );