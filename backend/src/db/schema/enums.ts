import {pgEnum} from 'drizzle-orm/pg-core';

/**
 * The two coordination enums between the backend agent and the dashboard.
 * Every value needs a matching affordance in the frontend, so these are real
 * Postgres enums rather than free text: adding a value has to be deliberate.
 */

// Mirrors the application tracker's stages, plus `matched` (a pursuit exists
// but no email has gone out) and `dead` (the agent's mark_dead tool).
export const pursuitStage = pgEnum('pursuit_stage', [
  'matched',
  'contacted',
  'tour_scheduled',
  'toured',
  'applied',
  'decided',
  'dead',
]);

// Each reason needs its own resolve-flow in the Needs you queue.
export const needsHumanReason = pgEnum('needs_human_reason', [
  'no_contact',
  'unanswerable_question',
  'no_fitting_slot',
  'portal_link',
  'missing_document',
  'decision',
]);

export type PursuitStage = (typeof pursuitStage.enumValues)[number];
export type NeedsHumanReason = (typeof needsHumanReason.enumValues)[number];
