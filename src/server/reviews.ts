"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dbErrorCode, fail, ok, str, uuid, zodFieldErrors, type ActionState } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";

const rating = z.coerce.number().int().min(1, "rating_required").max(5);

export async function submitPlayerReviewAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = z
    .object({
      match_id: uuid,
      subject_user_id: uuid,
      reliability: rating,
      punctuality: rating,
      sportsmanship: rating,
      organization: rating.optional(),
      comment: z.string().max(500, "too_long").optional(),
    })
    .safeParse({
      match_id: str(fd, "match_id"),
      subject_user_id: str(fd, "subject_user_id"),
      reliability: str(fd, "reliability"),
      punctuality: str(fd, "punctuality"),
      sportsmanship: str(fd, "sportsmanship"),
      organization: str(fd, "organization"),
      comment: str(fd, "comment"),
    });
  if (!parsed.success) return fail("validation", zodFieldErrors(parsed.error));
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_player_review", {
    p_match_id: v.match_id,
    p_subject_user_id: v.subject_user_id,
    p_reliability: v.reliability,
    p_punctuality: v.punctuality,
    p_sportsmanship: v.sportsmanship,
    p_organization: v.organization,
    p_comment: v.comment,
  });
  if (error) return fail(dbErrorCode(error, "submit_player_review"));
  revalidatePath(`/[locale]/matches/${v.match_id}/review`, "page");
  return ok("review_submitted");
}

export async function submitVenueReviewAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = z
    .object({
      venue_id: uuid,
      match_id: uuid.optional(),
      booking_id: uuid.optional(),
      rating,
      comment: z.string().max(500, "too_long").optional(),
    })
    .safeParse({
      venue_id: str(fd, "venue_id"),
      match_id: str(fd, "match_id"),
      booking_id: str(fd, "booking_id"),
      rating: str(fd, "venue_rating"),
      comment: str(fd, "comment"),
    });
  if (!parsed.success) return fail("validation", zodFieldErrors(parsed.error));
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_venue_review", {
    p_venue_id: v.venue_id,
    p_rating: v.rating,
    p_match_id: v.match_id,
    p_booking_id: v.booking_id,
    p_comment: v.comment,
  });
  if (error) return fail(dbErrorCode(error, "submit_venue_review"));
  revalidatePath(`/[locale]/venues/${v.venue_id}`, "page");
  return ok("review_submitted");
}
