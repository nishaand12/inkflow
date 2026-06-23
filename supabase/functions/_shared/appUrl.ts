/** Base app URL from env, without trailing slashes. */
export function getAppBaseUrl(): string {
  return (Deno.env.get("APP_URL") || "https://inkflow.app").replace(/\/+$/, "");
}

/** Join base URL with a path (e.g. `/manage-appointment?token=...`). */
export function appUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${getAppBaseUrl()}${normalizedPath}`;
}
