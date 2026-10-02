import type { calendar_v3 } from "@googleapis/calendar";

type RetryConfig = NonNullable<calendar_v3.Options["retryConfig"]>;

const retryableMethods = ["GET", "HEAD", "PUT", "OPTIONS", "DELETE", "PATCH"];

export function getGoogleCalendarRetryConfig(): RetryConfig {
  return {
    retry: 3,
    noResponseRetries: 2,
    httpMethodsToRetry: retryableMethods,
    retryBackoff: async (error) => {
      const attempt = error.config.retryConfig?.currentRetryAttempt ?? 1;
      const delay = 1000 * 2 ** (attempt - 1) + Math.random() * 1000;
      await new Promise((resolve) => setTimeout(resolve, delay));
    },
    // A custom predicate replaces all gaxios safeguards, including its attempt and method limits.
    shouldRetry: (error) => {
      const config = error.config.retryConfig;
      const attempt = config?.currentRetryAttempt ?? 0;
      if (error.name === "AbortError" || error.error?.name === "AbortError") return false;
      if (attempt >= (config?.retry ?? 3)) return false;
      if (!retryableMethods.includes(error.config.method?.toUpperCase() ?? "")) return false;
      if (!error.response) return attempt < (config?.noResponseRetries ?? 2);

      const status = error.response.status;
      if (status === 403) {
        const data: unknown = error.response.data;
        if (!data || typeof data !== "object" || !("error" in data)) return false;
        const details = data.error;
        if (!details || typeof details !== "object" || !("errors" in details)) return false;
        if (!Array.isArray(details.errors)) return false;
        return details.errors.some(
          (item: unknown) =>
            item !== null &&
            typeof item === "object" &&
            "reason" in item &&
            (item.reason === "rateLimitExceeded" || item.reason === "userRateLimitExceeded")
        );
      }

      return (status >= 100 && status <= 199) || status === 429 || (status >= 500 && status <= 599);
    },
  };
}
