function isActive(rule) {
  return Boolean(rule?.is_active);
}

function hasArtistScope(rule) {
  return Boolean(rule?.artist_id);
}

function hasAppointmentScope(rule) {
  return Boolean(rule?.appointment_type_id);
}

export function isArtistDefaultSplitRule(rule) {
  return isActive(rule) && hasArtistScope(rule) && !hasAppointmentScope(rule);
}

export function isAppointmentDefaultSplitRule(rule, appointmentTypeId) {
  return (
    isActive(rule) &&
    rule?.appointment_type_id === appointmentTypeId &&
    !hasArtistScope(rule)
  );
}

export function isAppointmentArtistSplitRule(rule, appointmentTypeId) {
  return (
    isActive(rule) &&
    rule?.appointment_type_id === appointmentTypeId &&
    hasArtistScope(rule)
  );
}

export function resolveRevenueSplitRule(splitRules, { appointmentTypeId, artistId }) {
  const rules = Array.isArray(splitRules) ? splitRules : [];

  const byAppointmentAndArtist = rules.find(
    (rule) =>
      isActive(rule) &&
      rule.appointment_type_id === appointmentTypeId &&
      rule.artist_id === artistId
  );
  if (byAppointmentAndArtist) {
    return {
      splitPercent: Number(byAppointmentAndArtist.split_percent) || 0,
      source: "appointment_artist",
      rule: byAppointmentAndArtist,
    };
  }

  const byAppointment = rules.find(
    (rule) =>
      isActive(rule) &&
      rule.appointment_type_id === appointmentTypeId &&
      !rule.artist_id
  );
  if (byAppointment) {
    return {
      splitPercent: Number(byAppointment.split_percent) || 0,
      source: "appointment",
      rule: byAppointment,
    };
  }

  const byArtist = rules.find(
    (rule) =>
      isActive(rule) &&
      rule.artist_id === artistId &&
      !rule.appointment_type_id
  );
  if (byArtist) {
    return {
      splitPercent: Number(byArtist.split_percent) || 0,
      source: "artist",
      rule: byArtist,
    };
  }

  return { splitPercent: 0, source: "none", rule: null };
}
