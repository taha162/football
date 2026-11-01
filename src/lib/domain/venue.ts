export const FACILITIES = [
  "parking", "changing_rooms", "showers", "lighting", "cafeteria", "drinking_water",
  "seating", "wifi", "prayer_room", "first_aid", "equipment_rental", "covered",
] as const;
export type Facility = (typeof FACILITIES)[number];

export const SURFACES = ["artificial_turf", "natural_grass", "indoor", "futsal_court", "other"] as const;
export type Surface = (typeof SURFACES)[number];

export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

export const BOOKING_STATUSES = ["requested", "confirmed", "rejected", "cancelled", "completed", "no_show", "expired"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const DEPOSIT_STATUSES = ["pending", "reported", "received", "refund_due", "refunded", "forfeited"] as const;
export type DepositStatus = (typeof DEPOSIT_STATUSES)[number];

/**
 * A venue takes platform bookings when verified and switched to platform
 * mode, and, while bookings need a deposit, once it has said how to pay it.
 */
export function acceptsPlatformBookings(
  v: { booking_mode: string; verification_status: string; deposit_instructions?: string | null },
  depositsOn: boolean,
): boolean {
  return v.booking_mode === "platform" && v.verification_status === "verified" && (!depositsOn || Boolean(v.deposit_instructions?.trim()));
}
