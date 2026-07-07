/**
 * A small Google Drive REST client — plain fetch, no googleapis SDK.
 * Scope is drive.file: the app sees only what it created, and the
 * "Snippets" folder it creates is a normal, visible folder in the
 * user's own Drive (never the hidden appDataFolder — the entire point
 * is that these files remain findable if this app disappears).
 *
 * Drive keeps ~30 days of old revisions on every update-in-place, a
 * free second belt against a bad backup run.
 */
import "server-only";

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";

/** The grant is gone (revoked, expired) — reconnect required. */
export class DriveTokenRevoked extends Error {}

async function driveFetch(
  token: string,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  if (response.status === 401 || response.status === 403) {
    const body = await response.text().catch(() => "");
    // insufficient scope or a dead token both mean: reconnect
    throw new DriveTokenRevoked(`drive ${response.status}: ${body.slice(0, 200)}`);
  }
  return response;
}

async function fileExists(token: string, fileId: string): Promise<boolean> {
  const response = await driveFetch(
    token,
    `${API}/files/${fileId}?fields=id,trashed`,
  );
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`drive get ${response.status}`);
  const data = (await response.json()) as { trashed?: boolean };
  return !data.trashed;
}

async function findByName(
  token: string,
  name: string,
  parentId?: string,
): Promise<string | null> {
  const clauses = [
    `name = '${name.replace(/'/g, "\\'")}'`,
    "trashed = false",
    ...(parentId ? [`'${parentId}' in parents`] : [`mimeType = '${FOLDER_MIME}'`]),
  ];
  const response = await driveFetch(
    token,
    `${API}/files?q=${encodeURIComponent(clauses.join(" and "))}&fields=files(id)&pageSize=1`,
  );
  if (!response.ok) throw new Error(`drive list ${response.status}`);
  const data = (await response.json()) as { files?: { id: string }[] };
  return data.files?.[0]?.id ?? null;
}

async function createFile(
  token: string,
  metadata: Record<string, unknown>,
  content?: { mimeType: string; body: string },
): Promise<string> {
  let response: Response;
  if (!content) {
    response = await driveFetch(token, `${API}/files?fields=id`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(metadata),
    });
  } else {
    const boundary = `snippets-${Date.now().toString(36)}`;
    const body = [
      `--${boundary}`,
      "Content-Type: application/json; charset=UTF-8",
      "",
      JSON.stringify(metadata),
      `--${boundary}`,
      `Content-Type: ${content.mimeType}; charset=UTF-8`,
      "",
      content.body,
      `--${boundary}--`,
    ].join("\r\n");
    response = await driveFetch(
      token,
      `${UPLOAD}/files?uploadType=multipart&fields=id`,
      {
        method: "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body,
      },
    );
  }
  if (!response.ok) throw new Error(`drive create ${response.status}`);
  const data = (await response.json()) as { id: string };
  return data.id;
}

/** Find-or-create the visible "Snippets" folder. Returns its id. */
export async function ensureFolder(
  token: string,
  knownId: string | null,
  name = "Snippets",
): Promise<string> {
  if (knownId && (await fileExists(token, knownId))) return knownId;
  const found = await findByName(token, name);
  if (found) return found;
  return createFile(token, { name, mimeType: FOLDER_MIME });
}

/**
 * Update-in-place, or create when the file is gone (the user may
 * delete or move anything — we heal rather than fail). Returns the
 * current file id.
 */
export async function upsertFile(
  token: string,
  options: {
    knownId: string | null;
    name: string;
    parentId: string;
    mimeType: string;
    body: string;
  },
): Promise<string> {
  const { knownId, name, parentId, mimeType, body } = options;

  let fileId = knownId && (await fileExists(token, knownId)) ? knownId : null;
  if (!fileId) fileId = await findByName(token, name, parentId);

  if (fileId) {
    // multipart PATCH (metadata + media), not media-only, so the file's
    // stored mimeType is re-set on every write — that's what corrects an
    // already-uploaded file whose old MIME the Drive app won't preview
    const boundary = `snippets-${Date.now().toString(36)}`;
    const multipart = [
      `--${boundary}`,
      "Content-Type: application/json; charset=UTF-8",
      "",
      JSON.stringify({ mimeType }),
      `--${boundary}`,
      `Content-Type: ${mimeType}; charset=UTF-8`,
      "",
      body,
      `--${boundary}--`,
    ].join("\r\n");
    const response = await driveFetch(
      token,
      `${UPLOAD}/files/${fileId}?uploadType=multipart&fields=id`,
      {
        method: "PATCH",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body: multipart,
      },
    );
    if (!response.ok) throw new Error(`drive update ${response.status}`);
    return fileId;
  }
  return createFile(
    token,
    { name, parents: [parentId] },
    { mimeType, body },
  );
}
