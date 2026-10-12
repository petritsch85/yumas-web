-- Every conversation with a contact, not just the latest sentence.
--
-- event_contacts.comment holds one line, which is enough to recognise someone
-- and not enough to deal with them. The same person asks about a Christmas
-- party in 2023, books a summer event in 2024 and goes quiet in 2025 — three
-- facts, and only the third is visible if a row can hold one sentence. Before
-- picking up the phone you want the sequence.
--
-- So interactions get their own table, one row per conversation, and the
-- contact keeps a denormalised copy of the most recent one so a list of two
-- hundred people can show "last spoke about…" without two hundred queries.

create table if not exists event_contact_threads (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),

  contact_id   uuid not null references event_contacts (id) on delete cascade,

  -- When the conversation happened — the date that orders the history.
  occurred_on  date not null,
  subject      text,
  -- One or two sentences: what was discussed and what came of it.
  summary      text,
  -- Same vocabulary as the contact's own status, for this conversation alone.
  outcome      text,
  party_size   int,

  -- Where it came from, so the original can be opened.
  -- 'email' a Gmail thread · 'invoice' an event we billed · 'manual' typed in.
  source       text not null default 'manual',
  thread_id    text,
  -- A note somebody added by hand afterwards: "rief an, will 2027 wieder".
  note         text
);

-- One row per Gmail thread per contact. A sweep run twice must not double the
-- history; a thread genuinely involving two contacts may appear once for each.
create unique index if not exists event_contact_threads_unique
  on event_contact_threads (contact_id, thread_id) where thread_id is not null;

create index if not exists event_contact_threads_contact
  on event_contact_threads (contact_id, occurred_on desc);

-- The most recent conversation, carried on the contact for listing.
alter table event_contacts add column if not exists last_summary text;
alter table event_contacts add column if not exists thread_count int not null default 0;

comment on column event_contacts.last_summary is
  'Summary of the most recent row in event_contact_threads. Denormalised for listing; keep in step via refresh_event_contact_history().';
comment on column event_contacts.comment is
  'A standing note about the person, written by hand. The conversation history lives in event_contact_threads.';

-- Bring a contact's summary fields back in line with its history.
create or replace function refresh_event_contact_history(c uuid)
returns void language sql as $$
  update event_contacts e
     set last_contact = h.last_on,
         last_summary = h.last_summary,
         thread_count = h.n,
         updated_at   = now()
    from (
      select contact_id,
             max(occurred_on) as last_on,
             count(*)         as n,
             (array_agg(coalesce(note, summary) order by occurred_on desc))[1] as last_summary
        from event_contact_threads
       where contact_id = c
       group by contact_id
    ) h
   where e.id = c and h.contact_id = c;
$$;

-- Keep it in step without anybody remembering to.
create or replace function event_contact_threads_sync()
returns trigger language plpgsql as $$
begin
  perform refresh_event_contact_history(coalesce(new.contact_id, old.contact_id));
  return null;
end;
$$;

drop trigger if exists event_contact_threads_sync_t on event_contact_threads;
create trigger event_contact_threads_sync_t
  after insert or update or delete on event_contact_threads
  for each row execute function event_contact_threads_sync();

alter table event_contact_threads enable row level security;
drop policy if exists event_contact_threads_all on event_contact_threads;
create policy event_contact_threads_all on event_contact_threads
  for all to authenticated using (true) with check (true);

comment on table event_contact_threads is
  'One row per conversation with a contact. The history behind event_contacts.last_summary.';
