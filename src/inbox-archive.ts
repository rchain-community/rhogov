import type { Community, InboxMessage } from "./chain/gov";
import { looksLikeRevAddress } from "./chain/keys";

export const ARCHIVE_MAX_BYTES = 20 * 1024 * 1024;

export interface InboxArchive {
  format: "rhogov-inbox";
  version: 1;
  recipient: string;
  community: Pick<Community, "node" | "inbox" | "group" | "issue">;
  messages: InboxMessage[];
}

const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

const invalid = () =>
  new Error("This is not a valid rhogov inbox archive. Nothing was imported.");

export function parseInboxArchive(
  text: string,
  recipient: string,
  community: Community,
): InboxArchive {
  if (new TextEncoder().encode(text).length > ARCHIVE_MAX_BYTES) {
    throw new Error(
      "rhogov refuses archive files larger than 20 MiB to bound parsing. Nothing was imported.",
    );
  }

  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw invalid();
  }

  if (
    !object(v) ||
    v.format !== "rhogov-inbox" ||
    typeof v.recipient !== "string" ||
    !object(v.community) ||
    !Array.isArray(v.messages)
  ) {
    throw invalid();
  }

  if (!Number.isInteger(v.version)) throw invalid();

  if ((v.version as number) > 1) {
    throw new Error(
      "This archive was created by a newer rhogov. Update rhogov and try again; nothing was imported.",
    );
  }

  if (v.version !== 1) {
    throw new Error(
      "This archive uses an unsupported rhogov inbox format. Nothing was imported.",
    );
  }

  const c = v.community;

  if (
    !["node", "inbox", "group", "issue"].every(
      (k) => typeof c[k] === "string",
    )
  ) {
    throw invalid();
  }

  if (v.recipient !== recipient) {
    throw new Error(
      "This archive belongs to another address. Use the key that collected it; nothing was imported.",
    );
  }

  if (
    !["node", "inbox", "group", "issue"].every(
      (k) => c[k] === community[k as keyof Community],
    )
  ) {
    throw new Error(
      "This archive belongs to another community or network. Open the matching community; nothing was imported.",
    );
  }

  const messages = v.messages.map((m: unknown): InboxMessage => {
    if (
      !object(m) ||
      typeof m.from !== "string" ||
      !looksLikeRevAddress(m.from) ||
      m.from !== m.from.trim() ||
      typeof m.type !== "string" ||
      !Number.isSafeInteger(m.at) ||
      (m.at as number) < 0 ||
      !object(m.fields)
    ) {
      throw invalid();
    }

    const fields: Record<string, string> = Object.create(null);

    for (const [key, value] of Object.entries(m.fields)) {
      if (typeof value !== "string") throw invalid();
      fields[key] = value;
    }

    return {
      from: m.from,
      type: m.type,
      at: m.at as number,
      fields,
    };
  });

  return {
    format: "rhogov-inbox",
    version: 1,
    recipient,
    community: {
      node: community.node,
      inbox: community.inbox,
      group: community.group,
      issue: community.issue,
    },
    messages,
  };
}

export function exportInboxArchive(
  recipient: string,
  community: Community,
  messages: InboxMessage[],
): string {
  const text = JSON.stringify(
    {
      format: "rhogov-inbox",
      version: 1,
      recipient,
      community: {
        node: community.node,
        inbox: community.inbox,
        group: community.group,
        issue: community.issue,
      },
      messages,
    },
    null,
    2,
  );

  parseInboxArchive(text, recipient, community);
  return text;
}

const identity = (m: InboxMessage) =>
  JSON.stringify([
    m.from,
    m.type,
    m.at,
    Object.entries(m.fields).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    ),
  ]);

/** Keep existing messages and duplicate multiplicities; importing again adds nothing. */
export function mergeInboxArchive(
  existing: InboxMessage[],
  incoming: InboxMessage[],
): InboxMessage[] {
  const counts = new Map<string, number>();

  for (const m of existing) {
    const id = identity(m);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  const seen = new Map<string, number>();
  const merged = [...existing];

  for (const m of incoming) {
    const id = identity(m);
    const n = (seen.get(id) ?? 0) + 1;

    seen.set(id, n);

    if (n > (counts.get(id) ?? 0)) {
      merged.push(m);
    }
  }

  return merged;
}
