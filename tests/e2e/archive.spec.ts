// #2 option 2: local file transfer. Read requests are blocked; no node is needed.
import {
  expect,
  test,
  type Browser,
  type Page,
} from "@playwright/test";
import { readFile } from "node:fs/promises";
import { APP, KEYS } from "./helpers";
import { revAddressOf } from "../../src/chain/keys";

const c = {
  name: "Archive community",
  node: "https://archive-node.invalid",
  inbox: "rho:id:archive-inbox",
  group: "rho:id:archive-group",
  issue: "rho:id:archive-issue",
};

const addr =
  revAddressOf(KEYS.Alice);

const archiveKey =
  `rhogov:inbox:${c.group}:${addr}`;

const m = {
  from: revAddressOf(KEYS.Bob),
  type: "note",
  at: 42,
  fields: {
    subject: "Tea",
    body: "سلام <script>window.archiveScriptRan = true</script>",
  },
};

const existing = {
  ...m,
  at: 43,
  fields: {
    subject: "Keep me",
    body: "Already here",
  },
};

const payload = (
  messages = [m],
) => ({
  format: "rhogov-inbox",
  version: 1,
  recipient: addr,
  community: {
    node: c.node,
    inbox: c.inbox,
    group: c.group,
    issue: c.issue,
  },
  messages,
});

const input = (page: Page) =>
  page.getByLabel(
    "Import archive (JSON; browser storage limits how much can be saved)",
  );

const upload = (
  page: Page,
  value: unknown,
) =>
  input(page).setInputFiles({
    name: "archive.json",
    mimeType:
      "application/json",
    buffer: Buffer.from(
      JSON.stringify(value),
    ),
  });

const stored = (page: Page) =>
  page.evaluate(
    (key) =>
      JSON.parse(
        localStorage.getItem(
          key,
        ) ?? "[]",
      ),
    archiveKey,
  );

async function fixture(
  browser: Browser,
  messages: unknown[],
  refuseStorage = false,
) {
  const context =
    await browser.newContext();

  await context.route(
    "https://**/*",
    (route) => route.abort(),
  );

  await context.addInitScript(
    ({
      key,
      c,
      archiveKey,
      messages,
      refuseStorage,
    }) => {
      if (
        location.protocol ===
        "about:"
      ) {
        return;
      }

      if (
        sessionStorage.getItem(
          "archive-fixture-seeded",
        )
      ) {
        return;
      }

      sessionStorage.setItem(
        "archive-fixture-seeded",
        "1",
      );

      const put = (
        k: string,
        value: unknown,
      ) =>
        localStorage.setItem(
          k,
          JSON.stringify(value),
        );

      put("rhogov:key", key);
      put("rhogov:name", "");
      put(
        "rhogov:communities",
        [c],
      );
      put(
        "rhogov:active",
        c.group,
      );

      if (
        localStorage.getItem(
          archiveKey,
        ) === null
      ) {
        put(
          archiveKey,
          messages,
        );
      }

      if (refuseStorage) {
        const original =
          Storage.prototype
            .setItem;

        Storage.prototype.setItem =
          function (
            k,
            value,
          ) {
            if (
              k === archiveKey
            ) {
              throw new DOMException(
                "Full",
                "QuotaExceededError",
              );
            }

            return original.call(
              this,
              k,
              value,
            );
          };
      }
    },
    {
      key: KEYS.Alice,
      c,
      archiveKey,
      messages,
      refuseStorage,
    },
  );

  const page =
    await context.newPage();

  const deploys: string[] =
    [];

  page.on(
    "request",
    (request) => {
      if (
        request
          .url()
          .includes(
            "/api/deploy",
          )
      ) {
        deploys.push(
          request.url(),
        );
      }
    },
  );

  await page.goto(
    APP + "#/inbox",
  );

  await expect(
    page.getByRole(
      "heading",
      {
        name: "Inbox",
        exact: true,
      },
    ),
  ).toBeVisible();

  return {
    page,
    context,
    deploys,
  };
}

test(
  "collected messages move between browsers, merge, persist, and do not deploy",
  async ({ browser }) => {
    const source =
      await fixture(
        browser,
        [m, m],
      );

    const target =
      await fixture(
        browser,
        [existing],
      );

    try {
      const downloading =
        source.page.waitForEvent(
          "download",
        );

      await source.page
        .getByRole(
          "button",
          {
            name:
              "Export archive",
          },
        )
        .click();

      const download =
        await downloading;

      expect(
        download.suggestedFilename(),
      ).toMatch(
        /^rhogov-inbox-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/,
      );

      const path =
        (await download.path())!;

      const file =
        JSON.parse(
          await readFile(
            path,
            "utf8",
          ),
        );

      expect(
        file.messages,
      ).toEqual([m, m]);

      expect(
        Object.keys(
          file,
        ).sort(),
      ).toEqual([
        "community",
        "format",
        "messages",
        "recipient",
        "version",
      ]);

      expect(
        JSON.stringify(file),
      ).not.toContain(
        KEYS.Alice,
      );

      expect(
        await stored(
          source.page,
        ),
      ).toEqual([m, m]);

      await input(
        target.page,
      ).setInputFiles(path);

      await expect(
        target.page.getByRole(
          "dialog",
        ),
      ).toContainText(
        "2 messages",
      );

      await target.page
        .getByRole(
          "button",
          {
            name: "Cancel",
            exact: true,
          },
        )
        .click();

      expect(
        await stored(
          target.page,
        ),
      ).toEqual(
        [existing],
      );

      await input(
        target.page,
      ).setInputFiles(path);

      await target.page
        .getByRole(
          "button",
          {
            name:
              "Import messages",
            exact: true,
          },
        )
        .click();

      await expect(
        target.page.getByRole(
          "status",
        ),
      ).toContainText(
        "2 messages added",
      );

      expect(
        await stored(
          target.page,
        ),
      ).toEqual([
        existing,
        m,
        m,
      ]);

      expect(
        await target.page
          .locator(
            ".card h3",
          )
          .allTextContents(),
      ).toEqual([
        "Keep me",
        "Tea",
        "Tea",
      ]);

      expect(
        await target.page.evaluate(
          () =>
            (window as any)
              .archiveScriptRan,
        ),
      ).toBeUndefined();

      await target.page.reload();

      expect(
        await stored(
          target.page,
        ),
      ).toEqual([
        existing,
        m,
        m,
      ]);

      await input(
        target.page,
      ).setInputFiles(path);

      await target.page
        .getByRole(
          "button",
          {
            name:
              "Import messages",
            exact: true,
          },
        )
        .click();

      await expect(
        target.page.getByRole(
          "status",
        ),
      ).toContainText(
        "0 messages added",
      );

      expect(
        await stored(
          target.page,
        ),
      ).toEqual([
        existing,
        m,
        m,
      ]);

      expect(
        source.deploys,
      ).toEqual([]);

      expect(
        target.deploys,
      ).toEqual([]);
    } finally {
      await source.context
        .close();

      await target.context
        .close();
    }
  },
);

test(
  "invalid and mismatched files leave the local archive unchanged",
  async ({ browser }) => {
    const target =
      await fixture(
        browser,
        [existing],
      );

    try {
      for (
        const value of [
          {
            ...payload(),
            recipient:
              "another",
          },
          {
            ...payload(),
            community: {
              ...payload()
                .community,
              node:
                "https://other.invalid",
            },
          },
          {
            ...payload(),
            community: {
              ...payload()
                .community,
              group:
                "rho:id:other",
            },
          },
          {
            ...payload(),
            messages: [
              m,
              null,
            ],
          },
        ]
      ) {
        await upload(
          target.page,
          value,
        );

        await expect(
          target.page
            .getByRole(
              "alert",
            )
            .filter({
              hasText:
                "Nothing was imported",
            })
            .or(
              target.page
                .getByRole(
                  "alert",
                )
                .filter({
                  hasText:
                    "nothing was imported",
                }),
            ),
        ).toBeVisible();

        await expect(
          target.page.getByRole(
            "dialog",
          ),
        ).toHaveCount(0);

        expect(
          await stored(
            target.page,
          ),
        ).toEqual(
          [existing],
        );
      }

      expect(
        target.deploys,
      ).toEqual([]);
    } finally {
      await target.context
        .close();
    }
  },
);

test(
  "an archive from a newer rhogov asks the user to update",
  async ({ browser }) => {
    const target =
      await fixture(
        browser,
        [existing],
      );

    try {
      await upload(
        target.page,
        {
          ...payload(),
          version: 2,
        },
      );

      await expect(
        target.page.getByRole(
          "alert",
        ),
      ).toContainText(
        "created by a newer rhogov",
      );

      await expect(
        target.page.getByRole(
          "alert",
        ),
      ).toContainText(
        "Update rhogov",
      );

      await expect(
        target.page.getByRole(
          "dialog",
        ),
      ).toHaveCount(0);

      expect(
        await stored(
          target.page,
        ),
      ).toEqual(
        [existing],
      );

      expect(
        target.deploys,
      ).toEqual([]);
    } finally {
      await target.context
        .close();
    }
  },
);

test(
  "a refused storage write is reported in the import dialog",
  async ({ browser }) => {
    const target =
      await fixture(
        browser,
        [existing],
        true,
      );

    try {
      await upload(
        target.page,
        payload(),
      );

      await target.page
        .getByRole(
          "button",
          {
            name:
              "Import messages",
            exact: true,
          },
        )
        .click();

      await expect(
        target.page
          .getByRole(
            "dialog",
          )
          .getByRole(
            "alert",
          ),
      ).toContainText(
        "could not save the import",
      );

      await expect(
        target.page
          .getByRole(
            "dialog",
          )
          .getByRole(
            "alert",
          ),
      ).toContainText(
        "Browser storage may be full or unavailable",
      );

      expect(
        await stored(
          target.page,
        ),
      ).toEqual(
        [existing],
      );

      await expect(
        target.page.getByRole(
          "status",
        ),
      ).toHaveCount(0);

      expect(
        target.deploys,
      ).toEqual([]);
    } finally {
      await target.context
        .close();
    }
  },
);

test(
  "a damaged stored archive is not overwritten by an import",
  async ({ browser }) => {
    const target =
      await fixture(
        browser,
        [existing],
      );

    try {
      await target.page
        .evaluate(
          (key) =>
            localStorage.setItem(
              key,
              "{",
            ),
          archiveKey,
        );

      await target.page
        .getByRole(
          "button",
          {
            name:
              "Export archive",
          },
        )
        .click();

      await expect(
        target.page.getByRole(
          "alert",
        ),
      ).toContainText(
        "stored archive is damaged",
      );

      await upload(
        target.page,
        payload(),
      );

      await target.page
        .getByRole(
          "button",
          {
            name:
              "Import messages",
            exact: true,
          },
        )
        .click();

      await expect(
        target.page
          .getByRole(
            "dialog",
          )
          .getByRole(
            "alert",
          ),
      ).toContainText(
        "stored archive is damaged",
      );

      expect(
        await target.page
          .evaluate(
            (key) =>
              localStorage
                .getItem(key),
            archiveKey,
          ),
      ).toBe("{");

      expect(
        target.deploys,
      ).toEqual([]);
    } finally {
      await target.context
        .close();
    }
  },
);
