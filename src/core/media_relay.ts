export interface MediaRelayConfig {
  url: string;
  apiKey: string;
}

/**
 * Parses Google Task titles added via Google Home / Google Assistant to determine
 * if the voice input was an explicit media download command.
 *
 * Examples:
 * - "download Inception" -> "Inception"
 * - "Hey Google grab Severance S02E05" -> "Severance S02E05"
 * - "torrent Dune Part Two" -> "Dune Part Two"
 * - "clean download folder" -> null
 * - "buy milk" -> null
 */
export function parseMediaVoiceQuery(rawTitle: string): string | null {
  if (!rawTitle) return null;
  const trimmed = rawTitle.trim();
  if (!trimmed) return null;

  // Strip optional leading wake phrases like "Hey Google, " or "Ok Google, "
  const withoutWake = trimmed.replace(/^(?:hey|ok)\s+google[,\s]*/i, "").trim();

  // Match download, grab, torrent prefixes followed by the media title
  const match = withoutWake.match(/^(?:download|grab|torrent)\s+(.+)$/i);
  if (!match) return null;

  const query = match[1].trim();
  return query.length > 0 ? query : null;
}

/**
 * Dispatches a voice download query to the TorrentRelay server via POST /api/voice-download.
 * Returns the spoken response message to broadcast over Google Home / Cast speakers.
 */
export async function dispatchMediaVoiceDownload(
  query: string,
  config: MediaRelayConfig,
  fetchFn: typeof fetch = fetch
): Promise<string> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return "No media title was provided.";
  }

  const base = config.url.replace(/\/+$/, "");
  const targetUrl = `${base}/api/voice-download`;

  try {
    const res = await fetchFn(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Relay-Key": config.apiKey || "",
      },
      body: JSON.stringify({ query: trimmedQuery }),
      signal: AbortSignal.timeout(45000),
    });

    const data = await res.json().catch(() => null);
    if (data && typeof data.spokenMessage === "string" && data.spokenMessage.trim().length > 0) {
      return data.spokenMessage;
    }

    if (!res.ok) {
      if (res.status === 401) {
        return "TorrentRelay API key was not recognized.";
      }
      return "Your media server reported an error.";
    }

    return "Media download request sent.";
  } catch (err) {
    console.error("[MediaRelay] voice-download error:", err);
    const errName = (err as { name?: string } | null)?.name;
    if (errName === "TimeoutError" || errName === "AbortError") {
      return "The media server took too long to respond. Check Deluge to see if the download started.";
    }
    return "Your media server appears to be offline right now.";
  }
}
