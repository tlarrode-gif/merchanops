create table if not exists app_users (
  id text primary key,
  username text not null unique,
  password text not null,
  display_name text not null,
  role text not null default 'manager' check (role in ('admin', 'manager')),
  active boolean not null default true,
  provinces text[] not null default '{}',
  permissions jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

alter table app_users disable row level security;

insert into app_users (id, username, password, display_name, role, active, provinces, permissions)
values (
  'admin',
  'admin',
  'admin123',
  'Administracion',
  'admin',
  true,
  '{}',
  '{"servicios":true,"isdin":true,"calendario":true,"pagos":true,"logistica":true,"usuarios":true}'::jsonb
)
on conflict (id) do nothing;

insert into app_users (id, username, password, display_name, role, active, provinces, permissions)
values
  ('gestor_1', 'gestor1', 'gestor123', 'Gestor 1', 'manager', false, '{}', '{"servicios":true,"isdin":true,"calendario":true,"pagos":true,"logistica":true,"usuarios":false}'::jsonb),
  ('gestor_2', 'gestor2', 'gestor123', 'Gestor 2', 'manager', false, '{}', '{"servicios":true,"isdin":true,"calendario":true,"pagos":true,"logistica":true,"usuarios":false}'::jsonb),
  ('gestor_3', 'gestor3', 'gestor123', 'Gestor 3', 'manager', false, '{}', '{"servicios":true,"isdin":true,"calendario":true,"pagos":true,"logistica":true,"usuarios":false}'::jsonb),
  ('gestor_4', 'gestor4', 'gestor123', 'Gestor 4', 'manager', false, '{}', '{"servicios":true,"isdin":true,"calendario":true,"pagos":true,"logistica":true,"usuarios":false}'::jsonb)
on conflict (id) do nothing;

alter table services add column if not exists created_by_user_id text;
alter table services add column if not exists created_by_user_name text;
alter table points add column if not exists province text;
alter table isdin_vinyls add column if not exists phone_number text;

create index if not exists idx_app_users_username on app_users(username);
create index if not exists idx_app_users_role on app_users(role);
create index if not exists idx_services_created_by_user_id on services(created_by_user_id);
create index if not exists idx_points_province on points(province);
