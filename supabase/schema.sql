create extension if not exists "uuid-ossp";

create table if not exists clients (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  ceco text,
  notes text,
  created_at timestamp with time zone default now()
);

create table if not exists workers (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  phone text,
  province text,
  capacity numeric default 40,
  active_hours numeric default 0,
  skills text,
  created_at timestamp with time zone default now()
);

create table if not exists services (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid references clients(id) on delete set null,
  client text not null,
  ceco text,
  campaign text not null,
  province text,
  start_date date,
  deadline date,
  priority text default 'Media',
  service_type text default 'Otro',
  reporting_channel text default 'WhatsApp',
  worker_id uuid references workers(id) on delete set null,
  worker_name text,
  status text default 'Pendiente asignar',
  material_status text default 'Pendiente',
  tracking text,
  default_point_fee numeric default 0,
  estimated_hours numeric default 0,
  instructions text,
  communication_sent_at timestamp with time zone,
  payment_included boolean default false,
  created_at timestamp with time zone default now()
);

create table if not exists points (
  id uuid primary key default uuid_generate_v4(),
  service_id uuid references services(id) on delete cascade,
  name text not null,
  address text,
  fee numeric default 0,
  notes text,
  status text default 'Pendiente',
  created_at timestamp with time zone default now()
);

create table if not exists attachments (
  id uuid primary key default uuid_generate_v4(),
  service_id uuid references services(id) on delete cascade,
  name text not null,
  url text,
  type text,
  size numeric,
  category text,
  created_at timestamp with time zone default now()
);

alter table clients disable row level security;
alter table workers disable row level security;
alter table services disable row level security;
alter table points disable row level security;
alter table attachments disable row level security;

insert into clients (name, ceco, notes)
select 'Revlon', 'CECO-REVLON', 'Cliente gran consumo'
where not exists (select 1 from clients where name = 'Revlon');

insert into clients (name, ceco, notes)
select 'Banc Sabadell', 'CECO-SABADELL', 'Oficinas y campañas de vinilo'
where not exists (select 1 from clients where name = 'Banc Sabadell');

insert into clients (name, ceco, notes)
select 'ISDIN', 'CECO-ISDIN', 'Farmacia y retail health'
where not exists (select 1 from clients where name = 'ISDIN');
