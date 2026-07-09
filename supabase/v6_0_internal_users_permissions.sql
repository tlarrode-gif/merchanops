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

-- Los usuarios iniciales ya NO se siembran desde SQL con contraseñas en claro.
-- Con la tabla vacía, la aplicación siembra el usuario "admin" en el primer
-- arranque usando NEXT_PUBLIC_INITIAL_ADMIN_PASSWORD (o una aleatoria mostrada
-- por consola) y guarda las contraseñas hasheadas (PBKDF2). Ver lib/password.ts.

alter table services add column if not exists created_by_user_id text;
alter table services add column if not exists created_by_user_name text;
alter table points add column if not exists province text;
alter table isdin_vinyls add column if not exists phone_number text;

create index if not exists idx_app_users_username on app_users(username);
create index if not exists idx_app_users_role on app_users(role);
create index if not exists idx_services_created_by_user_id on services(created_by_user_id);
create index if not exists idx_points_province on points(province);
