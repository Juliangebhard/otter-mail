/**
 * Invitations in Google Calendar: your answer, and RSVP in place (your
 * calendar updates and the organizer is notified, sendUpdates=all). Accounts
 * connected before the app asked for calendar access get NoCalendarAccess, and
 * services/calendar-invites.ts replies by email instead.
 */

import { platform } from "../../platform.js";
import { NoCalendarAccess, type RsvpResponse } from "../provider.js";

const CALENDAR = "https://www.googleapis.com/calendar/v3/calendars/primary";

async function calendarFetch(
  accountId: string,
  path: string,
  init: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<unknown> {
  const token = await platform().google.getAccessToken(accountId);
  const response = await fetch(`${CALENDAR}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (response.status === 403 || response.status === 401) {
    const body = await response.text().catch(() => "");
    if (/insufficient|scope|PERMISSION_DENIED|accessNotConfigured|has not been used/i.test(body))
      throw new NoCalendarAccess(body.slice(0, 200));
    throw new Error(`Calendar API error: ${response.status} ${body.slice(0, 200)}`);
  }
  if (!response.ok)
    throw new Error(
      `Calendar API error: ${response.status} ${(await response.text()).slice(0, 200)}`,
    );
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

type ApiEvent = {
  id: string;
  htmlLink?: string;
  attendees?: { email: string; self?: boolean; responseStatus?: string }[];
};

async function lookup(accountId: string, uid: string): Promise<ApiEvent | null> {
  const data = (await calendarFetch(
    accountId,
    `/events?iCalUID=${encodeURIComponent(uid)}&showDeleted=false&maxResults=1`,
  )) as { items?: ApiEvent[] };
  return data.items?.[0] ?? null;
}

function selfStatus(event: ApiEvent, email: string): RsvpResponse | "needsAction" {
  const me = event.attendees?.find((a) => a.self || a.email.toLowerCase() === email);
  const status = me?.responseStatus;
  return status === "accepted" || status === "declined" || status === "tentative"
    ? status
    : "needsAction";
}

export async function findEvent(
  accountId: string,
  uid: string,
): Promise<{ response: RsvpResponse | "needsAction"; htmlLink: string | null } | null> {
  const found = await lookup(accountId, uid);
  if (!found) return null;
  return { response: selfStatus(found, accountId.toLowerCase()), htmlLink: found.htmlLink ?? null };
}

export async function respond(
  accountId: string,
  uid: string,
  response: RsvpResponse,
): Promise<boolean> {
  const found = await lookup(accountId, uid);
  if (!found) return false;
  const email = accountId.toLowerCase();
  const attendees = (found.attendees ?? []).map((a) =>
    a.self || a.email.toLowerCase() === email ? { ...a, responseStatus: response } : a,
  );
  if (!attendees.some((a) => a.self || a.email.toLowerCase() === email)) {
    attendees.push({ email, self: true, responseStatus: response });
  }
  await calendarFetch(accountId, `/events/${encodeURIComponent(found.id)}?sendUpdates=all`, {
    method: "PATCH",
    body: JSON.stringify({ attendees }),
  });
  return true;
}
