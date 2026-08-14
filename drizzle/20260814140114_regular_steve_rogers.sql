ALTER TABLE "orchestrator_conversation_turns" DROP CONSTRAINT "orchestrator_conversation_turns_skill_catalog_binding";--> statement-breakpoint
ALTER TABLE "orchestrator_conversation_turns" ADD COLUMN "playbook_snapshots" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "orchestrator_conversation_turns" ADD CONSTRAINT "orchestrator_conversation_turns_skill_catalog_binding" CHECK (
    ("orchestrator_conversation_turns"."skill_catalog_binding_hash" = 'LEGACY_NOT_RECORDED' and "orchestrator_conversation_turns"."profile_snapshot" = '{"version":"legacy_not_recorded"}'::jsonb and "orchestrator_conversation_turns"."manifest_snapshots" = '[]'::jsonb and "orchestrator_conversation_turns"."playbook_snapshots" = '[]'::jsonb)
    or ("orchestrator_conversation_turns"."skill_catalog_binding_hash" = 'UNAVAILABLE_NOT_BOUND' and "orchestrator_conversation_turns"."profile_snapshot" = '{"version":"unavailable_not_bound"}'::jsonb and "orchestrator_conversation_turns"."manifest_snapshots" = '[]'::jsonb and "orchestrator_conversation_turns"."playbook_snapshots" = '[]'::jsonb)
    or ("orchestrator_conversation_turns"."skill_catalog_binding_hash" ~ '^[a-f0-9]{64}$'
      and jsonb_typeof("orchestrator_conversation_turns"."profile_snapshot") = 'object'
      and "orchestrator_conversation_turns"."profile_snapshot" ?& array['version', 'profileRef', 'revision', 'profileHash']
      and "orchestrator_conversation_turns"."profile_snapshot" - array['version', 'profileRef', 'revision', 'profileHash'] = '{}'::jsonb
      and jsonb_typeof("orchestrator_conversation_turns"."manifest_snapshots") = 'array' and jsonb_array_length("orchestrator_conversation_turns"."manifest_snapshots") between 1 and 9
      and jsonb_typeof("orchestrator_conversation_turns"."playbook_snapshots") = 'array' and jsonb_array_length("orchestrator_conversation_turns"."playbook_snapshots") between 0 and 12)
  );
