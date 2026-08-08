ALTER TABLE "local_agent_sessions" DROP CONSTRAINT "local_agent_sessions_tools";--> statement-breakpoint
ALTER TABLE "local_agent_sessions" ADD CONSTRAINT "local_agent_sessions_tools" CHECK (
    jsonb_typeof("local_agent_sessions"."allowed_tools") = 'array'
    and jsonb_array_length("local_agent_sessions"."allowed_tools") between 1 and 15
    and "local_agent_sessions"."allowed_tools" <@ '[
      "decision_room_list", "decision_room_mark_inbox_read", "approval_queue_list", "approval_queue_get",
      "policy_bundle_read",
      "budget_lab_list", "budget_lab_get", "budget_lab_dry_run", "budget_lab_save_draft",
      "practice_lab_list", "practice_lab_get", "practice_lab_prepare_draft",
      "existing_post_promotion_preflight", "guidance_registry_list", "guidance_effective_preview"
    ]'::jsonb
  );