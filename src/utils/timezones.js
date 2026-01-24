/**
 * North American timezone options for studio settings
 * Uses IANA timezone identifiers for proper date/time handling
 */

export const NORTH_AMERICAN_TIMEZONES = [
  // United States
  { value: "America/New_York", label: "Eastern Time (ET)", region: "United States" },
  { value: "America/Chicago", label: "Central Time (CT)", region: "United States" },
  { value: "America/Denver", label: "Mountain Time (MT)", region: "United States" },
  { value: "America/Phoenix", label: "Arizona (MST - No DST)", region: "United States" },
  { value: "America/Los_Angeles", label: "Pacific Time (PT)", region: "United States" },
  { value: "America/Anchorage", label: "Alaska Time (AKT)", region: "United States" },
  { value: "Pacific/Honolulu", label: "Hawaii Time (HST)", region: "United States" },
  
  // Canada
  { value: "America/St_Johns", label: "Newfoundland Time (NT)", region: "Canada" },
  { value: "America/Halifax", label: "Atlantic Time (AT)", region: "Canada" },
  { value: "America/Toronto", label: "Eastern Time (ET)", region: "Canada" },
  { value: "America/Winnipeg", label: "Central Time (CT)", region: "Canada" },
  { value: "America/Edmonton", label: "Mountain Time (MT)", region: "Canada" },
  { value: "America/Vancouver", label: "Pacific Time (PT)", region: "Canada" },
  
  // Mexico
  { value: "America/Mexico_City", label: "Central Time (CT)", region: "Mexico" },
  { value: "America/Cancun", label: "Eastern Time (ET)", region: "Mexico" },
  { value: "America/Tijuana", label: "Pacific Time (PT)", region: "Mexico" },
  { value: "America/Chihuahua", label: "Mountain Time (MT)", region: "Mexico" },
  
  // Caribbean
  { value: "America/Puerto_Rico", label: "Atlantic Time (AST)", region: "Caribbean" },
  
  // UTC fallback
  { value: "UTC", label: "UTC (Coordinated Universal Time)", region: "Other" }
];

/**
 * Get timezone label by value
 */
export function getTimezoneLabel(value) {
  const tz = NORTH_AMERICAN_TIMEZONES.find(t => t.value === value);
  return tz ? tz.label : value;
}

/**
 * Format a date and time in a specific timezone
 * @param {string} dateStr - Date string in YYYY-MM-DD format
 * @param {string} timeStr - Time string in HH:MM format
 * @param {string} timezone - IANA timezone identifier
 * @returns {string} Formatted date/time string
 */
export function formatInTimezone(dateStr, timeStr, timezone) {
  try {
    // Create a date object treating the input as local to the target timezone
    const dateTimeStr = `${dateStr}T${timeStr}:00`;
    
    // Use Intl.DateTimeFormat to format in the target timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short'
    });
    
    // Parse the date string as if it's in the target timezone
    // First, get the offset for that timezone
    const date = new Date(dateTimeStr);
    
    return formatter.format(date);
  } catch (e) {
    // Fallback if timezone is invalid
    return `${dateStr} at ${timeStr}`;
  }
}

/**
 * Get short timezone abbreviation
 */
export function getTimezoneAbbreviation(timezone) {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'short'
    });
    const parts = formatter.formatToParts(new Date());
    const tzPart = parts.find(p => p.type === 'timeZoneName');
    return tzPart?.value || timezone;
  } catch {
    return timezone;
  }
}
