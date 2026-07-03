function extractErrorMessage(error: unknown) {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return "";
}

export function getUserFacingError(
  error: unknown,
  fallback = "Something went wrong. Please try again.",
) {
  const message = extractErrorMessage(error).trim();

  if (!message) {
    return fallback;
  }

  if (
    /schema cache|relation .* does not exist|could not find the table|postgres|postgrest|pgrst\d*|supabase|openai|api key|stack trace|sqlstate/i.test(
      message,
    )
  ) {
    return fallback;
  }

  return message;
}
