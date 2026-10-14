import {
  ARCHIVE_MAX_BYTES,
  exportInboxArchive,
  mergeInboxArchive,
  parseInboxArchive,
} from "../src/inbox-archive";
import {
  archived,
  archiveForTransfer,
  importArchive,
} from "../src/state";

// unit.ts — offline checks (no node): decoding, keys, council arithmetic.
import {
  approvalShare,
  approvals,
  chamberPower,
  combine,
  decodeArg,
  encodeArg,
  estimateBallot,
  parseEstimate,
} from "../src/chain/council";
import {
  readRecord,
  toGroup,
} from "../src/chain/gov";
import {
  addCommunity,
  addressBook,
  learnNames,
  nameNotes,
  setActive,
} from "../src/state";
import {
  filterPeople,
  looksLike,
  nameError,
  resolvePerson,
  suggestNames,
} from "../src/chain/people";
import {
  revAddressOf,
} from "../src/chain/keys";
import {
  decode,
} from "../src/chain/node";

let pass = 0;
let fail = 0;

const ok = (
  label: string,
  cond: boolean,
  got?: unknown,
) => {
  if (cond) pass++;
  else fail++;

  console.log(
    `${cond ? "  ok  " : "  FAIL"} ${label}${cond ? "" : `  got ${JSON.stringify(got)}`}`,
  );
};

const eq = (
  a: unknown,
  b: unknown,
) =>
  JSON.stringify(a) ===
  JSON.stringify(b);

// RhoExpr.
ok(
  "decode envelope int",
  decode({
    ExprInt: {
      data: 42,
    },
  }) === 42,
);

ok(
  "decode bare int",
  decode({
    ExprInt: 42,
  }) === 42,
);

ok(
  "decode envelope map",
  eq(
    decode({
      ExprMap: {
        data: {
          a: {
            ExprString: {
              data: "x",
            },
          },
        },
      },
    }),
    {
      a: "x",
    },
  ),
);

ok(
  "decode bare map as pairs",
  eq(
    decode({
      ExprMap: [
        [
          "a",
          {
            ExprInt: 1,
          },
        ],
      ],
    }),
    {
      a: 1,
    },
  ),
);

ok(
  "decode tuple → array",
  eq(
    decode({
      ExprTuple: {
        data: [
          {
            ExprBool: {
              data: true,
            },
          },
          {
            ExprString: {
              data: "s",
            },
          },
        ],
      },
    }),
    [
      true,
      "s",
    ],
  ),
);

ok(
  "decode unforgeable",
  eq(
    decode({
      ExprUnforg: {
        data: {
          UnforgPrivate: {
            data: "ab",
          },
        },
      },
    }),
    {
      unforgeable:
        "UnforgPrivate",
      hex: "ab",
    },
  ),
);

// The REV address derivation matches quantum-os localnet wallet.txt for alice.
ok(
  "rev address of alice",
  revAddressOf(
    "0b60b3ffcc43a607e037c3da3c1ed366261d742288abdf92d53cf80b9e3cf98f",
  ) ===
    "1111bn92xHbttqWHEXqD8PiykFxgeUjizzquT6JRePj2pAoHFAuiK",
);

// Group decoding.
const g = toGroup(
  "g",
  {
    name: "G",
    policy: "invite",
    admins: {
      a: true,
    },
    members: {
      a: {
        role: "admin",
        label: "G",
      },
      b: {
        role: "member",
        label: "Bee",
      },
    },
    invited: {
      c: true,
    },
    deleg: {
      b: "a",
    },
    topic: {},
    ratings: {
      a: {
        b: 3,
      },
    },
    censures: {
      a: {
        b: true,
      },
    },
  },
)!;

ok(
  "toGroup",
  g.policy === "invite" &&
    g.members.length === 2 &&
    eq(
      g.invited,
      ["c"],
    ) &&
    eq(
      g.censures,
      {
        a: ["b"],
      },
    ) &&
    g.ratings.a.b === 3,
  g,
);

// Estimates and median.
ok(
  "estimate round trip",
  eq(
    parseEstimate(
      estimateBallot({
        "c.dev": 30,
        "c.val": 70,
      }),
    ),
    {
      "c.dev": 30,
      "c.val": 70,
    },
  ),
);

ok(
  "malformed estimate entries ignored",
  eq(
    parseEstimate([
      "x=1",
      "junk",
      "y=-3",
      "z=abc",
    ]),
    {
      x: 1,
    },
  ),
);

const issue = (
  ballots: Record<
    string,
    string[]
  >,
) =>
  ({
    ballots,
  }) as any;

let p = chamberPower(
  ["a", "b"],
  null,
);

ok(
  "no estimates → equal power",
  p.share.a === 0.5 &&
    p.share.b === 0.5 &&
    p.estimators === 0,
  p,
);

p = chamberPower(
  ["a", "b", "c"],
  issue({
    v1: [
      "a=60",
      "b=20",
      "c=20",
    ],
    v2: [
      "a=20",
      "b=60",
      "c=20",
    ],
    v3: [
      "a=1",
      "b=1",
      "c=8",
    ],
  }),
);

ok(
  "median resists one extreme estimate",
  Math.abs(
    p.share.c - 1 / 3,
  ) < 1e-9 &&
    p.estimators === 3,
  p,
);

p = chamberPower(
  ["a", "b"],
  issue({
    v1: [
      "a=3",
      "b=1",
    ],
  }),
);

ok(
  "only proportions matter",
  p.share.a === 0.75,
  p,
);

// Combination across stakeholder groups.
const out = (
  weights: Record<
    string,
    number
  >,
  ballots: Record<
    string,
    string[]
  >,
) => ({
  weights,
  ballots,
  levels: {},
  discredited: [],
  trustActive: false,
  winner: null,
  mode: "approval",
});

const sA = approvalShare(
  ["x", "y"],
  out(
    {
      v1: 3,
      v2: 1,
    },
    {
      v1: ["x"],
      v2: ["y"],
    },
  ),
);

ok(
  "weighted approval share",
  sA.x === 0.75 &&
    sA.y === 0.25,
  sA,
);

const sB = approvalShare(
  ["x", "y"],
  out(
    {
      v3: 1,
    },
    {
      v3: [
        "y",
        "y",
      ],
    },
  ),
);

ok(
  "duplicate approvals count once",
  sB.y === 1,
  sB,
);

const groups = [
  {
    chamber: {
      id: "A",
    },
    share: sA,
  },
  {
    chamber: {
      id: "B",
    },
    share: sB,
  },
  {
    chamber: {
      id: "C",
    },
    share: {
      x: 0,
      y: 0,
    },
  },
] as any;

const combined = combine(
  ["x", "y"],
  groups,
  {
    share: {
      A: 0.5,
      B: 0.3,
      C: 0.2,
    },
    median: {},
    estimators: 0,
  },
);

ok(
  "Σ power × share",
  Math.abs(
    combined.score.x -
      0.375,
  ) < 1e-9 &&
    Math.abs(
      combined.score.y -
        0.425,
    ) < 1e-9 &&
    combined.winner === "y",
  combined,
);

const tie = combine(
  ["x", "y"],
  [
    {
      chamber: {
        id: "A",
      },
      share: {
        x: 0.5,
        y: 0.5,
      },
    },
  ] as any,
  {
    share: {
      A: 1,
    },
    median: {},
    estimators: 0,
  },
);

ok(
  "a tie names no winner",
  tie.winner === null &&
    eq(
      tie.tie.sort(),
      ["x", "y"],
    ),
  tie,
);

ok(
  "vote counts: one per person per option, unknown options ignored",
  eq(
    approvals(
      ["x", "y", "z"],
      {
        a: [
          "x",
          "y",
        ],
        b: [
          "x",
          "x",
        ],
        c: ["w"],
      },
    ),
    {
      x: 2,
      y: 1,
      z: 0,
    },
  ),
);

// Choosing a person.
{
  const A =
    "1111bn92xHbttqWHEXqD8PiykFxgeUjizzquT6JRePj2pAoHFAuiK";
  const B =
    "1111pJu4TJaJDNJDTinnftr2fcHvMfnDeTRXRzwgPfwuKmGMa5juj";
  const C =
    "1111gW5kkGxHg7xDg6dRkZx2f7qxTizJzaCH9VEM1oJKWRvSX9Sk5";

  const people: Record<
    string,
    string
  > = {
    [A]: "Aria",
    [B]: "Jim",
    [C]: "jim",
  };

  const r1 =
    resolvePerson(
      " Aria ",
      people,
    );

  ok(
    "a name resolves, ignoring surrounding space",
    r1.ok &&
      r1.addr === A,
  );

  ok(
    "capitals count: Jim and jim are two people",
    (() => {
      const x =
        resolvePerson(
          "Jim",
          people,
        );

      const y =
        resolvePerson(
          "jim",
          people,
        );

      return (
        x.ok &&
        y.ok &&
        x.addr === B &&
        y.addr === C
      );
    })(),
  );

  ok(
    "a name in the wrong case is not someone else's",
    !resolvePerson(
      "aria",
      people,
    ).ok,
  );

  const r2 =
    resolvePerson(
      B,
      people,
    );

  ok(
    "an address is taken as typed",
    r2.ok &&
      r2.addr === B &&
      r2.name === "Jim",
  );

  const r5 =
    resolvePerson(
      "Zed",
      people,
    );

  ok(
    "an unknown name is refused",
    !r5.ok &&
      r5.why ===
        "unknown",
  );

  const r6 =
    resolvePerson(
      "1111bn92xHbttqWHEX",
      people,
    );

  ok(
    "text starting with a digit is an address, and a cut-short one is called out",
    !r6.ok &&
      r6.why ===
        "bad-address",
  );

  ok(
    "names that start with what's typed are offered",
    eq(
      suggestNames(
        "J",
        [
          "Jim",
          "jim",
          "Jo",
          "Aria",
        ],
      ),
      [
        "Jim",
        "Jo",
        "jim",
      ],
    ),
  );

  ok(
    "…none once it reads as an address",
    eq(
      suggestNames(
        "11",
        [
          "11 is not a name",
        ],
      ),
      [],
    ),
  );

  const nm = (
    a: string,
  ) => people[a];

  ok(
    "filtering people: names starting with what's typed, exact capitals first",
    eq(
      filterPeople(
        "j",
        [A, B, C],
        nm,
      ),
      [C, B],
    ),
  );

  ok(
    "…an empty filter keeps everyone; digits filter by address",
    eq(
      filterPeople(
        "",
        [A, B],
        nm,
      ),
      [A, B],
    ) &&
      eq(
        filterPeople(
          "1111pJ",
          [A, B, C],
          nm,
        ),
        [B],
      ),
  );

  ok(
    "look-alikes are one name: Greek α, Cyrillic а, fullwidth, zero-width",
    looksLike(
      "Ada",
      "Adα",
    ) &&
      looksLike(
        "Ada",
        "Аda",
      ) &&
      looksLike(
        "Ada",
        "Ａｄａ",
      ) &&
      looksLike(
        "Ada",
        "Ad\u200Ba",
      ),
  );

  ok(
    "…and shapes that coincide: l/I/1, O/0, rn/m",
    looksLike(
      "Ian",
      "lan",
    ) &&
      looksLike(
        "B0b",
        "BOb",
      ) &&
      looksLike(
        "Kim",
        "Kirn",
      ),
  );

  ok(
    "capitals still count where shapes differ",
    !looksLike(
      "Jim",
      "jim",
    ) &&
      !looksLike(
        "Ada",
        "ada",
      ),
  );

  ok(
    "mixed alphabets and invisible characters are refused",
    nameError(
      "Adα",
    ) !== "" &&
      nameError(
        "Ad\u200Ba",
      ) !== "" &&
      nameError(
        "Αδα",
      ) === "" &&
      nameError(
        "Анна",
      ) === "",
  );

  ok(
    "a name can't start with a digit",
    nameError(
      "1st",
    ) !== "" &&
      nameError(
        "Ada",
      ) === "" &&
      nameError(
        "  ",
      ) !== "",
  );
}

// Names belong to one community.
{
  const A = {
    name: "A",
    node: "http://n",
    inbox: "rho:id:a1",
    group: "rho:id:a2",
    issue: "rho:id:a3",
  };

  const B = {
    name: "B",
    node: "http://n",
    inbox: "rho:id:b1",
    group: "rho:id:b2",
    issue: "rho:id:b3",
  };

  addCommunity(A);
  addCommunity(B);
  setActive(A.group);

  learnNames([
    {
      addr: "1111T",
      label: "Treasurer",
    },
    {
      addr: "1111U",
      label: "Ada",
    },
    {
      addr: "1111V",
      label: "Adα",
    },
  ]);

  ok(
    "look-alike labels are numbered, neither shown as the owner",
    addressBook.value[
      "1111U"
    ] ===
      "Ada (1)" &&
      addressBook.value[
        "1111V"
      ] ===
        "Adα (2)" &&
      !!nameNotes.value[
        "1111U"
      ],
  );

  ok(
    "a label shows in the community that gave it",
    addressBook.value[
      "1111T"
    ] ===
      "Treasurer",
  );

  setActive(B.group);
  learnNames([]);

  ok(
    "…and not in another community",
    addressBook.value[
      "1111T"
    ] ===
      undefined,
  );

  setActive(null);
}

// Arguments.
ok(
  "argument round trip keeps pipes in text",
  eq(
    decodeArg(
      encodeArg(
        "con",
        "2s",
        "a | b",
      ),
    ),
    {
      raw: "con|2s|a | b",
      side: "con",
      option: "2s",
      text: "a | b",
    },
  ),
);

ok(
  "non-argument rejected",
  decodeArg(
    "hello",
  ) === null,
);

// Recorded results.
{
  const frozen =
    readRecord({
      winner: "Alpha",
      weight: 7,
      ballots: 3,
    });

  ok(
    "a frozen record gives back what it was taken over",
    frozen.winner ===
      "Alpha" &&
      frozen.weight === 7 &&
      frozen.ballots === 3 &&
      frozen.frozen,
  );

  ok(
    "a frozen record with no winner reads as no winner",
    readRecord({
      winner: null,
    }).winner === null,
  );

  const legacy =
    readRecord("Beta");

  ok(
    "an older bare-string record still reads, and is not claimed as frozen",
    legacy.winner ===
      "Beta" &&
      !legacy.frozen,
  );

  ok(
    "a value that is neither shape reads as nothing rather than guessing",
    readRecord([])
        .winner ===
      null &&
      !readRecord([])
        .frozen,
  );
}

// Local archive transfer (#2).
{
  const c = {
    name: "C",
    node:
      "https://node.example",
    inbox:
      "rho:id:inbox",
    group:
      "rho:id:group",
    issue:
      "rho:id:issue",
  };

  const m = {
    from:
      "1111bn92xHbttqWHEXqD8PiykFxgeUjizzquT6JRePj2pAoHFAuiK",
    type: "note",
    at: 42,
    fields: {
      subject:
        "Tea",
      body:
        "سلام <script>text</script>",
    },
  };

  const text =
    exportInboxArchive(
      "recipient",
      c,
      [m],
    );

  const bundle =
    JSON.parse(text);

  const rejects = (
    v: unknown,
    addr = "recipient",
    scope = c,
  ) => {
    try {
      parseInboxArchive(
        typeof v ===
            "string"
          ? v
          : JSON.stringify(
            v,
          ),
        addr,
        scope,
      );

      return false;
    } catch {
      return true;
    }
  };

  const errorOf = (
    v: unknown,
    addr = "recipient",
    scope = c,
  ) => {
    try {
      parseInboxArchive(
        typeof v ===
            "string"
          ? v
          : JSON.stringify(
            v,
          ),
        addr,
        scope,
      );

      return "";
    } catch (e) {
      return e instanceof Error
        ? e.message
        : String(e);
    }
  };

  ok(
    "archive round trip preserves Unicode and literal markup",
    eq(
      parseInboxArchive(
        text,
        "recipient",
        c,
      ).messages,
      [m],
    ),
  );

  ok(
    "empty archive round trip",
    parseInboxArchive(
      exportInboxArchive(
        "recipient",
        c,
        [],
      ),
      "recipient",
      c,
    ).messages.length === 0,
  );

  ok(
    "archive exports only format, scope and messages",
    eq(
      Object.keys(
        bundle,
      ).sort(),
      [
        "community",
        "format",
        "messages",
        "recipient",
        "version",
      ],
    ),
  );

  ok(
    "wrong recipient is refused",
    rejects(
      text,
      "another",
    ),
  );

  for (
    const k of [
      "node",
      "inbox",
      "group",
      "issue",
    ] as const
  ) {
    ok(
      `wrong archive ${k} is refused`,
      rejects(
        text,
        "recipient",
        {
          ...c,
          [k]: "other",
        },
      ),
    );
  }

  ok(
    "invalid JSON is refused",
    rejects("{"),
  );

  const newerMessage =
    errorOf({
      ...bundle,
      version: 2,
    });

  ok(
    "newer archive version says to update rhogov",
    /newer rhogov/i.test(
      newerMessage,
    ) &&
      /update rhogov/i.test(
        newerMessage,
      ),
    newerMessage,
  );

  const oldMessage =
    errorOf({
      ...bundle,
      version: 0,
    });

  ok(
    "older unsupported archive version has a distinct format error",
    /unsupported rhogov inbox format/i.test(
      oldMessage,
    ),
    oldMessage,
  );

  ok(
    "wrong archive format is refused",
    rejects({
      ...bundle,
      format: "other",
    }),
  );

  ok(
    "non-string message fields are refused",
    rejects({
      ...bundle,
      messages: [
        {
          ...m,
          fields: {
            body: {},
          },
        },
      ],
    }),
  );

  ok(
    "invalid sender addresses are refused",
    rejects({
      ...bundle,
      messages: [
        {
          ...m,
          from: "__proto__",
        },
      ],
    }),
  );

  ok(
    "negative timestamps are refused",
    rejects({
      ...bundle,
      messages: [
        {
          ...m,
          at: -1,
        },
      ],
    }),
  );

  ok(
    "fractional timestamps are refused",
    rejects({
      ...bundle,
      messages: [
        {
          ...m,
          at: 0.5,
        },
      ],
    }),
  );

  ok(
    "one invalid message rejects the whole file",
    rejects({
      ...bundle,
      messages: [
        m,
        null,
      ],
    }),
  );

  ok(
    "UTF-8 file byte limit is enforced",
    rejects(
      "😀".repeat(
        ARCHIVE_MAX_BYTES /
          4 +
          1,
      ),
    ),
  );

  const other = {
    ...m,
    at: 43,
  };

  const merged =
    mergeInboxArchive(
      [other],
      [m, m],
    );

  ok(
    "merge keeps existing messages and repeated messages from the file",
    eq(
      merged,
      [
        other,
        m,
        m,
      ],
    ),
  );

  ok(
    "reimport is idempotent",
    eq(
      mergeInboxArchive(
        merged,
        [m, m],
      ),
      merged,
    ),
  );

  ok(
    "existing duplicate count is never reduced",
    mergeInboxArchive(
      [m, m, m],
      [m],
    ).length === 3,
  );

  ok(
    "field ordering does not add a duplicate",
    mergeInboxArchive(
      [m],
      [
        {
          ...m,
          fields: {
            body:
              m.fields.body,
            subject:
              m.fields
                .subject,
          },
        },
      ],
    ).length === 1,
  );

  const proto =
    parseInboxArchive(
      JSON.stringify({
        ...bundle,
        messages: [
          {
            ...m,
            fields:
              JSON.parse(
                '{"__proto__":"literal"}',
              ),
          },
        ],
      }),
      "recipient",
      c,
    );

  ok(
    "special field names remain data",
    Object.getPrototypeOf(
      proto.messages[0]
        .fields,
    ) === null &&
      proto.messages[0]
        .fields
        .__proto__ ===
        "literal",
  );

  const descriptor =
    Object.getOwnPropertyDescriptor(
      globalThis,
      "localStorage",
    );

  const memory =
    new Map<
      string,
      string
    >();

  let refuse = false;

  Object.defineProperty(
    globalThis,
    "localStorage",
    {
      configurable: true,
      value: {
        getItem: (
          key: string,
        ) =>
          memory.get(
            key,
          ) ?? null,

        setItem: (
          key: string,
          value: string,
        ) => {
          if (refuse)
            throw new Error(
              "QuotaExceededError",
            );

          memory.set(
            key,
            value,
          );
        },
      },
    },
  );

  try {
    importArchive(
      "recipient",
      c,
      [m],
    );

    ok(
      "import persists in the current address/community only",
      eq(
        archived(
          "recipient",
          c,
        ),
        [m],
      ) &&
        archived(
          "another",
          c,
        ).length === 0 &&
        archived(
          "recipient",
          {
            ...c,
            group: "other",
          },
        ).length === 0,
    );

    ok(
      "transfer reader returns the stored archive",
      eq(
        archiveForTransfer(
          "recipient",
          c,
        ),
        [m],
      ),
    );

    const slot =
      [...memory.keys()][0];

    memory.set(
      slot,
      "{",
    );

    let invalidJSON = "";

    try {
      archiveForTransfer(
        "recipient",
        c,
      );
    } catch (e) {
      invalidJSON =
        e instanceof Error
          ? e.message
          : String(e);
    }

    ok(
      "corrupt stored JSON is refused rather than treated as empty",
      /stored archive is damaged/i.test(
        invalidJSON,
      ) &&
        /report the problem/i.test(
          invalidJSON,
        ) &&
        memory.get(slot) ===
          "{",
      invalidJSON,
    );

    memory.set(
      slot,
      "{}",
    );

    let invalidShape = "";

    try {
      archiveForTransfer(
        "recipient",
        c,
      );
    } catch (e) {
      invalidShape =
        e instanceof Error
          ? e.message
          : String(e);
    }

    ok(
      "non-array stored archive is refused and kept",
      /stored archive is damaged/i.test(
        invalidShape,
      ) &&
        memory.get(slot) ===
          "{}",
      invalidShape,
    );

    const badStored =
      JSON.stringify([
        {
          ...m,
          from: "__proto__",
        },
      ]);

    memory.set(
      slot,
      badStored,
    );

    let invalidMessage = "";

    try {
      archiveForTransfer(
        "recipient",
        c,
      );
    } catch (e) {
      invalidMessage =
        e instanceof Error
          ? e.message
          : String(e);
    }

    ok(
      "legacy or malformed stored messages are refused with recovery advice",
      /older, invalid, or oversized/i.test(
        invalidMessage,
      ) &&
        /update rhogov or report the problem/i.test(
          invalidMessage,
        ) &&
        memory.get(slot) ===
          badStored,
      invalidMessage,
    );

    memory.set(
      slot,
      JSON.stringify(
        [m],
      ),
    );

    refuse = true;

    let threw = false;

    try {
      importArchive(
        "recipient",
        c,
        [other],
      );
    } catch {
      threw = true;
    }

    ok(
      "refused storage write throws and keeps the prior archive",
      threw &&
        eq(
          archived(
            "recipient",
            c,
          ),
          [m],
        ),
    );
  } finally {
    if (descriptor) {
      Object.defineProperty(
        globalThis,
        "localStorage",
        descriptor,
      );
    } else {
      delete (
        globalThis as {
          localStorage?: Storage;
        }
      ).localStorage;
    }
  }
}

console.log(
  `unit: ${pass}/${pass + fail} passed`,
);

process.exit(
  fail ? 1 : 0,
);
