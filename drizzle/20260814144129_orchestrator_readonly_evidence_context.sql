ALTER TABLE "orchestrator_conversation_turns" ADD COLUMN "evidence_context_snapshot" jsonb DEFAULT '{"version":"legacy_not_recorded"}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "orchestrator_conversation_turns" ADD COLUMN "evidence_context_hash" text DEFAULT 'LEGACY_NOT_RECORDED' NOT NULL;--> statement-breakpoint
ALTER TABLE "orchestrator_conversation_turns" ADD CONSTRAINT "orchestrator_conversation_turns_evidence_context" CHECK (
    ("orchestrator_conversation_turns"."evidence_context_hash" = 'LEGACY_NOT_RECORDED' and "orchestrator_conversation_turns"."evidence_context_snapshot" = '{"version":"legacy_not_recorded"}'::jsonb)
    or ("orchestrator_conversation_turns"."evidence_context_hash" = 'UNAVAILABLE_NOT_BOUND' and "orchestrator_conversation_turns"."evidence_context_snapshot" = '{"version":"unavailable_not_bound"}'::jsonb)
    or ("orchestrator_conversation_turns"."evidence_context_hash" ~ '^[a-f0-9]{64}$'
      and jsonb_typeof("orchestrator_conversation_turns"."evidence_context_snapshot") = 'object'
      and "orchestrator_conversation_turns"."evidence_context_snapshot" ?& array['version', 'performance', 'timeline']
      and "orchestrator_conversation_turns"."evidence_context_snapshot" - array['version', 'performance', 'timeline'] = '{}'::jsonb
      and "orchestrator_conversation_turns"."evidence_context_snapshot" #>> '{version}' = 'orchestrator-readonly-evidence-context/1.0.0'
      and "orchestrator_conversation_turns"."evidence_context_snapshot"::text !~* '"(name|campaignRef|accountRef|spend|outcome|cpa|title|detail|action|sql|token|secret|authorization)"[[:space:]]*:')
  );