ALTER TABLE "orchestrator_conversation_turns" DROP CONSTRAINT "orchestrator_conversation_turns_outcome";--> statement-breakpoint
ALTER TABLE "orchestrator_conversation_turns" DROP CONSTRAINT "orchestrator_conversation_turns_skill_catalog_binding";--> statement-breakpoint
ALTER TABLE "orchestrator_conversation_turns" ADD CONSTRAINT "orchestrator_conversation_turns_outcome" CHECK (
    ("orchestrator_conversation_turns"."outcome" = 'completed' and "orchestrator_conversation_turns"."provider_thread_ref" is not null and "orchestrator_conversation_turns"."failure_code" is null)
    or ("orchestrator_conversation_turns"."outcome" = 'failed' and "orchestrator_conversation_turns"."failure_code" in
      ('adapter_unavailable', 'adapter_timeout', 'adapter_failed', 'invalid_provider_output', 'skill_catalog_unavailable') and "orchestrator_conversation_turns"."provider_thread_ref" is null)
  );--> statement-breakpoint
ALTER TABLE "orchestrator_conversation_turns" ADD CONSTRAINT "orchestrator_conversation_turns_skill_catalog_binding" CHECK (
    ("orchestrator_conversation_turns"."skill_catalog_binding_hash" = 'LEGACY_NOT_RECORDED' and "orchestrator_conversation_turns"."profile_snapshot" = '{"version":"legacy_not_recorded"}'::jsonb and "orchestrator_conversation_turns"."manifest_snapshots" = '[]'::jsonb and "orchestrator_conversation_turns"."playbook_snapshots" = '[]'::jsonb)
    or ("orchestrator_conversation_turns"."skill_catalog_binding_hash" = 'UNAVAILABLE_NOT_BOUND' and "orchestrator_conversation_turns"."profile_snapshot" = '{"version":"unavailable_not_bound"}'::jsonb and "orchestrator_conversation_turns"."manifest_snapshots" = '[]'::jsonb and "orchestrator_conversation_turns"."playbook_snapshots" = '[]'::jsonb)
    or ("orchestrator_conversation_turns"."skill_catalog_binding_hash" ~ '^[a-f0-9]{64}$'
      and jsonb_typeof("orchestrator_conversation_turns"."profile_snapshot") = 'object'
      and "orchestrator_conversation_turns"."profile_snapshot" ?& array['version', 'profileRef', 'revision', 'profileHash']
      and "orchestrator_conversation_turns"."profile_snapshot" - array['version', 'profileRef', 'revision', 'profileHash'] = '{}'::jsonb
      and jsonb_typeof("orchestrator_conversation_turns"."manifest_snapshots") = 'array' and jsonb_array_length("orchestrator_conversation_turns"."manifest_snapshots") between 1 and 9
      and jsonb_typeof("orchestrator_conversation_turns"."playbook_snapshots") = 'array' and jsonb_array_length("orchestrator_conversation_turns"."playbook_snapshots") between 0 and 12
      and "orchestrator_conversation_turns"."playbook_snapshots"::text !~* '"(body|content|prompt|token|secret|authorization)"[[:space:]]*:')
  );