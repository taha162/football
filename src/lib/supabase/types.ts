
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "areas": {
                  Row: {
                    "city_id": string,"id": string,"is_active": boolean,"latitude": number | null,"longitude": number | null,"name_ar": string,"name_en": string,"slug": string
                  }
                  ComputedFields: never
                  Insert: {
                    "city_id": string,"id"?: string,"is_active"?: boolean,"latitude"?: number | null,"longitude"?: number | null,"name_ar": string,"name_en": string,"slug": string
                  }
                  Update: {
                    "city_id"?: string,"id"?: string,"is_active"?: boolean,"latitude"?: number | null,"longitude"?: number | null,"name_ar"?: string,"name_en"?: string,"slug"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "areas_city_id_fkey"
      columns: ["city_id"]
isOneToOne: false
      referencedRelation: "cities"
      referencedColumns: ["id"]
    }
                  ]
                },"audit_logs": {
                  Row: {
                    "action": string,"actor_id": string | null,"created_at": string,"details": NonNullable<Json>,"entity_id": string | null,"entity_type": string,"id": number
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id"?: string | null,"created_at"?: string,"details"?: NonNullable<Json>,"entity_id"?: string | null,"entity_type": string,"id"?: never
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"created_at"?: string,"details"?: NonNullable<Json>,"entity_id"?: string | null,"entity_type"?: string,"id"?: never
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_logs_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"bookings": {
                  Row: {
                    "cancel_reason": string | null,"cancelled_at": string | null,"cancelled_by": string | null,"created_at": string,"created_by": string | null,"currency": string,"customer_name": string | null,"customer_note": string | null,"decided_at": string | null,"decided_by": string | null,"decision_note": string | null,"ends_at": string,"expires_at": string | null,"field_id": string,"id": string,"internal_note": string | null,"kind": Database["public"]['Enums']["booking_kind"],"match_id": string | null,"occupied_until": string,"price_total": number,"requested_by": string | null,"starts_at": string,"status": Database["public"]['Enums']["booking_status"],"updated_at": string,"venue_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cancel_reason"?: string | null,"cancelled_at"?: string | null,"cancelled_by"?: string | null,"created_at"?: string,"created_by"?: string | null,"currency": string,"customer_name"?: string | null,"customer_note"?: string | null,"decided_at"?: string | null,"decided_by"?: string | null,"decision_note"?: string | null,"ends_at": string,"expires_at"?: string | null,"field_id": string,"id"?: string,"internal_note"?: string | null,"kind"?: Database["public"]['Enums']["booking_kind"],"match_id"?: string | null,"occupied_until": string,"price_total"?: number,"requested_by"?: string | null,"starts_at": string,"status"?: Database["public"]['Enums']["booking_status"],"updated_at"?: string,"venue_id": string
                  }
                  Update: {
                    "cancel_reason"?: string | null,"cancelled_at"?: string | null,"cancelled_by"?: string | null,"created_at"?: string,"created_by"?: string | null,"currency"?: string,"customer_name"?: string | null,"customer_note"?: string | null,"decided_at"?: string | null,"decided_by"?: string | null,"decision_note"?: string | null,"ends_at"?: string,"expires_at"?: string | null,"field_id"?: string,"id"?: string,"internal_note"?: string | null,"kind"?: Database["public"]['Enums']["booking_kind"],"match_id"?: string | null,"occupied_until"?: string,"price_total"?: number,"requested_by"?: string | null,"starts_at"?: string,"status"?: Database["public"]['Enums']["booking_status"],"updated_at"?: string,"venue_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "bookings_cancelled_by_fkey"
      columns: ["cancelled_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "bookings_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "bookings_currency_fkey"
      columns: ["currency"]
isOneToOne: false
      referencedRelation: "currencies"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "bookings_decided_by_fkey"
      columns: ["decided_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "bookings_field_id_fkey"
      columns: ["field_id"]
isOneToOne: false
      referencedRelation: "venue_fields"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "bookings_match_fk"
      columns: ["match_id"]
isOneToOne: false
      referencedRelation: "matches"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "bookings_requested_by_fkey"
      columns: ["requested_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "bookings_venue_id_fkey"
      columns: ["venue_id"]
isOneToOne: false
      referencedRelation: "venues"
      referencedColumns: ["id"]
    }
                  ]
                },"cities": {
                  Row: {
                    "country_code": string,"created_at": string,"currency": string,"id": string,"is_active": boolean,"latitude": number | null,"longitude": number | null,"name_ar": string,"name_en": string,"slug": string,"sort_order": number,"timezone": string
                  }
                  ComputedFields: never
                  Insert: {
                    "country_code": string,"created_at"?: string,"currency": string,"id"?: string,"is_active"?: boolean,"latitude"?: number | null,"longitude"?: number | null,"name_ar": string,"name_en": string,"slug": string,"sort_order"?: number,"timezone": string
                  }
                  Update: {
                    "country_code"?: string,"created_at"?: string,"currency"?: string,"id"?: string,"is_active"?: boolean,"latitude"?: number | null,"longitude"?: number | null,"name_ar"?: string,"name_en"?: string,"slug"?: string,"sort_order"?: number,"timezone"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "cities_currency_fkey"
      columns: ["currency"]
isOneToOne: false
      referencedRelation: "currencies"
      referencedColumns: ["code"]
    }
                  ]
                },"conversation_members": {
                  Row: {
                    "conversation_id": string,"created_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "conversation_id": string,"created_at"?: string,"user_id": string
                  }
                  Update: {
                    "conversation_id"?: string,"created_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "conversation_members_conversation_id_fkey"
      columns: ["conversation_id"]
isOneToOne: false
      referencedRelation: "conversations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "conversation_members_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"conversation_reads": {
                  Row: {
                    "conversation_id": string,"last_read_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "conversation_id": string,"last_read_at"?: string,"user_id": string
                  }
                  Update: {
                    "conversation_id"?: string,"last_read_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "conversation_reads_conversation_id_fkey"
      columns: ["conversation_id"]
isOneToOne: false
      referencedRelation: "conversations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "conversation_reads_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"conversations": {
                  Row: {
                    "booking_id": string | null,"challenge_id": string | null,"created_at": string,"direct_key": string | null,"id": string,"is_locked": boolean,"kind": Database["public"]['Enums']["conversation_kind"],"last_message_at": string | null,"match_id": string | null,"team_id": string | null,"tournament_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "booking_id"?: string | null,"challenge_id"?: string | null,"created_at"?: string,"direct_key"?: string | null,"id"?: string,"is_locked"?: boolean,"kind": Database["public"]['Enums']["conversation_kind"],"last_message_at"?: string | null,"match_id"?: string | null,"team_id"?: string | null,"tournament_id"?: string | null
                  }
                  Update: {
                    "booking_id"?: string | null,"challenge_id"?: string | null,"created_at"?: string,"direct_key"?: string | null,"id"?: string,"is_locked"?: boolean,"kind"?: Database["public"]['Enums']["conversation_kind"],"last_message_at"?: string | null,"match_id"?: string | null,"team_id"?: string | null,"tournament_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "conversations_booking_id_fkey"
      columns: ["booking_id"]
isOneToOne: true
      referencedRelation: "bookings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "conversations_challenge_id_fkey"
      columns: ["challenge_id"]
isOneToOne: true
      referencedRelation: "opponent_challenges"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "conversations_match_id_fkey"
      columns: ["match_id"]
isOneToOne: true
      referencedRelation: "matches"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "conversations_team_id_fkey"
      columns: ["team_id"]
isOneToOne: true
      referencedRelation: "teams"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "conversations_tournament_id_fkey"
      columns: ["tournament_id"]
isOneToOne: true
      referencedRelation: "tournaments"
      referencedColumns: ["id"]
    }
                  ]
                },"currencies": {
                  Row: {
                    "code": string,"minor_unit_exponent": number,"name_ar": string,"name_en": string
                  }
                  ComputedFields: never
                  Insert: {
                    "code": string,"minor_unit_exponent": number,"name_ar": string,"name_en": string
                  }
                  Update: {
                    "code"?: string,"minor_unit_exponent"?: number,"name_ar"?: string,"name_en"?: string
                  }
                  Relationships: [
                    
                  ]
                },"match_events": {
                  Row: {
                    "created_at": string,"event_type": Database["public"]['Enums']["match_event_type"],"id": string,"match_id": string,"minute": number | null,"recorded_by": string | null,"team_side": Database["public"]['Enums']["team_side"] | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"event_type": Database["public"]['Enums']["match_event_type"],"id"?: string,"match_id": string,"minute"?: number | null,"recorded_by"?: string | null,"team_side"?: Database["public"]['Enums']["team_side"] | null,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"event_type"?: Database["public"]['Enums']["match_event_type"],"id"?: string,"match_id"?: string,"minute"?: number | null,"recorded_by"?: string | null,"team_side"?: Database["public"]['Enums']["team_side"] | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "match_events_match_id_fkey"
      columns: ["match_id"]
isOneToOne: false
      referencedRelation: "matches"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "match_events_recorded_by_fkey"
      columns: ["recorded_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "match_events_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"match_invitations": {
                  Row: {
                    "created_at": string,"id": string,"invited_by": string | null,"invitee_id": string,"match_id": string,"responded_at": string | null,"status": Database["public"]['Enums']["invitation_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"invited_by"?: string | null,"invitee_id": string,"match_id": string,"responded_at"?: string | null,"status"?: Database["public"]['Enums']["invitation_status"]
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"invited_by"?: string | null,"invitee_id"?: string,"match_id"?: string,"responded_at"?: string | null,"status"?: Database["public"]['Enums']["invitation_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "match_invitations_invited_by_fkey"
      columns: ["invited_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "match_invitations_invitee_id_fkey"
      columns: ["invitee_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "match_invitations_match_id_fkey"
      columns: ["match_id"]
isOneToOne: false
      referencedRelation: "matches"
      referencedColumns: ["id"]
    }
                  ]
                },"match_participants": {
                  Row: {
                    "attendance": Database["public"]['Enums']["attendance_status"] | null,"confirmed_at": string | null,"id": string,"joined_at": string,"late_withdrawal": boolean,"left_at": string | null,"match_id": string,"payment_marked_at": string | null,"payment_marked_by": string | null,"payment_status": Database["public"]['Enums']["manual_payment_status"],"position": Database["public"]['Enums']["player_position"] | null,"promoted_from_waitlist": boolean,"removed_reason": string | null,"status": Database["public"]['Enums']["participant_status"],"team_side": Database["public"]['Enums']["team_side"] | null,"user_id": string,"via_invitation": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "attendance"?: Database["public"]['Enums']["attendance_status"] | null,"confirmed_at"?: string | null,"id"?: string,"joined_at"?: string,"late_withdrawal"?: boolean,"left_at"?: string | null,"match_id": string,"payment_marked_at"?: string | null,"payment_marked_by"?: string | null,"payment_status"?: Database["public"]['Enums']["manual_payment_status"],"position"?: Database["public"]['Enums']["player_position"] | null,"promoted_from_waitlist"?: boolean,"removed_reason"?: string | null,"status": Database["public"]['Enums']["participant_status"],"team_side"?: Database["public"]['Enums']["team_side"] | null,"user_id": string,"via_invitation"?: boolean
                  }
                  Update: {
                    "attendance"?: Database["public"]['Enums']["attendance_status"] | null,"confirmed_at"?: string | null,"id"?: string,"joined_at"?: string,"late_withdrawal"?: boolean,"left_at"?: string | null,"match_id"?: string,"payment_marked_at"?: string | null,"payment_marked_by"?: string | null,"payment_status"?: Database["public"]['Enums']["manual_payment_status"],"position"?: Database["public"]['Enums']["player_position"] | null,"promoted_from_waitlist"?: boolean,"removed_reason"?: string | null,"status"?: Database["public"]['Enums']["participant_status"],"team_side"?: Database["public"]['Enums']["team_side"] | null,"user_id"?: string,"via_invitation"?: boolean
                  }
                  Relationships: [
                    {
      foreignKeyName: "match_participants_match_id_fkey"
      columns: ["match_id"]
isOneToOne: false
      referencedRelation: "matches"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "match_participants_payment_marked_by_fkey"
      columns: ["payment_marked_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "match_participants_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"match_results": {
                  Row: {
                    "away_score": number,"confirmed_at": string | null,"confirmed_by": string | null,"dispute_reason": string | null,"home_score": number,"match_id": string,"reported_at": string,"reported_by": string | null,"reported_side": Database["public"]['Enums']["team_side"] | null,"status": Database["public"]['Enums']["match_result_status"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "away_score": number,"confirmed_at"?: string | null,"confirmed_by"?: string | null,"dispute_reason"?: string | null,"home_score": number,"match_id": string,"reported_at"?: string,"reported_by"?: string | null,"reported_side"?: Database["public"]['Enums']["team_side"] | null,"status"?: Database["public"]['Enums']["match_result_status"],"updated_at"?: string
                  }
                  Update: {
                    "away_score"?: number,"confirmed_at"?: string | null,"confirmed_by"?: string | null,"dispute_reason"?: string | null,"home_score"?: number,"match_id"?: string,"reported_at"?: string,"reported_by"?: string | null,"reported_side"?: Database["public"]['Enums']["team_side"] | null,"status"?: Database["public"]['Enums']["match_result_status"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "match_results_confirmed_by_fkey"
      columns: ["confirmed_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "match_results_match_id_fkey"
      columns: ["match_id"]
isOneToOne: true
      referencedRelation: "matches"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "match_results_reported_by_fkey"
      columns: ["reported_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"match_series": {
                  Row: {
                    "created_at": string,"id": string,"occurrences": number,"organizer_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"occurrences": number,"organizer_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"occurrences"?: number,"organizer_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "match_series_organizer_id_fkey"
      columns: ["organizer_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"match_waitlist": {
                  Row: {
                    "created_at": string,"id": string,"match_id": string,"position": Database["public"]['Enums']["player_position"] | null,"resolved_at": string | null,"seq": number,"status": Database["public"]['Enums']["waitlist_status"],"team_side": Database["public"]['Enums']["team_side"] | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"match_id": string,"position"?: Database["public"]['Enums']["player_position"] | null,"resolved_at"?: string | null,"seq"?: never,"status"?: Database["public"]['Enums']["waitlist_status"],"team_side"?: Database["public"]['Enums']["team_side"] | null,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"match_id"?: string,"position"?: Database["public"]['Enums']["player_position"] | null,"resolved_at"?: string | null,"seq"?: never,"status"?: Database["public"]['Enums']["waitlist_status"],"team_side"?: Database["public"]['Enums']["team_side"] | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "match_waitlist_match_id_fkey"
      columns: ["match_id"]
isOneToOne: false
      referencedRelation: "matches"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "match_waitlist_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"matches": {
                  Row: {
                    "area_id": string | null,"away_team_id": string | null,"booking_id": string | null,"booking_status": Database["public"]['Enums']["match_booking_status"],"cancelled_at": string | null,"cancelled_by": string | null,"cancelled_reason": string | null,"city_id": string,"completed_at": string | null,"confirmed_count": number,"cost_is_estimate": boolean,"created_at": string,"currency": string,"description": string | null,"ends_at": string,"field_id": string | null,"format": Database["public"]['Enums']["match_format"],"hidden_reason": string | null,"home_team_id": string | null,"id": string,"is_hidden": boolean,"join_policy": Database["public"]['Enums']["match_join_policy"],"leave_deadline_hours": number,"location_note": string | null,"match_type": Database["public"]['Enums']["match_type"],"organizer_id": string,"paying_players": number | null,"payment_collector": Database["public"]['Enums']["payment_collector"],"payment_notes": string | null,"pending_count": number,"positions_needed": NonNullable<Json>,"price_per_player": number,"reserved_spots": number,"rules": string | null,"series_id": string | null,"skill_level": Database["public"]['Enums']["skill_level"] | null,"starts_at": string,"status": Database["public"]['Enums']["match_status"],"team_id": string | null,"title": string,"total_cost": number | null,"total_players": number,"updated_at": string,"venue_id": string | null,"visibility": Database["public"]['Enums']["visibility_level"],"waitlist_count": number
                  }
                  ComputedFields: never
                  Insert: {
                    "area_id"?: string | null,"away_team_id"?: string | null,"booking_id"?: string | null,"booking_status"?: Database["public"]['Enums']["match_booking_status"],"cancelled_at"?: string | null,"cancelled_by"?: string | null,"cancelled_reason"?: string | null,"city_id": string,"completed_at"?: string | null,"confirmed_count"?: number,"cost_is_estimate"?: boolean,"created_at"?: string,"currency": string,"description"?: string | null,"ends_at": string,"field_id"?: string | null,"format": Database["public"]['Enums']["match_format"],"hidden_reason"?: string | null,"home_team_id"?: string | null,"id"?: string,"is_hidden"?: boolean,"join_policy"?: Database["public"]['Enums']["match_join_policy"],"leave_deadline_hours"?: number,"location_note"?: string | null,"match_type"?: Database["public"]['Enums']["match_type"],"organizer_id": string,"paying_players"?: number | null,"payment_collector"?: Database["public"]['Enums']["payment_collector"],"payment_notes"?: string | null,"pending_count"?: number,"positions_needed"?: NonNullable<Json>,"price_per_player"?: number,"reserved_spots"?: number,"rules"?: string | null,"series_id"?: string | null,"skill_level"?: Database["public"]['Enums']["skill_level"] | null,"starts_at": string,"status"?: Database["public"]['Enums']["match_status"],"team_id"?: string | null,"title": string,"total_cost"?: number | null,"total_players": number,"updated_at"?: string,"venue_id"?: string | null,"visibility"?: Database["public"]['Enums']["visibility_level"],"waitlist_count"?: number
                  }
                  Update: {
                    "area_id"?: string | null,"away_team_id"?: string | null,"booking_id"?: string | null,"booking_status"?: Database["public"]['Enums']["match_booking_status"],"cancelled_at"?: string | null,"cancelled_by"?: string | null,"cancelled_reason"?: string | null,"city_id"?: string,"completed_at"?: string | null,"confirmed_count"?: number,"cost_is_estimate"?: boolean,"created_at"?: string,"currency"?: string,"description"?: string | null,"ends_at"?: string,"field_id"?: string | null,"format"?: Database["public"]['Enums']["match_format"],"hidden_reason"?: string | null,"home_team_id"?: string | null,"id"?: string,"is_hidden"?: boolean,"join_policy"?: Database["public"]['Enums']["match_join_policy"],"leave_deadline_hours"?: number,"location_note"?: string | null,"match_type"?: Database["public"]['Enums']["match_type"],"organizer_id"?: string,"paying_players"?: number | null,"payment_collector"?: Database["public"]['Enums']["payment_collector"],"payment_notes"?: string | null,"pending_count"?: number,"positions_needed"?: NonNullable<Json>,"price_per_player"?: number,"reserved_spots"?: number,"rules"?: string | null,"series_id"?: string | null,"skill_level"?: Database["public"]['Enums']["skill_level"] | null,"starts_at"?: string,"status"?: Database["public"]['Enums']["match_status"],"team_id"?: string | null,"title"?: string,"total_cost"?: number | null,"total_players"?: number,"updated_at"?: string,"venue_id"?: string | null,"visibility"?: Database["public"]['Enums']["visibility_level"],"waitlist_count"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "matches_area_id_fkey"
      columns: ["area_id"]
isOneToOne: false
      referencedRelation: "areas"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "matches_away_team_id_fkey"
      columns: ["away_team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "matches_booking_id_fkey"
      columns: ["booking_id"]
isOneToOne: false
      referencedRelation: "bookings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "matches_cancelled_by_fkey"
      columns: ["cancelled_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "matches_city_id_fkey"
      columns: ["city_id"]
isOneToOne: false
      referencedRelation: "cities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "matches_currency_fkey"
      columns: ["currency"]
isOneToOne: false
      referencedRelation: "currencies"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "matches_field_id_fkey"
      columns: ["field_id"]
isOneToOne: false
      referencedRelation: "venue_fields"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "matches_home_team_id_fkey"
      columns: ["home_team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "matches_organizer_id_fkey"
      columns: ["organizer_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "matches_series_id_fkey"
      columns: ["series_id"]
isOneToOne: false
      referencedRelation: "match_series"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "matches_team_id_fkey"
      columns: ["team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "matches_venue_id_fkey"
      columns: ["venue_id"]
isOneToOne: false
      referencedRelation: "venues"
      referencedColumns: ["id"]
    }
                  ]
                },"messages": {
                  Row: {
                    "body": string,"conversation_id": string,"created_at": string,"deleted_at": string | null,"id": number,"sender_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "body": string,"conversation_id": string,"created_at"?: string,"deleted_at"?: string | null,"id"?: never,"sender_id"?: string | null
                  }
                  Update: {
                    "body"?: string,"conversation_id"?: string,"created_at"?: string,"deleted_at"?: string | null,"id"?: never,"sender_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "messages_conversation_id_fkey"
      columns: ["conversation_id"]
isOneToOne: false
      referencedRelation: "conversations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "messages_sender_id_fkey"
      columns: ["sender_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"notifications": {
                  Row: {
                    "created_at": string,"dedupe_key": string | null,"id": string,"payload": NonNullable<Json>,"read_at": string | null,"type": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"dedupe_key"?: string | null,"id"?: string,"payload"?: NonNullable<Json>,"read_at"?: string | null,"type": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"dedupe_key"?: string | null,"id"?: string,"payload"?: NonNullable<Json>,"read_at"?: string | null,"type"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notifications_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"opponent_challenges": {
                  Row: {
                    "challenger_team_id": string,"cost_per_team": number | null,"created_at": string,"created_by": string | null,"duration_minutes": number,"format": Database["public"]['Enums']["match_format"],"id": string,"location_note": string | null,"match_id": string | null,"message": string | null,"proposed_starts_at": string,"request_id": string | null,"responded_at": string | null,"responded_by": string | null,"status": Database["public"]['Enums']["challenge_status"],"target_team_id": string,"venue_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "challenger_team_id": string,"cost_per_team"?: number | null,"created_at"?: string,"created_by"?: string | null,"duration_minutes": number,"format": Database["public"]['Enums']["match_format"],"id"?: string,"location_note"?: string | null,"match_id"?: string | null,"message"?: string | null,"proposed_starts_at": string,"request_id"?: string | null,"responded_at"?: string | null,"responded_by"?: string | null,"status"?: Database["public"]['Enums']["challenge_status"],"target_team_id": string,"venue_id"?: string | null
                  }
                  Update: {
                    "challenger_team_id"?: string,"cost_per_team"?: number | null,"created_at"?: string,"created_by"?: string | null,"duration_minutes"?: number,"format"?: Database["public"]['Enums']["match_format"],"id"?: string,"location_note"?: string | null,"match_id"?: string | null,"message"?: string | null,"proposed_starts_at"?: string,"request_id"?: string | null,"responded_at"?: string | null,"responded_by"?: string | null,"status"?: Database["public"]['Enums']["challenge_status"],"target_team_id"?: string,"venue_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "opponent_challenges_challenger_team_id_fkey"
      columns: ["challenger_team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "opponent_challenges_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "opponent_challenges_match_id_fkey"
      columns: ["match_id"]
isOneToOne: false
      referencedRelation: "matches"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "opponent_challenges_request_id_fkey"
      columns: ["request_id"]
isOneToOne: false
      referencedRelation: "opponent_requests"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "opponent_challenges_responded_by_fkey"
      columns: ["responded_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "opponent_challenges_target_team_id_fkey"
      columns: ["target_team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "opponent_challenges_venue_id_fkey"
      columns: ["venue_id"]
isOneToOne: false
      referencedRelation: "venues"
      referencedColumns: ["id"]
    }
                  ]
                },"opponent_requests": {
                  Row: {
                    "area_ids": (string)[],"city_id": string,"cost_per_team": number | null,"created_at": string,"created_by": string | null,"currency": string,"earliest_start": string,"format": Database["public"]['Enums']["match_format"],"id": string,"latest_start": string,"match_id": string | null,"notes": string | null,"rules": string | null,"skill_level": Database["public"]['Enums']["skill_level"] | null,"status": Database["public"]['Enums']["opponent_request_status"],"team_id": string,"venue_id": string | null,"venue_note": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "area_ids"?: (string)[],"city_id": string,"cost_per_team"?: number | null,"created_at"?: string,"created_by"?: string | null,"currency": string,"earliest_start": string,"format": Database["public"]['Enums']["match_format"],"id"?: string,"latest_start": string,"match_id"?: string | null,"notes"?: string | null,"rules"?: string | null,"skill_level"?: Database["public"]['Enums']["skill_level"] | null,"status"?: Database["public"]['Enums']["opponent_request_status"],"team_id": string,"venue_id"?: string | null,"venue_note"?: string | null
                  }
                  Update: {
                    "area_ids"?: (string)[],"city_id"?: string,"cost_per_team"?: number | null,"created_at"?: string,"created_by"?: string | null,"currency"?: string,"earliest_start"?: string,"format"?: Database["public"]['Enums']["match_format"],"id"?: string,"latest_start"?: string,"match_id"?: string | null,"notes"?: string | null,"rules"?: string | null,"skill_level"?: Database["public"]['Enums']["skill_level"] | null,"status"?: Database["public"]['Enums']["opponent_request_status"],"team_id"?: string,"venue_id"?: string | null,"venue_note"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "opponent_requests_city_id_fkey"
      columns: ["city_id"]
isOneToOne: false
      referencedRelation: "cities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "opponent_requests_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "opponent_requests_currency_fkey"
      columns: ["currency"]
isOneToOne: false
      referencedRelation: "currencies"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "opponent_requests_match_id_fkey"
      columns: ["match_id"]
isOneToOne: false
      referencedRelation: "matches"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "opponent_requests_team_id_fkey"
      columns: ["team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "opponent_requests_venue_id_fkey"
      columns: ["venue_id"]
isOneToOne: false
      referencedRelation: "venues"
      referencedColumns: ["id"]
    }
                  ]
                },"platform_settings": {
                  Row: {
                    "description": string | null,"is_public": boolean,"key": string,"updated_at": string,"updated_by": string | null,"value": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "description"?: string | null,"is_public"?: boolean,"key": string,"updated_at"?: string,"updated_by"?: string | null,"value": NonNullable<Json>
                  }
                  Update: {
                    "description"?: string | null,"is_public"?: boolean,"key"?: string,"updated_at"?: string,"updated_by"?: string | null,"value"?: NonNullable<Json>
                  }
                  Relationships: [
                    
                  ]
                },"profiles": {
                  Row: {
                    "area_id": string | null,"avatar_path": string | null,"bio": string | null,"city_id": string | null,"created_at": string,"display_name": string,"id": string,"onboarded_at": string | null,"positions": (Database["public"]['Enums']["player_position"])[],"preferred_formats": (Database["public"]['Enums']["match_format"])[],"show_match_history": boolean,"skill_level": Database["public"]['Enums']["skill_level"] | null,"status": Database["public"]['Enums']["account_status"],"suspended_at": string | null,"suspension_reason": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "area_id"?: string | null,"avatar_path"?: string | null,"bio"?: string | null,"city_id"?: string | null,"created_at"?: string,"display_name": string,"id": string,"onboarded_at"?: string | null,"positions"?: (Database["public"]['Enums']["player_position"])[],"preferred_formats"?: (Database["public"]['Enums']["match_format"])[],"show_match_history"?: boolean,"skill_level"?: Database["public"]['Enums']["skill_level"] | null,"status"?: Database["public"]['Enums']["account_status"],"suspended_at"?: string | null,"suspension_reason"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "area_id"?: string | null,"avatar_path"?: string | null,"bio"?: string | null,"city_id"?: string | null,"created_at"?: string,"display_name"?: string,"id"?: string,"onboarded_at"?: string | null,"positions"?: (Database["public"]['Enums']["player_position"])[],"preferred_formats"?: (Database["public"]['Enums']["match_format"])[],"show_match_history"?: boolean,"skill_level"?: Database["public"]['Enums']["skill_level"] | null,"status"?: Database["public"]['Enums']["account_status"],"suspended_at"?: string | null,"suspension_reason"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "profiles_area_id_fkey"
      columns: ["area_id"]
isOneToOne: false
      referencedRelation: "areas"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "profiles_city_id_fkey"
      columns: ["city_id"]
isOneToOne: false
      referencedRelation: "cities"
      referencedColumns: ["id"]
    }
                  ]
                },"reports": {
                  Row: {
                    "category": Database["public"]['Enums']["report_category"],"created_at": string,"details": string | null,"handled_at": string | null,"handled_by": string | null,"id": string,"reporter_id": string | null,"resolution_note": string | null,"snapshot": NonNullable<Json>,"status": Database["public"]['Enums']["report_status"],"target_id": string,"target_type": Database["public"]['Enums']["report_target"]
                  }
                  ComputedFields: never
                  Insert: {
                    "category": Database["public"]['Enums']["report_category"],"created_at"?: string,"details"?: string | null,"handled_at"?: string | null,"handled_by"?: string | null,"id"?: string,"reporter_id"?: string | null,"resolution_note"?: string | null,"snapshot"?: NonNullable<Json>,"status"?: Database["public"]['Enums']["report_status"],"target_id": string,"target_type": Database["public"]['Enums']["report_target"]
                  }
                  Update: {
                    "category"?: Database["public"]['Enums']["report_category"],"created_at"?: string,"details"?: string | null,"handled_at"?: string | null,"handled_by"?: string | null,"id"?: string,"reporter_id"?: string | null,"resolution_note"?: string | null,"snapshot"?: NonNullable<Json>,"status"?: Database["public"]['Enums']["report_status"],"target_id"?: string,"target_type"?: Database["public"]['Enums']["report_target"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "reports_handled_by_fkey"
      columns: ["handled_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reports_reporter_id_fkey"
      columns: ["reporter_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"reviews": {
                  Row: {
                    "booking_id": string | null,"comment": string | null,"created_at": string,"hidden_reason": string | null,"id": string,"match_id": string | null,"organization": number | null,"punctuality": number | null,"reliability": number | null,"reviewer_id": string,"sportsmanship": number | null,"status": Database["public"]['Enums']["review_status"],"subject_user_id": string | null,"venue_id": string | null,"venue_rating": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "booking_id"?: string | null,"comment"?: string | null,"created_at"?: string,"hidden_reason"?: string | null,"id"?: string,"match_id"?: string | null,"organization"?: number | null,"punctuality"?: number | null,"reliability"?: number | null,"reviewer_id": string,"sportsmanship"?: number | null,"status"?: Database["public"]['Enums']["review_status"],"subject_user_id"?: string | null,"venue_id"?: string | null,"venue_rating"?: number | null
                  }
                  Update: {
                    "booking_id"?: string | null,"comment"?: string | null,"created_at"?: string,"hidden_reason"?: string | null,"id"?: string,"match_id"?: string | null,"organization"?: number | null,"punctuality"?: number | null,"reliability"?: number | null,"reviewer_id"?: string,"sportsmanship"?: number | null,"status"?: Database["public"]['Enums']["review_status"],"subject_user_id"?: string | null,"venue_id"?: string | null,"venue_rating"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "reviews_booking_id_fkey"
      columns: ["booking_id"]
isOneToOne: false
      referencedRelation: "bookings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reviews_match_id_fkey"
      columns: ["match_id"]
isOneToOne: false
      referencedRelation: "matches"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reviews_reviewer_id_fkey"
      columns: ["reviewer_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reviews_subject_user_id_fkey"
      columns: ["subject_user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reviews_venue_id_fkey"
      columns: ["venue_id"]
isOneToOne: false
      referencedRelation: "venues"
      referencedColumns: ["id"]
    }
                  ]
                },"team_invitations": {
                  Row: {
                    "created_at": string,"id": string,"invited_by": string | null,"invitee_id": string,"message": string | null,"responded_at": string | null,"status": Database["public"]['Enums']["invitation_status"],"team_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"invited_by"?: string | null,"invitee_id": string,"message"?: string | null,"responded_at"?: string | null,"status"?: Database["public"]['Enums']["invitation_status"],"team_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"invited_by"?: string | null,"invitee_id"?: string,"message"?: string | null,"responded_at"?: string | null,"status"?: Database["public"]['Enums']["invitation_status"],"team_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "team_invitations_invited_by_fkey"
      columns: ["invited_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "team_invitations_invitee_id_fkey"
      columns: ["invitee_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "team_invitations_team_id_fkey"
      columns: ["team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    }
                  ]
                },"team_join_requests": {
                  Row: {
                    "created_at": string,"decided_at": string | null,"decided_by": string | null,"id": string,"message": string | null,"position": Database["public"]['Enums']["player_position"] | null,"recruitment_id": string | null,"status": Database["public"]['Enums']["request_status"],"team_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"id"?: string,"message"?: string | null,"position"?: Database["public"]['Enums']["player_position"] | null,"recruitment_id"?: string | null,"status"?: Database["public"]['Enums']["request_status"],"team_id": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"id"?: string,"message"?: string | null,"position"?: Database["public"]['Enums']["player_position"] | null,"recruitment_id"?: string | null,"status"?: Database["public"]['Enums']["request_status"],"team_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "team_join_requests_decided_by_fkey"
      columns: ["decided_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "team_join_requests_recruitment_id_fkey"
      columns: ["recruitment_id"]
isOneToOne: false
      referencedRelation: "team_recruitment"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "team_join_requests_team_id_fkey"
      columns: ["team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "team_join_requests_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"team_members": {
                  Row: {
                    "joined_at": string,"position": Database["public"]['Enums']["player_position"] | null,"role": Database["public"]['Enums']["team_role"],"team_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "joined_at"?: string,"position"?: Database["public"]['Enums']["player_position"] | null,"role"?: Database["public"]['Enums']["team_role"],"team_id": string,"user_id": string
                  }
                  Update: {
                    "joined_at"?: string,"position"?: Database["public"]['Enums']["player_position"] | null,"role"?: Database["public"]['Enums']["team_role"],"team_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "team_members_team_id_fkey"
      columns: ["team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "team_members_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"team_recruitment": {
                  Row: {
                    "closed_at": string | null,"created_at": string,"created_by": string | null,"description": string | null,"expires_at": string,"id": string,"players_needed": number,"positions": (Database["public"]['Enums']["player_position"])[],"skill_level": Database["public"]['Enums']["skill_level"] | null,"status": Database["public"]['Enums']["listing_status"],"team_id": string,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "closed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"expires_at": string,"id"?: string,"players_needed"?: number,"positions"?: (Database["public"]['Enums']["player_position"])[],"skill_level"?: Database["public"]['Enums']["skill_level"] | null,"status"?: Database["public"]['Enums']["listing_status"],"team_id": string,"title": string
                  }
                  Update: {
                    "closed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"expires_at"?: string,"id"?: string,"players_needed"?: number,"positions"?: (Database["public"]['Enums']["player_position"])[],"skill_level"?: Database["public"]['Enums']["skill_level"] | null,"status"?: Database["public"]['Enums']["listing_status"],"team_id"?: string,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "team_recruitment_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "team_recruitment_team_id_fkey"
      columns: ["team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    }
                  ]
                },"teams": {
                  Row: {
                    "area_id": string | null,"city_id": string,"created_at": string,"created_by": string | null,"description": string | null,"hidden_reason": string | null,"home_venue_id": string | null,"id": string,"is_archived": boolean,"is_hidden": boolean,"join_policy": Database["public"]['Enums']["team_join_policy"],"logo_path": string | null,"name": string,"preferred_format": Database["public"]['Enums']["match_format"] | null,"preferred_formation": string | null,"skill_level": Database["public"]['Enums']["skill_level"] | null,"updated_at": string,"visibility": Database["public"]['Enums']["visibility_level"]
                  }
                  ComputedFields: never
                  Insert: {
                    "area_id"?: string | null,"city_id": string,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"hidden_reason"?: string | null,"home_venue_id"?: string | null,"id"?: string,"is_archived"?: boolean,"is_hidden"?: boolean,"join_policy"?: Database["public"]['Enums']["team_join_policy"],"logo_path"?: string | null,"name": string,"preferred_format"?: Database["public"]['Enums']["match_format"] | null,"preferred_formation"?: string | null,"skill_level"?: Database["public"]['Enums']["skill_level"] | null,"updated_at"?: string,"visibility"?: Database["public"]['Enums']["visibility_level"]
                  }
                  Update: {
                    "area_id"?: string | null,"city_id"?: string,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"hidden_reason"?: string | null,"home_venue_id"?: string | null,"id"?: string,"is_archived"?: boolean,"is_hidden"?: boolean,"join_policy"?: Database["public"]['Enums']["team_join_policy"],"logo_path"?: string | null,"name"?: string,"preferred_format"?: Database["public"]['Enums']["match_format"] | null,"preferred_formation"?: string | null,"skill_level"?: Database["public"]['Enums']["skill_level"] | null,"updated_at"?: string,"visibility"?: Database["public"]['Enums']["visibility_level"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "teams_area_id_fkey"
      columns: ["area_id"]
isOneToOne: false
      referencedRelation: "areas"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "teams_city_id_fkey"
      columns: ["city_id"]
isOneToOne: false
      referencedRelation: "cities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "teams_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "teams_home_venue_fk"
      columns: ["home_venue_id"]
isOneToOne: false
      referencedRelation: "venues"
      referencedColumns: ["id"]
    }
                  ]
                },"tournament_announcements": {
                  Row: {
                    "author_id": string | null,"body": string,"created_at": string,"id": string,"title": string,"tournament_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "author_id"?: string | null,"body": string,"created_at"?: string,"id"?: string,"title": string,"tournament_id": string
                  }
                  Update: {
                    "author_id"?: string | null,"body"?: string,"created_at"?: string,"id"?: string,"title"?: string,"tournament_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "tournament_announcements_author_id_fkey"
      columns: ["author_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tournament_announcements_tournament_id_fkey"
      columns: ["tournament_id"]
isOneToOne: false
      referencedRelation: "tournaments"
      referencedColumns: ["id"]
    }
                  ]
                },"tournament_matches": {
                  Row: {
                    "away_penalties": number | null,"away_score": number | null,"away_team_id": string | null,"confirmed_at": string | null,"confirmed_by": string | null,"dispute_reason": string | null,"group_label": string | null,"home_penalties": number | null,"home_score": number | null,"home_team_id": string | null,"id": string,"is_bye": boolean,"location_note": string | null,"match_number": number,"next_match_id": string | null,"next_slot": Database["public"]['Enums']["team_side"] | null,"result_status": Database["public"]['Enums']["result_status"],"round": number,"scheduled_at": string | null,"stage": Database["public"]['Enums']["fixture_stage"],"status": Database["public"]['Enums']["fixture_status"],"submitted_at": string | null,"submitted_by": string | null,"tournament_id": string,"winner_team_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "away_penalties"?: number | null,"away_score"?: number | null,"away_team_id"?: string | null,"confirmed_at"?: string | null,"confirmed_by"?: string | null,"dispute_reason"?: string | null,"group_label"?: string | null,"home_penalties"?: number | null,"home_score"?: number | null,"home_team_id"?: string | null,"id"?: string,"is_bye"?: boolean,"location_note"?: string | null,"match_number": number,"next_match_id"?: string | null,"next_slot"?: Database["public"]['Enums']["team_side"] | null,"result_status"?: Database["public"]['Enums']["result_status"],"round": number,"scheduled_at"?: string | null,"stage": Database["public"]['Enums']["fixture_stage"],"status"?: Database["public"]['Enums']["fixture_status"],"submitted_at"?: string | null,"submitted_by"?: string | null,"tournament_id": string,"winner_team_id"?: string | null
                  }
                  Update: {
                    "away_penalties"?: number | null,"away_score"?: number | null,"away_team_id"?: string | null,"confirmed_at"?: string | null,"confirmed_by"?: string | null,"dispute_reason"?: string | null,"group_label"?: string | null,"home_penalties"?: number | null,"home_score"?: number | null,"home_team_id"?: string | null,"id"?: string,"is_bye"?: boolean,"location_note"?: string | null,"match_number"?: number,"next_match_id"?: string | null,"next_slot"?: Database["public"]['Enums']["team_side"] | null,"result_status"?: Database["public"]['Enums']["result_status"],"round"?: number,"scheduled_at"?: string | null,"stage"?: Database["public"]['Enums']["fixture_stage"],"status"?: Database["public"]['Enums']["fixture_status"],"submitted_at"?: string | null,"submitted_by"?: string | null,"tournament_id"?: string,"winner_team_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "tournament_matches_away_team_id_fkey"
      columns: ["away_team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tournament_matches_confirmed_by_fkey"
      columns: ["confirmed_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tournament_matches_home_team_id_fkey"
      columns: ["home_team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tournament_matches_next_match_id_fkey"
      columns: ["next_match_id"]
isOneToOne: false
      referencedRelation: "tournament_matches"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tournament_matches_submitted_by_fkey"
      columns: ["submitted_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tournament_matches_tournament_id_fkey"
      columns: ["tournament_id"]
isOneToOne: false
      referencedRelation: "tournaments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tournament_matches_winner_team_id_fkey"
      columns: ["winner_team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    }
                  ]
                },"tournament_teams": {
                  Row: {
                    "created_at": string,"decided_at": string | null,"group_label": string | null,"id": string,"registered_by": string | null,"seed": number | null,"status": Database["public"]['Enums']["tournament_team_status"],"team_id": string,"tournament_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"decided_at"?: string | null,"group_label"?: string | null,"id"?: string,"registered_by"?: string | null,"seed"?: number | null,"status"?: Database["public"]['Enums']["tournament_team_status"],"team_id": string,"tournament_id": string
                  }
                  Update: {
                    "created_at"?: string,"decided_at"?: string | null,"group_label"?: string | null,"id"?: string,"registered_by"?: string | null,"seed"?: number | null,"status"?: Database["public"]['Enums']["tournament_team_status"],"team_id"?: string,"tournament_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "tournament_teams_registered_by_fkey"
      columns: ["registered_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tournament_teams_team_id_fkey"
      columns: ["team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tournament_teams_tournament_id_fkey"
      columns: ["tournament_id"]
isOneToOne: false
      referencedRelation: "tournaments"
      referencedColumns: ["id"]
    }
                  ]
                },"tournaments": {
                  Row: {
                    "advance_per_group": number,"city_id": string,"created_at": string,"currency": string,"description": string | null,"eligibility": string | null,"ends_on": string,"entry_fee": number | null,"format": Database["public"]['Enums']["match_format"],"group_count": number,"hidden_reason": string | null,"id": string,"is_hidden": boolean,"min_team_size": number,"name": string,"organizer_id": string,"points_draw": number,"points_loss": number,"points_win": number,"prizes": string | null,"registration_deadline": string,"rules": string | null,"starts_on": string,"status": Database["public"]['Enums']["tournament_status"],"team_capacity": number,"tournament_format": Database["public"]['Enums']["tournament_format"],"updated_at": string,"venue_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "advance_per_group"?: number,"city_id": string,"created_at"?: string,"currency": string,"description"?: string | null,"eligibility"?: string | null,"ends_on": string,"entry_fee"?: number | null,"format": Database["public"]['Enums']["match_format"],"group_count"?: number,"hidden_reason"?: string | null,"id"?: string,"is_hidden"?: boolean,"min_team_size"?: number,"name": string,"organizer_id": string,"points_draw"?: number,"points_loss"?: number,"points_win"?: number,"prizes"?: string | null,"registration_deadline": string,"rules"?: string | null,"starts_on": string,"status"?: Database["public"]['Enums']["tournament_status"],"team_capacity": number,"tournament_format": Database["public"]['Enums']["tournament_format"],"updated_at"?: string,"venue_id"?: string | null
                  }
                  Update: {
                    "advance_per_group"?: number,"city_id"?: string,"created_at"?: string,"currency"?: string,"description"?: string | null,"eligibility"?: string | null,"ends_on"?: string,"entry_fee"?: number | null,"format"?: Database["public"]['Enums']["match_format"],"group_count"?: number,"hidden_reason"?: string | null,"id"?: string,"is_hidden"?: boolean,"min_team_size"?: number,"name"?: string,"organizer_id"?: string,"points_draw"?: number,"points_loss"?: number,"points_win"?: number,"prizes"?: string | null,"registration_deadline"?: string,"rules"?: string | null,"starts_on"?: string,"status"?: Database["public"]['Enums']["tournament_status"],"team_capacity"?: number,"tournament_format"?: Database["public"]['Enums']["tournament_format"],"updated_at"?: string,"venue_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "tournaments_city_id_fkey"
      columns: ["city_id"]
isOneToOne: false
      referencedRelation: "cities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tournaments_currency_fkey"
      columns: ["currency"]
isOneToOne: false
      referencedRelation: "currencies"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "tournaments_organizer_id_fkey"
      columns: ["organizer_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tournaments_venue_id_fkey"
      columns: ["venue_id"]
isOneToOne: false
      referencedRelation: "venues"
      referencedColumns: ["id"]
    }
                  ]
                },"user_blocks": {
                  Row: {
                    "blocked_id": string,"blocker_id": string,"created_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "blocked_id": string,"blocker_id": string,"created_at"?: string
                  }
                  Update: {
                    "blocked_id"?: string,"blocker_id"?: string,"created_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "user_blocks_blocked_id_fkey"
      columns: ["blocked_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "user_blocks_blocker_id_fkey"
      columns: ["blocker_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"user_preferences": {
                  Row: {
                    "locale": string,"notification_prefs": NonNullable<Json>,"preferred_times": (string)[],"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "locale"?: string,"notification_prefs"?: NonNullable<Json>,"preferred_times"?: (string)[],"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "locale"?: string,"notification_prefs"?: NonNullable<Json>,"preferred_times"?: (string)[],"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "user_preferences_user_id_fkey"
      columns: ["user_id"]
isOneToOne: true
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"user_roles": {
                  Row: {
                    "granted_at": string,"granted_by": string | null,"role": Database["public"]['Enums']["app_role"],"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "granted_at"?: string,"granted_by"?: string | null,"role": Database["public"]['Enums']["app_role"],"user_id": string
                  }
                  Update: {
                    "granted_at"?: string,"granted_by"?: string | null,"role"?: Database["public"]['Enums']["app_role"],"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "user_roles_granted_by_fkey"
      columns: ["granted_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "user_roles_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"venue_fields": {
                  Row: {
                    "created_at": string,"formats": (Database["public"]['Enums']["match_format"])[],"has_lights": boolean,"id": string,"is_active": boolean,"is_covered": boolean,"name": string,"price_per_hour": number,"surface": Database["public"]['Enums']["field_surface"],"venue_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"formats"?: (Database["public"]['Enums']["match_format"])[],"has_lights"?: boolean,"id"?: string,"is_active"?: boolean,"is_covered"?: boolean,"name": string,"price_per_hour": number,"surface"?: Database["public"]['Enums']["field_surface"],"venue_id": string
                  }
                  Update: {
                    "created_at"?: string,"formats"?: (Database["public"]['Enums']["match_format"])[],"has_lights"?: boolean,"id"?: string,"is_active"?: boolean,"is_covered"?: boolean,"name"?: string,"price_per_hour"?: number,"surface"?: Database["public"]['Enums']["field_surface"],"venue_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "venue_fields_venue_id_fkey"
      columns: ["venue_id"]
isOneToOne: false
      referencedRelation: "venues"
      referencedColumns: ["id"]
    }
                  ]
                },"venue_images": {
                  Row: {
                    "created_at": string,"id": string,"path": string,"sort_order": number,"venue_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"path": string,"sort_order"?: number,"venue_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"path"?: string,"sort_order"?: number,"venue_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "venue_images_venue_id_fkey"
      columns: ["venue_id"]
isOneToOne: false
      referencedRelation: "venues"
      referencedColumns: ["id"]
    }
                  ]
                },"venue_opening_hours": {
                  Row: {
                    "closes": string,"opens": string,"venue_id": string,"weekday": number
                  }
                  ComputedFields: never
                  Insert: {
                    "closes": string,"opens": string,"venue_id": string,"weekday": number
                  }
                  Update: {
                    "closes"?: string,"opens"?: string,"venue_id"?: string,"weekday"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "venue_opening_hours_venue_id_fkey"
      columns: ["venue_id"]
isOneToOne: false
      referencedRelation: "venues"
      referencedColumns: ["id"]
    }
                  ]
                },"venue_pricing_rules": {
                  Row: {
                    "end_time": string,"field_id": string,"id": string,"price_per_hour": number,"start_time": string,"weekdays": (number)[]
                  }
                  ComputedFields: never
                  Insert: {
                    "end_time": string,"field_id": string,"id"?: string,"price_per_hour": number,"start_time": string,"weekdays": (number)[]
                  }
                  Update: {
                    "end_time"?: string,"field_id"?: string,"id"?: string,"price_per_hour"?: number,"start_time"?: string,"weekdays"?: (number)[]
                  }
                  Relationships: [
                    {
      foreignKeyName: "venue_pricing_rules_field_id_fkey"
      columns: ["field_id"]
isOneToOne: false
      referencedRelation: "venue_fields"
      referencedColumns: ["id"]
    }
                  ]
                },"venue_staff": {
                  Row: {
                    "added_by": string | null,"created_at": string,"role": Database["public"]['Enums']["venue_role"],"user_id": string,"venue_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "added_by"?: string | null,"created_at"?: string,"role": Database["public"]['Enums']["venue_role"],"user_id": string,"venue_id": string
                  }
                  Update: {
                    "added_by"?: string | null,"created_at"?: string,"role"?: Database["public"]['Enums']["venue_role"],"user_id"?: string,"venue_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "venue_staff_added_by_fkey"
      columns: ["added_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "venue_staff_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "venue_staff_venue_id_fkey"
      columns: ["venue_id"]
isOneToOne: false
      referencedRelation: "venues"
      referencedColumns: ["id"]
    }
                  ]
                },"venues": {
                  Row: {
                    "address": string | null,"area_id": string | null,"auto_confirm_bookings": boolean,"booking_mode": Database["public"]['Enums']["booking_mode"],"buffer_minutes": number,"cancellation_deadline_hours": number,"cancellation_policy": string | null,"city_id": string,"cover_image_path": string | null,"created_at": string,"created_by": string | null,"description": string | null,"facilities": (string)[],"hidden_reason": string | null,"id": string,"is_hidden": boolean,"latitude": number | null,"longitude": number | null,"max_advance_days": number,"min_notice_minutes": number,"name": string,"phone": string | null,"updated_at": string,"verification_note": string | null,"verification_status": Database["public"]['Enums']["verification_status"],"whatsapp": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "address"?: string | null,"area_id"?: string | null,"auto_confirm_bookings"?: boolean,"booking_mode"?: Database["public"]['Enums']["booking_mode"],"buffer_minutes"?: number,"cancellation_deadline_hours"?: number,"cancellation_policy"?: string | null,"city_id": string,"cover_image_path"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"facilities"?: (string)[],"hidden_reason"?: string | null,"id"?: string,"is_hidden"?: boolean,"latitude"?: number | null,"longitude"?: number | null,"max_advance_days"?: number,"min_notice_minutes"?: number,"name": string,"phone"?: string | null,"updated_at"?: string,"verification_note"?: string | null,"verification_status"?: Database["public"]['Enums']["verification_status"],"whatsapp"?: string | null
                  }
                  Update: {
                    "address"?: string | null,"area_id"?: string | null,"auto_confirm_bookings"?: boolean,"booking_mode"?: Database["public"]['Enums']["booking_mode"],"buffer_minutes"?: number,"cancellation_deadline_hours"?: number,"cancellation_policy"?: string | null,"city_id"?: string,"cover_image_path"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"facilities"?: (string)[],"hidden_reason"?: string | null,"id"?: string,"is_hidden"?: boolean,"latitude"?: number | null,"longitude"?: number | null,"max_advance_days"?: number,"min_notice_minutes"?: number,"name"?: string,"phone"?: string | null,"updated_at"?: string,"verification_note"?: string | null,"verification_status"?: Database["public"]['Enums']["verification_status"],"whatsapp"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "venues_area_id_fkey"
      columns: ["area_id"]
isOneToOne: false
      referencedRelation: "areas"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "venues_city_id_fkey"
      columns: ["city_id"]
isOneToOne: false
      referencedRelation: "cities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "venues_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"whatsapp_verifications": {
                  Row: {
                    "code": string,"consumed_at": string | null,"created_at": string,"expires_at": string,"id": string,"phone": string | null,"purpose": Database["public"]['Enums']["wa_purpose"],"status": Database["public"]['Enums']["wa_status"],"ticket_hash": string,"user_id": string | null,"verified_at": string | null,"wa_message_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "code": string,"consumed_at"?: string | null,"created_at"?: string,"expires_at"?: string,"id"?: string,"phone"?: string | null,"purpose": Database["public"]['Enums']["wa_purpose"],"status"?: Database["public"]['Enums']["wa_status"],"ticket_hash": string,"user_id"?: string | null,"verified_at"?: string | null,"wa_message_id"?: string | null
                  }
                  Update: {
                    "code"?: string,"consumed_at"?: string | null,"created_at"?: string,"expires_at"?: string,"id"?: string,"phone"?: string | null,"purpose"?: Database["public"]['Enums']["wa_purpose"],"status"?: Database["public"]['Enums']["wa_status"],"ticket_hash"?: string,"user_id"?: string | null,"verified_at"?: string | null,"wa_message_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "add_venue_image":
{ Args: { "p_path": string,"p_venue_id": string }; Returns: string
                           },
"add_venue_staff":
{ Args: { "p_role": Database["public"]['Enums']["venue_role"],"p_user_id": string,"p_venue_id": string }; Returns: undefined
                           },
"admin_list_users":
{ Args: { "p_limit"?: number,"p_offset"?: number,"p_search"?: string }; Returns: {
              "city_id": string,"created_at": string,"display_name": string,"email": string,"id": string,"last_sign_in_at": string,"roles": (Database["public"]['Enums']["app_role"])[],"status": Database["public"]['Enums']["account_status"]
            }[]
                           },
"admin_remove_message":
{ Args: { "p_message_id": number,"p_reason": string }; Returns: undefined
                           },
"admin_set_hidden":
{ Args: { "p_entity_id": string,"p_entity_type": string,"p_hidden": boolean,"p_reason"?: string }; Returns: undefined
                           },
"admin_set_role":
{ Args: { "p_grant": boolean,"p_role": Database["public"]['Enums']["app_role"],"p_user_id": string }; Returns: undefined
                           },
"admin_set_user_status":
{ Args: { "p_reason"?: string,"p_status": Database["public"]['Enums']["account_status"],"p_user_id": string }; Returns: undefined
                           },
"admin_set_venue_verification":
{ Args: { "p_note"?: string,"p_status": Database["public"]['Enums']["verification_status"],"p_venue_id": string }; Returns: undefined
                           },
"admin_stats":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"admin_update_report":
{ Args: { "p_note"?: string,"p_report_id": string,"p_status": Database["public"]['Enums']["report_status"] }; Returns: undefined
                           },
"admin_update_setting":
{ Args: { "p_key": string,"p_value": Json }; Returns: undefined
                           },
"admin_upsert_area":
{ Args: { "p_city_id": string,"p_id": string,"p_is_active"?: boolean,"p_latitude"?: number,"p_longitude"?: number,"p_name_ar": string,"p_name_en": string,"p_slug": string }; Returns: string
                           },
"admin_upsert_city":
{ Args: { "p_country_code": string,"p_currency": string,"p_id": string,"p_is_active"?: boolean,"p_latitude"?: number,"p_longitude"?: number,"p_name_ar": string,"p_name_en": string,"p_slug": string,"p_timezone": string }; Returns: string
                           },
"archive_team":
{ Args: { "p_team_id": string }; Returns: undefined
                           },
"block_user":
{ Args: { "p_user_id": string }; Returns: undefined
                           },
"cancel_booking":
{ Args: { "p_booking_id": string,"p_reason"?: string }; Returns: undefined
                           },
"cancel_match":
{ Args: { "p_match_id": string,"p_reason"?: string }; Returns: undefined
                           },
"close_opponent_request":
{ Args: { "p_request_id": string }; Returns: undefined
                           },
"close_recruitment":
{ Args: { "p_recruitment_id": string }; Returns: undefined
                           },
"complete_match":
{ Args: { "p_match_id": string }; Returns: undefined
                           },
"confirm_match":
{ Args: { "p_match_id": string }; Returns: undefined
                           },
"confirm_tournament_result":
{ Args: { "p_match_id": string }; Returns: undefined
                           },
"create_manual_booking":
{ Args: { "p_customer_name"?: string,"p_duration_minutes": number,"p_field_id": string,"p_kind": Database["public"]['Enums']["booking_kind"],"p_note"?: string,"p_price_total"?: number,"p_start_local": string }; Returns: string
                           },
"create_match":
{ Args: { "p_area_id"?: string,"p_city_id": string,"p_cost_is_estimate"?: boolean,"p_description"?: string,"p_duration_minutes": number,"p_external_booking"?: boolean,"p_field_id"?: string,"p_format": Database["public"]['Enums']["match_format"],"p_join_policy"?: Database["public"]['Enums']["match_join_policy"],"p_leave_deadline_hours"?: number,"p_location_note"?: string,"p_match_type"?: Database["public"]['Enums']["match_type"],"p_organizer_plays"?: boolean,"p_organizer_position"?: Database["public"]['Enums']["player_position"],"p_paying_players"?: number,"p_payment_collector"?: Database["public"]['Enums']["payment_collector"],"p_payment_notes"?: string,"p_positions_needed"?: Json,"p_price_per_player"?: number,"p_publish"?: boolean,"p_repeat_weeks"?: number,"p_reserved_spots"?: number,"p_rules"?: string,"p_skill_level"?: Database["public"]['Enums']["skill_level"],"p_start_local": string,"p_team_id"?: string,"p_title": string,"p_total_cost"?: number,"p_total_players": number,"p_venue_id"?: string,"p_visibility"?: Database["public"]['Enums']["visibility_level"] }; Returns: string
                           },
"create_opponent_request":
{ Args: { "p_area_ids"?: (string)[],"p_cost_per_team"?: number,"p_earliest_local": string,"p_format": Database["public"]['Enums']["match_format"],"p_latest_local": string,"p_notes"?: string,"p_rules"?: string,"p_skill_level"?: Database["public"]['Enums']["skill_level"],"p_team_id": string,"p_venue_id"?: string,"p_venue_note"?: string }; Returns: string
                           },
"create_recruitment":
{ Args: { "p_description"?: string,"p_expires_in_days"?: number,"p_players_needed"?: number,"p_positions"?: (Database["public"]['Enums']["player_position"])[],"p_skill_level"?: Database["public"]['Enums']["skill_level"],"p_team_id": string,"p_title": string }; Returns: string
                           },
"create_report":
{ Args: { "p_category": Database["public"]['Enums']["report_category"],"p_details"?: string,"p_target_id": string,"p_target_type": Database["public"]['Enums']["report_target"] }; Returns: string
                           },
"create_team":
{ Args: { "p_area_id"?: string,"p_city_id": string,"p_description"?: string,"p_join_policy"?: Database["public"]['Enums']["team_join_policy"],"p_name": string,"p_preferred_format"?: Database["public"]['Enums']["match_format"],"p_preferred_formation"?: string,"p_skill_level"?: Database["public"]['Enums']["skill_level"],"p_visibility"?: Database["public"]['Enums']["visibility_level"] }; Returns: string
                           },
"create_venue":
{ Args: { "p_address"?: string,"p_area_id"?: string,"p_city_id": string,"p_description"?: string,"p_facilities"?: (string)[],"p_latitude"?: number,"p_longitude"?: number,"p_name": string,"p_phone"?: string,"p_whatsapp"?: string }; Returns: string
                           },
"decide_booking":
{ Args: { "p_approve": boolean,"p_booking_id": string,"p_note"?: string }; Returns: undefined
                           },
"decide_join_request":
{ Args: { "p_approve": boolean,"p_request_id": string }; Returns: undefined
                           },
"decide_match_participant":
{ Args: { "p_approve": boolean,"p_participant_id": string }; Returns: Json
                           },
"decide_tournament_registration":
{ Args: { "p_approve": boolean,"p_registration_id": string }; Returns: Database["public"]['Enums']["tournament_team_status"]
                           },
"delete_message":
{ Args: { "p_message_id": number }; Returns: undefined
                           },
"dispute_tournament_result":
{ Args: { "p_match_id": string,"p_reason": string }; Returns: undefined
                           },
"entity_conversation_id":
{ Args: { "p_entity_id": string,"p_kind": Database["public"]['Enums']["conversation_kind"] }; Returns: string
                           },
"field_busy_intervals":
{ Args: { "p_field_id": string,"p_local_date": string }; Returns: {
              "ends_at": string,"starts_at": string
            }[]
                           },
"invite_to_match":
{ Args: { "p_match_id": string,"p_user_id": string }; Returns: string
                           },
"invite_to_team":
{ Args: { "p_message"?: string,"p_team_id": string,"p_user_id": string }; Returns: string
                           },
"join_match":
{ Args: { "p_match_id": string,"p_position"?: Database["public"]['Enums']["player_position"],"p_waitlist_if_full"?: boolean }; Returns: Json
                           },
"leave_match":
{ Args: { "p_match_id": string }; Returns: Json
                           },
"leave_team":
{ Args: { "p_team_id": string }; Returns: undefined
                           },
"link_match_booking":
{ Args: { "p_booking_id": string,"p_match_id": string }; Returns: undefined
                           },
"mark_booking_outcome":
{ Args: { "p_booking_id": string,"p_status": Database["public"]['Enums']["booking_status"] }; Returns: undefined
                           },
"mark_conversation_read":
{ Args: { "p_conversation_id": string }; Returns: undefined
                           },
"mark_notifications_read":
{ Args: { "p_ids"?: (string)[] }; Returns: number
                           },
"match_transition_allowed":
{ Args: { "p_from": Database["public"]['Enums']["match_status"],"p_to": Database["public"]['Enums']["match_status"] }; Returns: boolean
                           },
"my_conversations":
{ Args: { "p_limit"?: number }; Returns: {
              "conversation_id": string,"is_locked": boolean,"kind": Database["public"]['Enums']["conversation_kind"],"last_message": string,"last_message_at": string,"ref_id": string,"title": string,"unread_count": number
            }[]
                           },
"my_phone":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"player_reputation":
{ Args: { "p_user_id": string }; Returns: Json
                           },
"player_stats":
{ Args: { "p_user_id": string }; Returns: Json
                           },
"post_tournament_announcement":
{ Args: { "p_body": string,"p_title": string,"p_tournament_id": string }; Returns: string
                           },
"publish_match":
{ Args: { "p_match_id": string }; Returns: undefined
                           },
"quote_booking":
{ Args: { "p_duration_minutes": number,"p_field_id": string,"p_start_local": string }; Returns: Json
                           },
"record_tournament_result":
{ Args: { "p_away_penalties"?: number,"p_away_score": number,"p_home_penalties"?: number,"p_home_score": number,"p_match_id": string }; Returns: Database["public"]['Enums']["result_status"]
                           },
"register_tournament_team":
{ Args: { "p_team_id": string,"p_tournament_id": string }; Returns: string
                           },
"remove_match_participant":
{ Args: { "p_participant_id": string,"p_reason"?: string }; Returns: undefined
                           },
"remove_team_member":
{ Args: { "p_team_id": string,"p_user_id": string }; Returns: undefined
                           },
"remove_venue_image":
{ Args: { "p_image_id": string }; Returns: string
                           },
"remove_venue_staff":
{ Args: { "p_user_id": string,"p_venue_id": string }; Returns: undefined
                           },
"report_match_result":
{ Args: { "p_away_score": number,"p_home_score": number,"p_match_id": string }; Returns: Database["public"]['Enums']["match_result_status"]
                           },
"request_booking":
{ Args: { "p_duration_minutes": number,"p_field_id": string,"p_match_id"?: string,"p_note"?: string,"p_start_local": string }; Returns: Json
                           },
"request_to_join_team":
{ Args: { "p_message"?: string,"p_position"?: Database["public"]['Enums']["player_position"],"p_recruitment_id"?: string,"p_team_id": string }; Returns: string
                           },
"request_venue_verification":
{ Args: { "p_venue_id": string }; Returns: undefined
                           },
"respond_challenge":
{ Args: { "p_accept": boolean,"p_challenge_id": string }; Returns: string
                           },
"respond_match_invitation":
{ Args: { "p_accept": boolean,"p_invitation_id": string,"p_position"?: Database["public"]['Enums']["player_position"] }; Returns: Json
                           },
"respond_match_result":
{ Args: { "p_confirm": boolean,"p_match_id": string,"p_reason"?: string }; Returns: undefined
                           },
"respond_team_invitation":
{ Args: { "p_accept": boolean,"p_invitation_id": string }; Returns: undefined
                           },
"revoke_match_invitation":
{ Args: { "p_invitation_id": string }; Returns: undefined
                           },
"revoke_team_invitation":
{ Args: { "p_invitation_id": string }; Returns: undefined
                           },
"run_scheduled_jobs":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"save_tournament_fixtures":
{ Args: { "p_fixtures": Json,"p_groups"?: Json,"p_tournament_id": string }; Returns: number
                           },
"search_matches":
{ Args: { "p_area_id"?: string,"p_booking_confirmed"?: boolean,"p_city_id"?: string,"p_date_from"?: string,"p_date_to"?: string,"p_format"?: Database["public"]['Enums']["match_format"],"p_include_full"?: boolean,"p_join_policy"?: Database["public"]['Enums']["match_join_policy"],"p_lat"?: number,"p_limit"?: number,"p_lng"?: number,"p_max_price"?: number,"p_min_open_slots"?: number,"p_offset"?: number,"p_position"?: Database["public"]['Enums']["player_position"],"p_query"?: string,"p_radius_km"?: number,"p_skill_level"?: Database["public"]['Enums']["skill_level"],"p_sort"?: string,"p_time_from"?: string,"p_time_to"?: string }; Returns: {
              "area_id": string | null,
"away_team_id": string | null,
"booking_id": string | null,
"booking_status": Database["public"]['Enums']["match_booking_status"],
"cancelled_at": string | null,
"cancelled_by": string | null,
"cancelled_reason": string | null,
"city_id": string,
"completed_at": string | null,
"confirmed_count": number,
"cost_is_estimate": boolean,
"created_at": string,
"currency": string,
"description": string | null,
"ends_at": string,
"field_id": string | null,
"format": Database["public"]['Enums']["match_format"],
"hidden_reason": string | null,
"home_team_id": string | null,
"id": string,
"is_hidden": boolean,
"join_policy": Database["public"]['Enums']["match_join_policy"],
"leave_deadline_hours": number,
"location_note": string | null,
"match_type": Database["public"]['Enums']["match_type"],
"organizer_id": string,
"paying_players": number | null,
"payment_collector": Database["public"]['Enums']["payment_collector"],
"payment_notes": string | null,
"pending_count": number,
"positions_needed": NonNullable<Json>,
"price_per_player": number,
"reserved_spots": number,
"rules": string | null,
"series_id": string | null,
"skill_level": Database["public"]['Enums']["skill_level"] | null,
"starts_at": string,
"status": Database["public"]['Enums']["match_status"],
"team_id": string | null,
"title": string,
"total_cost": number | null,
"total_players": number,
"updated_at": string,
"venue_id": string | null,
"visibility": Database["public"]['Enums']["visibility_level"],
"waitlist_count": number
            }[]
                          SetofOptions: {
        from: "*"
        to: "matches"
        isOneToOne: false
        isSetofReturn: true
      } },
"send_challenge":
{ Args: { "p_challenger_team_id": string,"p_cost_per_team"?: number,"p_duration_minutes": number,"p_format"?: Database["public"]['Enums']["match_format"],"p_location_note"?: string,"p_message"?: string,"p_request_id"?: string,"p_start_local": string,"p_target_team_id"?: string,"p_venue_id"?: string }; Returns: string
                           },
"send_message":
{ Args: { "p_body": string,"p_conversation_id": string }; Returns: number
                           },
"set_field_pricing_rules":
{ Args: { "p_field_id": string,"p_rules": Json }; Returns: undefined
                           },
"set_match_events":
{ Args: { "p_events": Json,"p_match_id": string }; Returns: number
                           },
"set_my_avatar":
{ Args: { "p_path": string }; Returns: undefined
                           },
"set_my_team_position":
{ Args: { "p_position": Database["public"]['Enums']["player_position"],"p_team_id": string }; Returns: undefined
                           },
"set_participant_details":
{ Args: { "p_attendance"?: Database["public"]['Enums']["attendance_status"],"p_participant_id": string,"p_payment_status"?: Database["public"]['Enums']["manual_payment_status"],"p_team_side"?: Database["public"]['Enums']["team_side"] }; Returns: undefined
                           },
"set_team_logo":
{ Args: { "p_path": string,"p_team_id": string }; Returns: undefined
                           },
"set_team_member_role":
{ Args: { "p_role": Database["public"]['Enums']["team_role"],"p_team_id": string,"p_user_id": string }; Returns: undefined
                           },
"set_tournament_fixture_schedule":
{ Args: { "p_location_note"?: string,"p_match_id": string,"p_scheduled_local": string }; Returns: undefined
                           },
"set_tournament_status":
{ Args: { "p_status": Database["public"]['Enums']["tournament_status"],"p_tournament_id": string }; Returns: undefined
                           },
"set_venue_cover":
{ Args: { "p_path": string,"p_venue_id": string }; Returns: undefined
                           },
"set_venue_opening_hours":
{ Args: { "p_hours": Json,"p_venue_id": string }; Returns: undefined
                           },
"start_direct_conversation":
{ Args: { "p_user_id": string }; Returns: string
                           },
"start_match":
{ Args: { "p_match_id": string }; Returns: undefined
                           },
"submit_player_review":
{ Args: { "p_comment"?: string,"p_match_id": string,"p_organization"?: number,"p_punctuality": number,"p_reliability": number,"p_sportsmanship": number,"p_subject_user_id": string }; Returns: string
                           },
"submit_venue_review":
{ Args: { "p_booking_id"?: string,"p_comment"?: string,"p_match_id"?: string,"p_rating": number,"p_venue_id": string }; Returns: string
                           },
"tournament_transition_allowed":
{ Args: { "p_from": Database["public"]['Enums']["tournament_status"],"p_to": Database["public"]['Enums']["tournament_status"] }; Returns: boolean
                           },
"unblock_user":
{ Args: { "p_user_id": string }; Returns: undefined
                           },
"unread_counts":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"update_match":
{ Args: { "p_area_id"?: string,"p_cost_is_estimate"?: boolean,"p_description"?: string,"p_duration_minutes": number,"p_external_booking"?: boolean,"p_field_id"?: string,"p_join_policy"?: Database["public"]['Enums']["match_join_policy"],"p_leave_deadline_hours"?: number,"p_location_note"?: string,"p_match_id": string,"p_paying_players"?: number,"p_payment_collector"?: Database["public"]['Enums']["payment_collector"],"p_payment_notes"?: string,"p_positions_needed"?: Json,"p_price_per_player"?: number,"p_reserved_spots"?: number,"p_rules"?: string,"p_skill_level"?: Database["public"]['Enums']["skill_level"],"p_start_local": string,"p_title": string,"p_total_cost"?: number,"p_total_players": number,"p_venue_id"?: string,"p_visibility"?: Database["public"]['Enums']["visibility_level"] }; Returns: undefined
                           },
"update_my_match_position":
{ Args: { "p_match_id": string,"p_position": Database["public"]['Enums']["player_position"] }; Returns: undefined
                           },
"update_my_preferences":
{ Args: { "p_locale"?: string,"p_notification_prefs"?: Json,"p_preferred_times"?: (string)[] }; Returns: undefined
                           },
"update_my_profile":
{ Args: { "p_area_id"?: string,"p_bio"?: string,"p_city_id": string,"p_complete_onboarding"?: boolean,"p_display_name": string,"p_positions"?: (Database["public"]['Enums']["player_position"])[],"p_preferred_formats"?: (Database["public"]['Enums']["match_format"])[],"p_show_match_history"?: boolean,"p_skill_level"?: Database["public"]['Enums']["skill_level"] }; Returns: undefined
                           },
"update_team":
{ Args: { "p_area_id"?: string,"p_city_id": string,"p_description"?: string,"p_home_venue_id"?: string,"p_join_policy"?: Database["public"]['Enums']["team_join_policy"],"p_name": string,"p_preferred_format"?: Database["public"]['Enums']["match_format"],"p_preferred_formation"?: string,"p_skill_level"?: Database["public"]['Enums']["skill_level"],"p_team_id": string,"p_visibility"?: Database["public"]['Enums']["visibility_level"] }; Returns: undefined
                           },
"update_venue":
{ Args: { "p_address"?: string,"p_area_id"?: string,"p_auto_confirm"?: boolean,"p_booking_mode"?: Database["public"]['Enums']["booking_mode"],"p_buffer_minutes"?: number,"p_cancellation_deadline_hours"?: number,"p_cancellation_policy"?: string,"p_city_id": string,"p_description"?: string,"p_facilities"?: (string)[],"p_latitude"?: number,"p_longitude"?: number,"p_max_advance_days"?: number,"p_min_notice_minutes"?: number,"p_name": string,"p_phone"?: string,"p_venue_id": string,"p_whatsapp"?: string }; Returns: undefined
                           },
"upsert_tournament":
{ Args: { "p_advance_per_group"?: number,"p_city_id": string,"p_description"?: string,"p_eligibility"?: string,"p_ends_on": string,"p_entry_fee"?: number,"p_format": Database["public"]['Enums']["match_format"],"p_group_count"?: number,"p_min_team_size"?: number,"p_name": string,"p_points_draw"?: number,"p_points_loss"?: number,"p_points_win"?: number,"p_prizes"?: string,"p_registration_deadline_local": string,"p_rules"?: string,"p_starts_on": string,"p_team_capacity": number,"p_tournament_format": Database["public"]['Enums']["tournament_format"],"p_tournament_id": string,"p_venue_id"?: string }; Returns: string
                           },
"upsert_venue_field":
{ Args: { "p_field_id": string,"p_formats": (Database["public"]['Enums']["match_format"])[],"p_has_lights": boolean,"p_is_active"?: boolean,"p_is_covered": boolean,"p_name": string,"p_price_per_hour": number,"p_surface": Database["public"]['Enums']["field_surface"],"p_venue_id": string }; Returns: string
                           },
"venue_rating":
{ Args: { "p_venue_id": string }; Returns: Json
                           },
"wa_auth_email_for_phone":
{ Args: { "p_phone": string }; Returns: string
                           },
"wa_cleanup":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"wa_consume_verification":
{ Args: { "p_ticket_hash": string }; Returns: {
              "email": string,"purpose": Database["public"]['Enums']["wa_purpose"],"user_id": string
            }[]
                           },
"wa_create_verification":
{ Args: { "p_client_key": string,"p_code": string,"p_purpose": Database["public"]['Enums']["wa_purpose"],"p_ticket_hash": string,"p_user_id": string }; Returns: string
                           },
"wa_get_verification":
{ Args: { "p_ticket_hash": string }; Returns: {
              "code": string,"expires_at": string,"phone": string,"purpose": Database["public"]['Enums']["wa_purpose"],"status": Database["public"]['Enums']["wa_status"]
            }[]
                           },
"wa_receive":
{ Args: { "p_body": string,"p_from": string,"p_message_id": string }; Returns: Json
                           },
"withdraw_challenge":
{ Args: { "p_challenge_id": string }; Returns: undefined
                           },
"withdraw_join_request":
{ Args: { "p_request_id": string }; Returns: undefined
                           },
"withdraw_tournament_team":
{ Args: { "p_team_id": string,"p_tournament_id": string }; Returns: undefined
                           }
          }
          Enums: {
            "account_status": "active"|"suspended","app_role": "admin"|"moderator","attendance_status": "attended"|"no_show"|"excused","booking_kind": "customer"|"manual"|"block","booking_mode": "platform"|"contact_only","booking_status": "requested"|"confirmed"|"rejected"|"cancelled"|"completed"|"no_show"|"expired","challenge_status": "pending"|"accepted"|"declined"|"withdrawn"|"expired","conversation_kind": "match"|"team"|"booking"|"challenge"|"tournament"|"direct","field_surface": "artificial_turf"|"natural_grass"|"indoor"|"futsal_court"|"other","fixture_stage": "group"|"knockout","fixture_status": "scheduled"|"completed"|"cancelled","invitation_status": "pending"|"accepted"|"declined"|"revoked"|"expired","listing_status": "open"|"closed","manual_payment_status": "unpaid"|"paid"|"waived","match_booking_status": "none"|"external"|"requested"|"confirmed","match_event_type": "goal"|"assist"|"own_goal"|"clean_sheet","match_format": "5v5"|"6v6"|"7v7"|"8v8"|"9v9"|"11v11","match_join_policy": "open"|"approval"|"invite_only","match_result_status": "reported"|"confirmed"|"disputed","match_status": "draft"|"open"|"full"|"confirmed"|"in_progress"|"completed"|"cancelled","match_type": "open"|"team_needs_players"|"team_vs_team"|"private","opponent_request_status": "open"|"matched"|"closed","participant_status": "pending"|"confirmed"|"left"|"removed"|"rejected","payment_collector": "organizer"|"venue"|"each_player"|"none","player_position": "goalkeeper"|"defender"|"midfielder"|"forward","report_category": "spam"|"harassment"|"fake_listing"|"fraudulent_booking"|"inappropriate_content"|"unsafe_behavior"|"other","report_status": "open"|"in_review"|"resolved"|"dismissed","report_target": "user"|"match"|"team"|"venue"|"message"|"review"|"tournament"|"booking","request_status": "pending"|"approved"|"rejected"|"withdrawn","result_status": "none"|"submitted"|"confirmed"|"disputed","review_status": "published"|"hidden","skill_level": "beginner"|"intermediate"|"advanced","team_join_policy": "request"|"invite_only","team_role": "captain"|"manager"|"player","team_side": "home"|"away","tournament_format": "round_robin"|"single_elimination"|"groups_knockout","tournament_status": "draft"|"registration_open"|"registration_closed"|"in_progress"|"completed"|"cancelled","tournament_team_status": "pending"|"approved"|"rejected"|"waitlisted"|"withdrawn","venue_role": "owner"|"manager"|"staff","verification_status": "unverified"|"pending"|"verified"|"rejected","visibility_level": "public"|"private","wa_purpose": "signup"|"reset","wa_status": "pending"|"verified"|"phone_taken"|"no_account"|"consumed","waitlist_status": "waiting"|"promoted"|"left"|"removed"|"expired"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "account_status": ["active", "suspended"],"app_role": ["admin", "moderator"],"attendance_status": ["attended", "no_show", "excused"],"booking_kind": ["customer", "manual", "block"],"booking_mode": ["platform", "contact_only"],"booking_status": ["requested", "confirmed", "rejected", "cancelled", "completed", "no_show", "expired"],"challenge_status": ["pending", "accepted", "declined", "withdrawn", "expired"],"conversation_kind": ["match", "team", "booking", "challenge", "tournament", "direct"],"field_surface": ["artificial_turf", "natural_grass", "indoor", "futsal_court", "other"],"fixture_stage": ["group", "knockout"],"fixture_status": ["scheduled", "completed", "cancelled"],"invitation_status": ["pending", "accepted", "declined", "revoked", "expired"],"listing_status": ["open", "closed"],"manual_payment_status": ["unpaid", "paid", "waived"],"match_booking_status": ["none", "external", "requested", "confirmed"],"match_event_type": ["goal", "assist", "own_goal", "clean_sheet"],"match_format": ["5v5", "6v6", "7v7", "8v8", "9v9", "11v11"],"match_join_policy": ["open", "approval", "invite_only"],"match_result_status": ["reported", "confirmed", "disputed"],"match_status": ["draft", "open", "full", "confirmed", "in_progress", "completed", "cancelled"],"match_type": ["open", "team_needs_players", "team_vs_team", "private"],"opponent_request_status": ["open", "matched", "closed"],"participant_status": ["pending", "confirmed", "left", "removed", "rejected"],"payment_collector": ["organizer", "venue", "each_player", "none"],"player_position": ["goalkeeper", "defender", "midfielder", "forward"],"report_category": ["spam", "harassment", "fake_listing", "fraudulent_booking", "inappropriate_content", "unsafe_behavior", "other"],"report_status": ["open", "in_review", "resolved", "dismissed"],"report_target": ["user", "match", "team", "venue", "message", "review", "tournament", "booking"],"request_status": ["pending", "approved", "rejected", "withdrawn"],"result_status": ["none", "submitted", "confirmed", "disputed"],"review_status": ["published", "hidden"],"skill_level": ["beginner", "intermediate", "advanced"],"team_join_policy": ["request", "invite_only"],"team_role": ["captain", "manager", "player"],"team_side": ["home", "away"],"tournament_format": ["round_robin", "single_elimination", "groups_knockout"],"tournament_status": ["draft", "registration_open", "registration_closed", "in_progress", "completed", "cancelled"],"tournament_team_status": ["pending", "approved", "rejected", "waitlisted", "withdrawn"],"venue_role": ["owner", "manager", "staff"],"verification_status": ["unverified", "pending", "verified", "rejected"],"visibility_level": ["public", "private"],"wa_purpose": ["signup", "reset"],"wa_status": ["pending", "verified", "phone_taken", "no_account", "consumed"],"waitlist_status": ["waiting", "promoted", "left", "removed", "expired"]
          }
        }
} as const
