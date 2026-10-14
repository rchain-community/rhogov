// inbox.tsx — on-chain messages. Sending is public-write; receiving consumes.
import { useEffect, useRef, useState } from "preact/hooks";
import type { InboxMessage } from "../chain/gov";
import {
  active,
  archive,
  archived,
  archiveForTransfer,
  gov,
  importArchive,
  learnNames,
  myAddr,
  setArchive,
} from "../state";
import {
  ARCHIVE_MAX_BYTES,
  exportInboxArchive,
  mergeInboxArchive,
  parseInboxArchive,
  type InboxArchive,
} from "../inbox-archive";
import { learnFrom } from "./groups";
import { checkInbox } from "./inbox-watch";
import {
  Addr,
  Info,
  Loading,
  Modal,
  PersonField,
  act,
  go,
  nameOf,
  useAsync,
} from "./kit";

export function InboxScreen() {
  const G = gov.value!;
  const me = myAddr.value!;
  const c = active.value!;

  const waiting = useAsync(
    () => G.inboxCounts(me),
    [c.inbox, me],
  );

  // Names for the recipient picker and the senders.
  useAsync(
    async () => {
      learnFrom(await G.groups());
      learnNames(
        archived(me, c).map((m) => ({
          addr: m.from,
          label: "",
        })),
      );
      return true;
    },
    [c.group, me],
  );

  const [msgs, setMsgs] = useState<InboxMessage[]>(
    () => archived(me, c),
  );
  const [composing, setComposing] = useState<{
    to?: string;
    subject?: string;
  } | null>(null);
  const [transferError, setTransferError] =
    useState("");
  const [transferNote, setTransferNote] =
    useState("");
  const [incoming, setIncoming] =
    useState<InboxArchive | null>(null);
  const [reading, setReading] =
    useState(false);

  const readToken = useRef(0);

  useEffect(() => {
    readToken.current++;

    setMsgs(archived(me, c));
    setIncoming(null);
    setReading(false);
    setTransferError("");
    setTransferNote("");

    return () => {
      readToken.current++;
    };
  }, [
    me,
    c.node,
    c.group,
    c.inbox,
    c.issue,
  ]);

  const n = Object.values(
    waiting.data ?? {},
  ).reduce(
    (x, y) => x + y,
    0,
  );

  const collect = async () => {
    const got = await act(
      "Collecting your messages",
      (t) => G.receive(t),
      {
        risk: "consequential",
        key: `receive:${c.inbox}:${me}`,
        done: "Messages collected.",
      },
    );

    if (got && got.length) {
      archive(me, c, got);
      setMsgs(archived(me, c));
    }

    checkInbox(true);
  };

  const remove = (m: InboxMessage) => {
    const next = msgs.filter(
      (x) => x !== m,
    );

    setArchive(me, c, next);
    setMsgs(next);
  };

  const exportFile = () => {
    setTransferError("");
    setTransferNote("");

    try {
      const text = exportInboxArchive(
        me,
        c,
        archiveForTransfer(me, c),
      );

      const url = URL.createObjectURL(
        new Blob(
          [text],
          {
            type: "application/json",
          },
        ),
      );

      const a =
        document.createElement("a");

      const stamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-");

      a.href = url;
      a.download =
        `rhogov-inbox-${stamp}.json`;

      document.body.append(a);
      a.click();
      a.remove();

      setTimeout(
        () => URL.revokeObjectURL(url),
        1000,
      );
    } catch (e) {
      setTransferError(
        (e as Error).message,
      );
    }
  };

  const readFile = async (
    file: File | undefined,
  ) => {
    if (!file || reading) return;

    setReading(true);
    setTransferError("");
    setTransferNote("");

    const token =
      ++readToken.current;

    try {
      if (
        file.size >
        ARCHIVE_MAX_BYTES
      ) {
        throw new Error(
          "rhogov refuses archive files larger than 20 MiB to bound parsing. Nothing was imported.",
        );
      }

      const parsed =
        parseInboxArchive(
          await file.text(),
          me,
          c,
        );

      if (
        token ===
        readToken.current
      ) {
        setIncoming(parsed);
      }
    } catch (e) {
      if (
        token ===
        readToken.current
      ) {
        setTransferError(
          (e as Error).message,
        );
      }
    } finally {
      if (
        token ===
        readToken.current
      ) {
        setReading(false);
      }
    }
  };

  const importFile = () => {
    if (!incoming) return;

    if (
      myAddr.value !== me ||
      active.value?.group !== c.group ||
      active.value?.node !== c.node
    ) {
      setIncoming(null);
      setTransferError(
        "Your address or community changed. Open the matching inbox and choose the file again.",
      );
      return;
    }

    try {
      const validated =
        parseInboxArchive(
          JSON.stringify(incoming),
          me,
          c,
        );

      const current =
        archiveForTransfer(
          me,
          c,
        );

      const merged =
        mergeInboxArchive(
          current,
          validated.messages,
        );

      try {
        importArchive(
          me,
          c,
          merged,
        );
      } catch {
        setTransferError(
          "This browser could not save the import. Browser storage may be full or unavailable; existing messages were kept.",
        );
        return;
      }

      setMsgs(merged);
      setIncoming(null);

      learnNames(
        merged.map((m) => ({
          addr: m.from,
          label: "",
        })),
      );

      setTransferNote(
        `${merged.length - current.length} messages added to this browser. Existing messages were kept.`,
      );
    } catch (e) {
      setTransferError(
        (e as Error).message,
      );
    }
  };

  return (
    <div>
      <div class="row between">
        <h1>Inbox</h1>
        <button
          class="primary"
          onClick={() =>
            setComposing({})
          }
        >
          ✎ New message
        </button>
      </div>

      <Loading a={waiting}>
        {() =>
          n > 0
            ? (
              <div
                class="callout row between"
                style={{
                  margin:
                    ".6rem 0 1rem",
                }}
              >
                <span>
                  <b>
                    {n} new
                    message
                    {n > 1
                      ? "s"
                      : ""}
                  </b>{" "}
                  waiting on
                  chain.
                </span>

                <button
                  class="primary"
                  onClick={collect}
                >
                  Collect
                </button>
              </div>
            )
            : (
              <p class="muted">
                No new messages
                on chain.
              </p>
            )
        }
      </Loading>

      <div
        class="card soft stack"
        style={{
          marginBottom:
            "1rem",
        }}
      >
        <b>
          Move your collected
          messages
        </b>

        <p class="small muted">
          Export this inbox's
          local archive, then
          import it in another
          browser with the same
          key and community. No
          deploy or fee. The file
          contains readable
          messages, not your key;
          keep it somewhere
          private. Import keeps
          existing messages and
          does not restore
          anything on chain.
          Files can be edited, so
          imported messages are
          not proof of who sent
          them. rhogov refuses
          archive files over 20
          MiB to bound parsing,
          but your browser's local
          storage quota may be
          much smaller.
        </p>

        <div class="row wrap">
          <button
            disabled={!msgs.length}
            onClick={exportFile}
          >
            Export archive
          </button>

          <label class="field">
            Import archive
            (JSON; browser storage
            limits how much can be
            saved)
            <input
              type="file"
              accept=".json,application/json"
              disabled={reading}
              onChange={(e) => {
                const input =
                  e.currentTarget;

                void readFile(
                  input.files?.[0],
                );

                input.value = "";
              }}
            />
          </label>
        </div>

        {reading && (
          <span class="small muted">
            Reading the archive…
          </span>
        )}

        {transferError &&
          !incoming && (
          <p
            role="alert"
            class="badge danger"
          >
            {transferError}
          </p>
        )}

        {transferNote && (
          <p role="status">
            {transferNote}
          </p>
        )}
      </div>

      {!msgs.length
        ? (
          <div class="card soft empty">
            Nothing here yet.
          </div>
        )
        : (
          <div class="stack">
            {[...msgs]
              .reverse()
              .sort(
                (a, b) =>
                  b.at - a.at,
              )
              .map((m) => (
                <div class="card">
                  <div class="row between">
                    <div class="row">
                      <Addr
                        addr={
                          m.from
                        }
                      />
                      <span class="muted small">
                        {m.at
                          ? new Date(
                            m.at,
                          ).toLocaleString()
                          : ""}
                      </span>
                    </div>

                    <div class="row">
                      {m.type ===
                          "invite" &&
                        m.fields
                          .gid && (
                        <button
                          class="primary small"
                          onClick={() =>
                            go(
                              `/g/${encodeURIComponent(m.fields.gid)}`,
                            )
                          }
                        >
                          Open{" "}
                          {m.fields
                            .group ||
                            "group"}
                        </button>
                      )}

                      <button
                        class="ghost small"
                        onClick={() =>
                          setComposing(
                            {
                              to: m.from,
                              subject:
                                m.fields
                                  .subject
                                  ? `Re: ${m.fields.subject.replace(/^Re: /, "")}`
                                  : "",
                            },
                          )
                        }
                      >
                        Reply
                      </button>

                      <button
                        class="ghost small"
                        aria-label="Delete"
                        onClick={() =>
                          remove(m)
                        }
                      >
                        ✕
                      </button>
                    </div>
                  </div>

                  {m.type ===
                      "invite" && (
                    <span class="badge warn">
                      Invitation
                    </span>
                  )}

                  {m.fields
                    .subject && (
                    <h3
                      style={{
                        marginTop:
                          ".5rem",
                      }}
                    >
                      {
                        m.fields
                          .subject
                      }
                    </h3>
                  )}

                  <p
                    style={{
                      whiteSpace:
                        "pre-wrap",
                      margin:
                        ".3rem 0 0",
                    }}
                  >
                    {m.fields.body}
                  </p>
                </div>
              ))}
          </div>
        )}

      <div class="section">
        <Info title="Who can read these messages">
          <p>
            Your inbox lives in
            the community's Inbox
            contract. Anyone can
            drop a message in. For
            messages collected
            from the chain, the
            sender's address is
            stamped by the
            contract from their
            key. Imported files
            are editable local
            copies and cannot
            prove a sender. Anyone
            can see <i>how many</i>{" "}
            messages you have, but
            the public read
            interface never shows
            their contents.
          </p>

          <p>
            <b>Collect</b> takes
            the messages out of
            the contract and keeps
            them in this browser —
            on chain they're gone
            afterwards, so a
            second reader can't
            take them too. Messages
            are not encrypted: they
            sit in chain state until
            collected, so don't
            send secrets.
          </p>
        </Info>
      </div>

      {composing && (
        <Compose
          initial={composing}
          onClose={() =>
            setComposing(null)
          }
        />
      )}

      {incoming && (
        <Modal
          title="Import collected messages"
          onClose={() =>
            setIncoming(null)
          }
          actions={
            <>
              <button
                onClick={() =>
                  setIncoming(
                    null,
                  )
                }
              >
                Cancel
              </button>

              <button
                class="primary"
                onClick={
                  importFile
                }
              >
                Import messages
              </button>
            </>
          }
        >
          <p>
            {incoming.messages
              .length}{" "}
            messages in this file
            for your address in{" "}
            <b>{c.name}</b>.
            Existing messages
            stay; importing the
            same archive again
            adds no extra copies.
            Identical messages
            already repeated in an
            archive remain
            repeated.
          </p>

          <p class="muted small">
            This saves a local
            copy only. It does not
            fetch, send, or restore
            messages on chain. A
            file can be edited and
            cannot verify its
            messages' senders.
          </p>

          {transferError && (
            <p
              role="alert"
              class="badge danger"
            >
              {transferError}
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}

export function Compose({
  initial,
  onClose,
}: {
  initial: {
    to?: string;
    subject?: string;
  };
  onClose: () => void;
}) {
  const G = gov.value!;

  const [to, setTo] =
    useState<string | null>(
      initial.to ?? null,
    );
  const [subject, setSubject] =
    useState(
      initial.subject ?? "",
    );
  const [body, setBody] =
    useState("");

  const ok =
    !!to && body.trim();

  return (
    <Modal
      title="New message"
      onClose={onClose}
      actions={
        <>
          <button
            onClick={onClose}
          >
            Cancel
          </button>

          <button
            class="primary"
            disabled={!ok}
            onClick={() => {
              onClose();

              act(
                `Sending to ${nameOf(to!)}`,
                (t) =>
                  G.send(
                    to!,
                    "note",
                    {
                      subject:
                        subject
                          .trim(),
                      body:
                        body
                          .trim(),
                    },
                    t,
                  ),
                {
                  risk:
                    "routine",
                  key:
                    `sendNote:${to}:${subject.trim()}`,
                  done:
                    "Delivered to their inbox.",
                },
              );
            }}
          >
            Send
          </button>
        </>
      }
    >
      <div class="stack">
        <PersonField
          label="To"
          initial={initial.to}
          onChange={setTo}
        />

        <label class="field">
          Subject
          <input
            value={subject}
            onInput={(e) =>
              setSubject(
                (
                  e.target as HTMLInputElement
                ).value,
              )
            }
          />
        </label>

        <label class="field">
          Message
          <textarea
            rows={5}
            value={body}
            onInput={(e) =>
              setBody(
                (
                  e.target as HTMLTextAreaElement
                ).value,
              )
            }
          />
        </label>

        <p class="muted small">
          Not encrypted —
          readable in chain state
          until collected.
        </p>
      </div>
    </Modal>
  );
}
