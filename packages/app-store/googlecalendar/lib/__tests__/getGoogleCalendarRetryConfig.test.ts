import { calendar_v3 } from "@googleapis/calendar";
import { describe, expect, test, vi } from "vitest";
import { getGoogleCalendarRetryConfig } from "../getGoogleCalendarRetryConfig";

function response(status: number, reason = "rateLimitExceeded") {
  return new Response(
    JSON.stringify(status === 200 ? { id: "existing-event" } : { error: { errors: [{ reason }] } }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

function setup(fetchImplementation: NonNullable<calendar_v3.Options["fetchImplementation"]>) {
  const backoff = vi.fn<NonNullable<NonNullable<calendar_v3.Options["retryConfig"]>["retryBackoff"]>>(
    async () => {}
  );
  const calendar = new calendar_v3.Calendar({
    fetchImplementation,
    retryConfig: { ...getGoogleCalendarRetryConfig(), retryBackoff: backoff },
  });
  const patch = () =>
    calendar.events.patch({
      calendarId: "primary",
      eventId: "existing-event",
      requestBody: { description: "Meet link" },
    });
  const insert = () => calendar.events.insert({ calendarId: "primary", requestBody: { summary: "New" } });
  const list = () => calendar.calendarList.list();
  return { patch, insert, list, backoff };
}

describe("Google Calendar retry policy", () => {
  test.each([
    [403, "rateLimitExceeded"],
    [403, "userRateLimitExceeded"],
    [429, "rateLimitExceeded"],
    [500, "backendError"],
  ])("retries PATCH after %s %s without creating another event", async (status, reason) => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(status, reason))
      .mockResolvedValueOnce(response(200));
    const { patch, backoff } = setup(fetch);

    await expect(patch()).resolves.toMatchObject({ data: { id: "existing-event" } });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.every(([, options]) => options.method === "PATCH")).toBe(true);
    expect(backoff).toHaveBeenCalledTimes(1);
  });

  test("stops after three retries and uses increasing backoff", async () => {
    const fetch = vi.fn(async () => response(403));
    const { patch, backoff } = setup(fetch);

    await expect(patch()).rejects.toMatchObject({ response: { status: 403 } });
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(backoff.mock.calls.map((call) => call[1])).toEqual([100, 500, 1500]);
  });

  test("waits with exponential backoff and jitter", async () => {
    vi.useFakeTimers();
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const timer = vi.spyOn(globalThis, "setTimeout");
    try {
      const fetch = vi
        .fn()
        .mockImplementation(async () => response(fetch.mock.calls.length <= 3 ? 403 : 200));
      const calendar = new calendar_v3.Calendar({
        fetchImplementation: fetch,
        retryConfig: getGoogleCalendarRetryConfig(),
      });
      const result = expect(
        calendar.events.patch({ calendarId: "primary", eventId: "existing-event" })
      ).resolves.toMatchObject({ data: { id: "existing-event" } });
      await vi.runAllTimersAsync();
      await result;
      expect(timer.mock.calls.map((call) => call[1])).toEqual([1500, 2500, 4500]);
    } finally {
      timer.mockRestore();
      random.mockRestore();
      vi.useRealTimers();
    }
  });

  test("preserves retries for GET", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response(500)).mockResolvedValueOnce(response(200));
    await expect(setup(fetch).list()).resolves.toMatchObject({ status: 200 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test.each([
    null,
    {},
    { error: null },
    { error: { errors: "invalid" } },
  ])("does not retry an unrecognized 403 payload %j", async (data) => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(data), { status: 403 }));
    await expect(setup(fetch).patch()).rejects.toMatchObject({ response: { status: 403 } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test.each([
    "forbidden",
    "forbiddenForNonOrganizer",
    "quotaExceeded",
  ])("does not retry permanent 403 %s", async (reason) => {
    const fetch = vi.fn(async () => response(403, reason));
    const { patch } = setup(fetch);
    await expect(patch()).rejects.toMatchObject({ response: { status: 403 } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test.each([400, 401, 404])("does not retry HTTP %s", async (status) => {
    const fetch = vi.fn(async () => response(status));
    await expect(setup(fetch).patch()).rejects.toMatchObject({ response: { status } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test.each([403, 429, 500])("does not retry POST after HTTP %s", async (status) => {
    const fetch = vi.fn(async () => response(status));
    await expect(setup(fetch).insert()).rejects.toMatchObject({ response: { status } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("does not retry POST after a lost response", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("Connection reset"));
    await expect(setup(fetch).insert()).rejects.toThrow("Connection reset");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("limits failures without a response to two retries", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("Connection reset"));
    await expect(setup(fetch).patch()).rejects.toThrow("Connection reset");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  test("does not retry aborted requests", async () => {
    const error = new Error("Aborted");
    error.name = "AbortError";
    const fetch = vi.fn().mockRejectedValue(error);
    await expect(setup(fetch).patch()).rejects.toThrow("Aborted");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("returns a fresh policy for each client", () => {
    const first = getGoogleCalendarRetryConfig();
    first.currentRetryAttempt = 3;
    expect(getGoogleCalendarRetryConfig().currentRetryAttempt).toBeUndefined();
  });
});
