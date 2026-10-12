// Stable action identity and durable receipts. No terms, payloads or private keys are persisted.
export type Risk = "routine" | "consequential" | "irreversible";
export interface ActionRef {
  node: string;
  actor: string;
  contract: string;
  verb: string;
  targets: readonly string[];
}
export interface SigningRequest { node: string; actor: string; term: string; phloLimit: number }
export type WriteObserver = ((status: string) => void) & {
  beforeSign?: (request: SigningRequest) => Promise<void>;
  onSigned?: (signature: string) => void;
  onSettled?: () => void;
};
export interface Receipt { action: ActionRef; signature: string; title: string; at: number }
export type ReceiptStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;
const PREFIX = "rhogov:pending-write:";
export const normalizeNode = (node: string) => node === "local" ? node : new URL(node).href.replace(/\/+$/, "");
export function actionKey(action: ActionRef): string {
  return JSON.stringify([normalizeNode(action.node), action.actor, action.contract, action.verb, action.targets]);
}

export class PendingWrite extends Error {
  constructor(public receipt: Receipt) {
    super("This action already has a submitted deploy. Check its signature before repeating it.");
  }
}
export class BusyAction extends Error { constructor() { super("This action is already in progress."); } }
export class WriteCancelled extends Error { constructor() { super("The action was cancelled before signing."); } }

export class Receipts {
  constructor(private storage: ReceiptStorage) {}
  get(action: ActionRef): Receipt | null {
    const raw = this.storage.getItem(PREFIX + actionKey(action));
    if (raw === null) return null;
    let receipt: Receipt;
    try { receipt = JSON.parse(raw); } catch { throw new Error("The pending-action record is damaged. No new deploy was sent."); }
    if (!receipt?.action || typeof receipt.signature !== "string" || !receipt.signature ||
        typeof receipt.title !== "string" || !Number.isFinite(receipt.at) || actionKey(receipt.action) !== actionKey(action))
      throw new Error("The pending-action record is damaged. No new deploy was sent.");
    return receipt;
  }
  remember(action: ActionRef, signature: string, title: string): void {
    const receipt: Receipt = { action, signature, title, at: Date.now() };
    try {
      this.storage.setItem(PREFIX + actionKey(action), JSON.stringify(receipt));
      if (this.get(action)?.signature !== signature) throw new Error("receipt was not retained");
    } catch {
      throw new Error("This browser could not save the pending action. No deploy was sent. Allow site storage before trying again.");
    }
  }
  forget(action: ActionRef): void { this.storage.removeItem(PREFIX + actionKey(action)); }
  list(): Receipt[] {
    const found: Receipt[] = [];
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      try {
        const raw = JSON.parse(this.storage.getItem(key) ?? "null");
        if (raw?.action) { const r = this.get(raw.action); if (r) found.push(r); }
      } catch { /* a damaged record is refused by get(), not treated as safe to repeat */ }
    }
    return found.sort((a, b) => a.at - b.at);
  }
}

export class ActionLocks {
  private active = new Set<string>();
  constructor(private receipts: Receipts) {}
  acquire(action: ActionRef, resume?: string): () => void {
    const key = actionKey(action);
    if (this.active.has(key)) throw new BusyAction();
    const pending = this.receipts.get(action);
    if (pending && pending.signature !== resume) throw new PendingWrite(pending);
    this.active.add(key);
    return () => { this.active.delete(key); };
  }
  has(action: ActionRef): boolean { return this.active.has(actionKey(action)); }
}

export function assertSigningContext(action: ActionRef, request: SigningRequest): void {
  if (normalizeNode(action.node) !== normalizeNode(request.node) || action.actor !== request.actor)
    throw new Error("The signing account or network changed. No deploy was sent; review the action again.");
}
