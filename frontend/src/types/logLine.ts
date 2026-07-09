/** A single log line as returned by the REST history endpoint and streamed over the WS feed. */
export interface LogLineEntry {
  /** Monotonic-ish byte/line offset within the source, used for paging ("before" cursor). */
  offset: number;
  /** RFC3339 timestamp. */
  ts: string;
  text: string;
  /** Path of the underlying file this line came from (relevant for glob sources). */
  file: string;
}

export interface LinesPage {
  entries: LogLineEntry[];
  hasMore: boolean;
}
