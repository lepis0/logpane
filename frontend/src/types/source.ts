export type SourceType = "file" | "glob";

export interface SourceStatus {
  activeFile: string;
  matchedFileCount: number;
  size: number;
  /** RFC3339 timestamp. */
  modTime: string;
  readable: boolean;
  lastError: string;
}

/** Full source object as returned by GET /sources and GET /sources/{id}. */
export interface Source {
  id: string;
  name: string;
  type: SourceType;
  path: string;
  color: string;
  tags: string[];
  excludePatterns: string[];
  allowRoll: boolean;
  enabled: boolean;
  status: SourceStatus;
}

/** POST /sources body: same shape minus id/status - server assigns id. */
export interface CreateSourceInput {
  name: string;
  type: SourceType;
  path: string;
  color: string;
  tags: string[];
  excludePatterns: string[];
  allowRoll: boolean;
  enabled: boolean;
}

/** PUT /sources/{id} body: id and type are immutable. */
export type UpdateSourceInput = Omit<CreateSourceInput, "type">;

export interface ValidateSourceInput {
  type: SourceType;
  path: string;
  excludePatterns: string[];
}

export interface MatchedFile {
  file: string;
  size: number;
  modTime: string;
}

export interface ValidateSourceResult {
  valid: boolean;
  matchedFiles: MatchedFile[];
  readable: boolean;
  message: string;
}

export interface SourceFile {
  file: string;
  size: number;
  modTime: string;
  active: boolean;
}

export interface BrowseEntry {
  name: string;
  path: string;
  type: "dir" | "file" | "other";
  size: number;
  modTime: string;
}

/** Response for GET /sources/browse?path= - always 200, even for an unreadable path. */
export interface BrowseResult {
  path: string;
  /** Parent directory's path, or "" when path is the filesystem root. */
  parent: string;
  entries: BrowseEntry[];
  readable: boolean;
  message: string;
}
