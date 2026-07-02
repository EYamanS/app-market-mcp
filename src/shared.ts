import { isApp, normApp, type AppInfo } from "./normalize.js";
import { lookup } from "./itunes.js";

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

export const ok = (data: unknown): ToolResult => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 1) }],
});

export const fail = (message: string): ToolResult => ({
  isError: true,
  content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
});

/** Wrap a tool handler so thrown errors surface as isError results, not protocol faults. */
export const guard =
  <A extends unknown[]>(fn: (...args: A) => Promise<ToolResult>) =>
  async (...args: A): Promise<ToolResult> => {
    try {
      return await fn(...args);
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  };

/** Best-effort progress notification; silently no-ops when the client didn't ask. */
export async function progress(
  extra: any,
  done: number,
  total: number,
  message: string,
): Promise<void> {
  const token = extra?._meta?.progressToken;
  if (token === undefined || typeof extra?.sendNotification !== "function") return;
  try {
    await extra.sendNotification({
      method: "notifications/progress",
      params: { progressToken: token, progress: done, total, message },
    });
  } catch {
    // progress is decorative; never let it break the tool call
  }
}

/** Fuller app record for profile-style tools. */
export function fullProfile(r: any) {
  return {
    ...normApp(r),
    description: typeof r.description === "string" ? r.description.slice(0, 700) : "",
    min_os: r.minimumOsVersion ?? null,
    content_rating: r.contentAdvisoryRating ?? null,
    size_mb: r.fileSizeBytes ? Math.round(Number(r.fileSizeBytes) / 1_048_576) : null,
    languages: Array.isArray(r.languageCodesISO2A) ? r.languageCodesISO2A.length : null,
    screenshots: Array.isArray(r.screenshotUrls) ? r.screenshotUrls.length : null,
  };
}

/** Resolve a batch of track ids to names; throws listing any that don't exist. */
export async function resolveApps(
  ids: string[],
  country: string,
): Promise<Record<string, string>> {
  if (!ids.length) return {};
  const results = (await lookup({ id: ids.join(","), country, limit: 200 }))
    .filter(isApp)
    .map(normApp);
  const found: Record<string, string> = {};
  for (const a of results) found[a.id] = a.name;
  const missing = ids.filter((id) => !found[id]);
  if (missing.length) {
    throw new Error(
      `Unknown app id(s) in the ${country} storefront: ${missing.join(", ")}. ` +
        `Use search_apps to find the right Apple track ids.`,
    );
  }
  return found;
}

export function findRank(apps: AppInfo[], id: string): number | null {
  const idx = apps.findIndex((a) => a.id === id);
  return idx >= 0 ? idx + 1 : null;
}
