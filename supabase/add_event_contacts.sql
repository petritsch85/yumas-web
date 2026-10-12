-- A CRM for the people who book large events.
--
-- The group does a great deal of event business and keeps no record of who it
-- came from. Forty-nine companies have been invoiced for events this year and
-- eight of them have a contact name against them; the enquiries that never
-- converted are not written down anywhere at all. Those are the valuable ones,
-- because a Christmas party that fell through in 2024 is a Christmas party to
-- ask about in 2026.
--
-- Two tables, deliberately. Contacts are what a person has agreed is true.
-- Candidates are what a model read out of an email thread and nobody has
-- checked yet. Mixing them would mean a list nobody trusts, which is worse
-- than no list — so a candidate has to be accepted before it becomes a
-- contact, exactly as an incoming bill waits in "Newly Received".

create table if not exists event_contacts (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  person        text,
  company       text,
  email         text,
  phone         text,
  role          text,

  -- What the dealings were. The point of the whole list.
  comment       text,

  -- 'won' we catered it · 'lost' it went elsewhere · 'no_reply' they went quiet
  -- · 'enquiry' still open. Null until somebody says.
  status        text,
  -- Largest party discussed, which is how this list earns its keep: under
  -- thirty is a table booking, over thirty is an event.
  party_size    int,
  last_contact  date,
  -- 'invoice' seeded from what we billed · 'email' found in the mailbox
  -- · 'manual' typed in by hand.
  source        text not null default 'manual',
  -- The Gmail thread it came from, so the original is one click away.
  thread_id     text
);

-- An address identifies a person; two rows for one address is the same person
-- twice. Contacts without an address are allowed and simply not deduplicated.
create unique index if not exists event_contacts_email
  on event_contacts (lower(email)) where email is not null;

create index if not exists event_contacts_company on event_contacts (lower(company));

-- What the sweep found and nobody has looked at yet.
create table if not exists event_contact_candidates (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),

  thread_id     text not null,
  subject       text,
  thread_date   date,

  person        text,
  company       text,
  email         text,
  phone         text,
  role          text,
  comment       text,
  status        text,
  party_size    int,

  -- What the model thought of its own reading, 0–1, and why it is here.
  confidence    numeric,
  evidence      text,

  -- 'pending' waiting · 'accepted' now a contact · 'rejected' not an event
  review        text not null default 'pending',
  contact_id    uuid references event_contacts (id) on delete set null
);

-- One candidate per thread: a sweep run twice must not double the queue.
create unique index if not exists event_contact_candidates_thread
  on event_contact_candidates (thread_id);

create index if not exists event_contact_candidates_review
  on event_contact_candidates (review);

-- Which threads have been read already, so a second sweep is cheap and does
-- not pay the model again for an email it has already decided about. Kept
-- separate from the candidates because most threads produce none.
create table if not exists event_sweep_seen (
  thread_id   text primary key,
  seen_at     timestamptz not null default now(),
  -- Why nothing came of it, for when the filter needs tuning.
  outcome     text
);

alter table event_contacts           enable row level security;
alter table event_contact_candidates enable row level security;
alter table event_sweep_seen         enable row level security;

drop policy if exists event_contacts_all on event_contacts;
create policy event_contacts_all on event_contacts
  for all to authenticated using (true) with check (true);

drop policy if exists event_contact_candidates_all on event_contact_candidates;
create policy event_contact_candidates_all on event_contact_candidates
  for all to authenticated using (true) with check (true);

drop policy if exists event_sweep_seen_all on event_sweep_seen;
create policy event_sweep_seen_all on event_sweep_seen
  for all to authenticated using (true) with check (true);

comment on table event_contacts is
  'People who book large events. Seeded from invoices, extended from the mailbox, edited by hand.';
comment on table event_contact_candidates is
  'What the mailbox sweep proposed. Nothing reaches event_contacts without being accepted here.';
