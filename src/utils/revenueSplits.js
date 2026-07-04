function isActive(rule) {
  return Boolean(rule?.is_active);
}

function normalizeSplitMode(rawMode) {
  return rawMode === "fixed_amount" ? "fixed_amount" : "percent";
}

function normalizeSplitValue(mode, rawValue, legacyPercent) {
  const fallback = mode === "percent" ? Number(legacyPercent) || 0 : 0;
  const candidate = Number(rawValue);
  const parsed = Number.isFinite(candidate) ? candidate : fallback;
  if (mode === "percent") {
    return Math.min(100, Math.max(0, parsed));
  }
  return Math.max(0, parsed);
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

export function isAppointmentTypeSplitEnabled(artist) {
  return Boolean(artist?.appointment_type_split_enabled);
}

export function resolveRevenueSplitRule(
  splitRules,
  { appointmentTypeId, artistId, appointmentTypeSplitEnabled = true }
) {
  const rules = Array.isArray(splitRules) ? splitRules : [];

  const buildResult = (rule, source) => {
    const splitMode = normalizeSplitMode(rule?.split_mode);
    const splitValue = normalizeSplitValue(splitMode, rule?.split_value, rule?.split_percent);
    const splitPercent = splitMode === "percent" ? splitValue : 0;
    const computeArtistShare = (serviceAmount) => {
      const service = Math.max(0, Number(serviceAmount) || 0);
      if (splitMode === "fixed_amount") {
        return Math.min(splitValue, service);
      }
      return service * (splitValue / 100);
    };
    return {
      splitMode,
      splitValue,
      splitPercent,
      source,
      rule,
      computeArtistShare,
      displayLabel:
        splitMode === "fixed_amount"
          ? `$${splitValue.toFixed(2)}`
          : `${splitValue}%`,
    };
  };

  const byAppointmentAndArtist = rules.find(
    (rule) =>
      isActive(rule) &&
      rule.appointment_type_id === appointmentTypeId &&
      rule.artist_id === artistId
  );
  if (byAppointmentAndArtist && appointmentTypeSplitEnabled !== false) {
    return buildResult(byAppointmentAndArtist, "appointment_artist");
  }

  const byAppointment = rules.find(
    (rule) =>
      isActive(rule) &&
      rule.appointment_type_id === appointmentTypeId &&
      !rule.artist_id
  );
  if (byAppointment) {
    return buildResult(byAppointment, "appointment");
  }

  const byArtist = rules.find(
    (rule) =>
      isActive(rule) &&
      rule.artist_id === artistId &&
      !rule.appointment_type_id
  );
  if (byArtist) {
    return buildResult(byArtist, "artist");
  }

  return {
    splitMode: "percent",
    splitValue: 0,
    splitPercent: 0,
    source: "none",
    rule: null,
    computeArtistShare: () => 0,
    displayLabel: "0%",
  };
}

/** Portion of appointment tax allocated to service lines (products are 100% shop). */
export function allocateServiceTax({ service, product }, taxAmount) {
  const svc = Math.max(0, Number(service) || 0);
  const prod = Math.max(0, Number(product) || 0);
  const tax = Math.max(0, Number(taxAmount) || 0);
  const base = svc + prod;
  if (base <= 0 || tax <= 0) return 0;
  return tax * (svc / base);
}

/**
 * Artist/shop shares for settlement and reporting.
 * Percent splits apply to service + service tax (artists remit HST on their share).
 * Fixed-amount splits are unchanged: exact dollar payout, capped at pre-tax service.
 */
export function computeAppointmentShares(splitResolution, amounts, taxAmount) {
  const service = Math.max(0, Number(amounts?.service) || 0);
  const product = Math.max(0, Number(amounts?.product) || 0);
  const tax = Math.max(0, Number(taxAmount) || 0);
  const serviceTax = allocateServiceTax({ service, product }, tax);
  const totalCollected = service + product + tax;

  let artistShare;
  if (splitResolution.splitMode === "fixed_amount") {
    artistShare = splitResolution.computeArtistShare(service);
  } else {
    artistShare = splitResolution.computeArtistShare(service + serviceTax);
  }

  const shopShare = totalCollected - artistShare;
  return { artistShare, shopShare };
}
