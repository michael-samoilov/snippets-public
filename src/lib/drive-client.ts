"use client";

/**
 * Google Drive from the browser — the same small REST surface the
 * server used to own (find-or-create the visible folder, update
 * files in place, heal what's missing), now run by the writer's own
 * device with the writer's own token. Scope is drive.file: only what
 * this app created is even visible.
 */
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
    headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
  if (response.status === 401 || response.status === 403) {
    const body = await response.text().catch(() => "");
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

function multipartBody(
  boundary: string,
  metadata: Record<string, unknown>,
  mimeType: string,
  body: string,
): string {
  return [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    `Content-Type: ${mimeType}; charset=UTF-8`,
    "",
    body,
    `--${boundary}--`,
  ].join("\r\n");
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
    response = await driveFetch(
      token,
      `${UPLOAD}/files?uploadType=multipart&fields=id`,
      {
        method: "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body: multipartBody(boundary, metadata, content.mimeType, content.body),
      },
    );
  }
  if (!response.ok) throw new Error(`drive create ${response.status}`);
  return ((await response.json()) as { id: string }).id;
}

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

/** Update-in-place (re-setting the mimeType), or create when gone. */
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

  const boundary = `snippets-${Date.now().toString(36)}`;
  if (fileId) {
    const response = await driveFetch(
      token,
      `${UPLOAD}/files/${fileId}?uploadType=multipart&fields=id`,
      {
        method: "PATCH",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body: multipartBody(boundary, { mimeType }, mimeType, body),
      },
    );
    if (!response.ok) throw new Error(`drive update ${response.status}`);
    return fileId;
  }
  return createFile(token, { name, parents: [parentId] }, { mimeType, body });
}
