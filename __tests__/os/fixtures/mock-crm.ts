// In-memory Kit (v4) and GoHighLevel (v2) behind a fetch stub, for the field
// sync tests. Only the endpoints the sync uses; anything else is a 404 and is
// recorded, so a test can assert it was never called (unsubscribe, delete).
import { vi } from "vitest";

export type CrmCall = { method: string; path: string; body: unknown };

type KitSub = { id: number; email_address: string; first_name: string | null; fields: Record<string, string | null>; state: string };
type GhlContact = { id: string; email: string | null; phone: string | null; firstName: string | null; name: string | null; customFields: Record<string, string>; tags: Set<string> };

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v ?? {}), { status, headers: { "Content-Type": "application/json" } });

export class MockKit {
  subs = new Map<number, KitSub>();
  tags = new Map<number, string>();
  tagged = new Set<string>();
  private nextId = 100;

  addSubscriber(email: string, over: Partial<KitSub> = {}): KitSub {
    const s: KitSub = { id: this.nextId++, email_address: email.toLowerCase(), first_name: null, fields: {}, state: "active", ...over };
    this.subs.set(s.id, s);
    return s;
  }
  byEmail(email: string) {
    return [...this.subs.values()].find((s) => s.email_address === email.toLowerCase()) ?? null;
  }
  tagsOf(id: number) {
    return [...this.tagged].filter((k) => k.endsWith(`:${id}`)).map((k) => this.tags.get(Number(k.split(":")[0]))!).sort();
  }

  handle(method: string, url: URL, body: Record<string, unknown> | undefined): Response | null {
    if (url.hostname !== "api.kit.com") return null;
    const p = url.pathname.replace(/^\/v4/, "");
    let m: RegExpMatchArray | null;
    if (method === "GET" && p === "/subscribers") {
      const e = url.searchParams.get("email_address");
      const s = e ? this.byEmail(e) : null;
      return json({ subscribers: s ? [s] : [] });
    }
    if ((m = p.match(/^\/subscribers\/(\d+)$/))) {
      const s = this.subs.get(Number(m[1]));
      if (!s) return json({ errors: ["Not Found"] }, 404);
      if (method === "GET") return json({ subscriber: s });
      if (method === "PUT") {
        const email = typeof body?.email_address === "string" ? body.email_address.toLowerCase() : null;
        if (email && email !== s.email_address && this.byEmail(email)) return json({ errors: ["Email address already taken"] }, 422);
        if (email) s.email_address = email;
        if (typeof body?.first_name === "string") s.first_name = body.first_name;
        if (body?.fields) Object.assign(s.fields, body.fields);
        return json({ subscriber: s });
      }
    }
    if (method === "POST" && p === "/subscribers") {
      // Kit upserts on email and overwrites the fields it's given.
      const email = String(body?.email_address).toLowerCase();
      const s = this.byEmail(email) ?? this.addSubscriber(email);
      if (typeof body?.first_name === "string") s.first_name = body.first_name;
      if (body?.fields) Object.assign(s.fields, body.fields);
      return json({ subscriber: s }, 201);
    }
    if (method === "GET" && p === "/tags") return json({ tags: [...this.tags].map(([id, name]) => ({ id, name })) });
    if (method === "POST" && p === "/tags") {
      const id = this.nextId++;
      this.tags.set(id, String(body?.name));
      return json({ tag: { id, name: body?.name } }, 201);
    }
    if ((m = p.match(/^\/tags\/(\d+)\/subscribers\/(\d+)$/))) {
      const key = `${m[1]}:${m[2]}`;
      if (!this.tags.has(Number(m[1])) || !this.subs.has(Number(m[2]))) return json({}, 404);
      if (method === "POST") this.tagged.add(key);
      if (method === "DELETE") {
        if (!this.tagged.delete(key)) return json({}, 404);
        return new Response(null, { status: 204 });
      }
      return json({ subscriber: this.subs.get(Number(m[2])) });
    }
    return json({ errors: ["Not Found"] }, 404);
  }
}

export class MockGhl {
  contacts = new Map<string, GhlContact>();
  /** fieldKey ("contact.dm_stage") -> id */
  fieldKeys = new Map<string, string>([["contact.dm_stage", "fStage"]]);
  opportunities: unknown[] = [];
  private nextId = 1;

  addContact(over: Partial<Omit<GhlContact, "tags">> & { tags?: string[] } = {}): GhlContact {
    const c: GhlContact = { id: `g${this.nextId++}`, email: null, phone: null, firstName: null, name: null, customFields: {}, ...over, tags: new Set(over.tags ?? []) };
    this.contacts.set(c.id, c);
    return c;
  }
  private view(c: GhlContact) {
    return { ...c, tags: [...c.tags], customFields: Object.entries(c.customFields).map(([id, value]) => ({ id, value })) };
  }
  private applyFields(c: GhlContact, fields: unknown) {
    for (const f of (fields as { id?: string; key?: string; field_value: string }[] | undefined) ?? []) {
      const id = f.id ?? (f.key ? this.fieldKeys.get(f.key) : undefined);
      if (id) c.customFields[id] = f.field_value;
    }
  }

  handle(method: string, url: URL, body: Record<string, unknown> | undefined): Response | null {
    if (url.hostname !== "services.leadconnectorhq.com") return null;
    const p = url.pathname;
    let m: RegExpMatchArray | null;
    if (method === "GET" && p === "/contacts/search/duplicate") {
      const email = url.searchParams.get("email")?.toLowerCase();
      const number = url.searchParams.get("number");
      const c = [...this.contacts.values()].find((x) => (email && x.email === email) || (number && x.phone === number));
      return json({ contact: c ? this.view(c) : null });
    }
    if (method === "POST" && p === "/contacts/") {
      const c = this.addContact({
        email: typeof body?.email === "string" ? body.email.toLowerCase() : null,
        phone: (body?.phone as string) ?? null,
        firstName: (body?.firstName as string) ?? null,
        name: (body?.name as string) ?? null,
      });
      this.applyFields(c, body?.customFields);
      return json({ contact: this.view(c) }, 201);
    }
    if ((m = p.match(/^\/contacts\/([^/]+)\/tags$/))) {
      const c = this.contacts.get(m[1]);
      if (!c) return json({}, 404);
      for (const t of (body?.tags as string[]) ?? []) method === "POST" ? c.tags.add(t) : c.tags.delete(t);
      return json({ tags: [...c.tags] });
    }
    if ((m = p.match(/^\/contacts\/([^/]+)$/))) {
      const c = this.contacts.get(m[1]);
      if (!c) return json({ message: "Contact not found" }, 404);
      if (method === "GET") return json({ contact: this.view(c) });
      if (method === "PUT") {
        if (typeof body?.email === "string") c.email = body.email.toLowerCase();
        if (typeof body?.phone === "string") c.phone = body.phone;
        if (typeof body?.firstName === "string") c.firstName = body.firstName;
        this.applyFields(c, body?.customFields);
        return json({ contact: this.view(c) });
      }
    }
    if (method === "GET" && /^\/locations\/[^/]+\/customFields$/.test(p)) {
      return json({ customFields: [...this.fieldKeys].map(([fieldKey, id]) => ({ id, name: fieldKey, fieldKey, model: "contact" })) });
    }
    if (method === "POST" && p === "/opportunities/upsert") {
      this.opportunities.push(body);
      return json({ new: true });
    }
    return json({ message: "Not Found" }, 404);
  }
}

/** Stub fetch with both CRMs. `fail` makes the next n calls answer `status`. */
export function stubCrms(kit = new MockKit(), ghl = new MockGhl()) {
  const calls: CrmCall[] = [];
  const outage = { left: 0, status: 503 };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
      calls.push({ method, path: url.pathname + url.search, body });
      if (outage.left > 0) {
        outage.left--;
        return json({ message: "down" }, outage.status);
      }
      return kit.handle(method, url, body) ?? ghl.handle(method, url, body) ?? json({}, 404);
    })
  );
  return {
    kit,
    ghl,
    calls,
    fail(n: number, status = 503) {
      outage.left = n;
      outage.status = status;
    },
    reset() {
      calls.length = 0;
    },
  };
}
