import {
  BOOKING_SLOT_MINUTES,
  computeArtistSlots,
  computeAnyArtistSlots,
} from "./bookingSlots";

const artistId = "artist-1";
const locationId = "loc-1";
const date = "2026-07-15"; // Wednesday

const baseParams = {
  artistId,
  date,
  locationId,
  durationMinutes: 15,
  availabilities: [],
  weeklySchedules: [],
  appointments: [],
  workStations: [],
};

describe("BOOKING_SLOT_MINUTES", () => {
  it("uses 5-minute increments for public booking slots", () => {
    expect(BOOKING_SLOT_MINUTES).toBe(5);
  });
});

describe("computeArtistSlots", () => {
  it("offers slots every 5 minutes within weekly availability", () => {
    const slots = computeArtistSlots({
      ...baseParams,
      weeklySchedules: [
        {
          artist_id: artistId,
          day_of_week: 3,
          start_time: "12:00",
          end_time: "12:30",
          location_id: locationId,
        },
      ],
    });

    expect(slots.map((s) => s.time)).toEqual([
      "12:00",
      "12:05",
      "12:10",
      "12:15",
    ]);
  });

  it("excludes slots overlapping a blocked window", () => {
    const slots = computeArtistSlots({
      ...baseParams,
      weeklySchedules: [
        {
          artist_id: artistId,
          day_of_week: 3,
          start_time: "10:00",
          end_time: "11:00",
          location_id: locationId,
        },
      ],
      availabilities: [
        {
          artist_id: artistId,
          start_date: date,
          end_date: date,
          start_time: "10:15",
          end_time: "10:30",
          is_blocked: true,
          is_all_day: false,
          location_id: locationId,
        },
      ],
    });

    expect(slots.map((s) => s.time)).toEqual([
      "10:00",
      "10:30",
      "10:35",
      "10:40",
      "10:45",
    ]);
  });

  it("excludes slots conflicting with an existing appointment", () => {
    const slots = computeArtistSlots({
      ...baseParams,
      weeklySchedules: [
        {
          artist_id: artistId,
          day_of_week: 3,
          start_time: "14:00",
          end_time: "15:00",
          location_id: locationId,
        },
      ],
      appointments: [
        {
          id: "apt-1",
          artist_id: artistId,
          appointment_date: date,
          start_time: "14:20",
          end_time: "14:35",
          status: "confirmed",
          location_id: locationId,
        },
      ],
    });

    expect(slots.map((s) => s.time)).toEqual([
      "14:00",
      "14:05",
      "14:35",
      "14:40",
      "14:45",
    ]);
  });

  it("ignores the excluded appointment when rescheduling", () => {
    const slots = computeArtistSlots({
      ...baseParams,
      weeklySchedules: [
        {
          artist_id: artistId,
          day_of_week: 3,
          start_time: "14:00",
          end_time: "14:30",
          location_id: locationId,
        },
      ],
      appointments: [
        {
          id: "apt-1",
          artist_id: artistId,
          appointment_date: date,
          start_time: "14:10",
          end_time: "14:25",
          status: "confirmed",
          location_id: locationId,
        },
      ],
      excludeAppointmentId: "apt-1",
    });

    expect(slots.map((s) => s.time)).toEqual([
      "14:00",
      "14:05",
      "14:10",
      "14:15",
    ]);
  });
});

describe("computeAnyArtistSlots", () => {
  it("merges and dedupes slots across artists by time", () => {
    const slots = computeAnyArtistSlots({
      ...baseParams,
      artistIds: ["artist-1", "artist-2"],
      artists: [
        { id: "artist-1", preferred_work_station_id: null },
        { id: "artist-2", preferred_work_station_id: null },
      ],
      weeklySchedules: [
        {
          artist_id: "artist-1",
          day_of_week: 3,
          start_time: "09:00",
          end_time: "09:20",
          location_id: locationId,
        },
        {
          artist_id: "artist-2",
          day_of_week: 3,
          start_time: "09:05",
          end_time: "09:20",
          location_id: locationId,
        },
      ],
    });

    expect(slots.map((s) => s.time)).toEqual([
      "09:00",
      "09:05",
    ]);
    expect(slots.find((s) => s.time === "09:00")?.artistId).toBe("artist-1");
    expect(slots.find((s) => s.time === "09:05")?.artistId).toBe("artist-1");
  });
});
