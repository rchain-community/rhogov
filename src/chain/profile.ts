// profile.ts — display names in rchain-rust's genesis master dictionary.
//
// The dictionary (rchain-rust casper/src/genesis/resources/rgov/MasterDictionary.rho,
// issue #99) roots every name in the identity that owns it: a caller may publish
// only under `<their REV address>/…`, derived on chain from the signing key. So
// `<addr>/profile/name` is a display name nobody but `addr` can set — chain-wide,
// across communities, with no admin. Its facets live at constant URIs on every
// chain built from the port (spec/GENESIS.md); on a chain without it, names fall
// back to group labels.
import { RNode, type RhoValue } from "./node";

export const MASTERDICT_RESOLVE = "rho:id:fbcb5xks6kygyyeixsuq1ahpcb6jwahpmt5s5byfwfpcmi64bpqo";
export const MASTERDICT_PUBLISH = "rho:id:3q9ax77mpszucp83yqomxe5c5161tg7u1mqfhw7b4k71j869bpiy";
export const namePath = (addr: string) => `${addr}/profile/name`;

export async function publishName(node: RNode, key: string, addr: string, name: string, onTick?: (s: string) => void): Promise<void> {
  const v = await node.deploy(`new return, deployId(\`rho:rchain:deployId\`), deployerId(\`rho:rchain:deployerId\`),
    lookup(\`rho:registry:lookup\`), ch, r in {
  lookup!(\`${MASTERDICT_PUBLISH}\`, *ch) |
  for (@f <- ch) {
    @f!("publish", [*deployerId, ${JSON.stringify(namePath(addr))}, ${JSON.stringify(name)}], *r) |
    for (@a <- r) { deployId!(a) }
  }
}`, key, { onTick });
  const a = v[0];
  if (!Array.isArray(a) || a[0] !== "published") throw new Error(`The name directory refused: ${JSON.stringify(a)}`);
}

/** Resolve many names in one read. Unknown or unpublished addresses are absent. */
export async function resolveNames(node: RNode, addrs: string[]): Promise<Record<string, string>> {
  if (!addrs.length) return {};
  const paths = addrs.map((a) => JSON.stringify(namePath(a)));
  // One resolve per path, gathered into a map in a fold so the answer is a single value.
  const term = `new return, lookup(\`rho:registry:lookup\`), ch, loop in {
  lookup!(\`${MASTERDICT_RESOLVE}\`, *ch) |
  for (@f <- ch) {
    contract loop(@ps, @acc, @_u) = {
      match ps {
        [] => { return!(acc) }
        [p ...rest] => {
          new r in { @f!("resolve", [p], *r) | for (@v <- r) { loop!(rest, acc.set(p, v), Nil) } }
        }
      }
    } |
    loop!([${paths.join(", ")}], {}, Nil)
  }
}`;
  const v = await node.explore(term);
  const m = (v[0] ?? {}) as Record<string, RhoValue>;
  const out: Record<string, string> = {};
  for (const a of addrs) {
    const n = m[namePath(a)];
    if (typeof n === "string" && n.trim()) out[a] = n.trim().slice(0, 60);
  }
  return out;
}
