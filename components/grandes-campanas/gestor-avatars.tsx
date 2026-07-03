"use client";

import { avatarColor, initials } from "@/lib/campanas";

export function GestorAvatar({ name, size = 28 }: { name?: string | null; size?: number }) {
  return (
    <span
      className="gc-avatar"
      title={name || "Sin gestor"}
      style={{ backgroundColor: avatarColor(name), width: size, height: size, fontSize: Math.round(size * 0.36) }}
    >
      {initials(name)}
    </span>
  );
}

export function GestorAvatarStack({ names, max = 3 }: { names: string[]; max?: number }) {
  const visible = names.slice(0, max);
  const rest = names.length - visible.length;
  if (!names.length) return <span className="text-xs" style={{ color: "var(--gc-muted)" }}>Sin gestor</span>;
  return (
    <span className="gc-avatar-stack" title={names.join(", ")}>
      {visible.map((name, index) => <GestorAvatar key={`${name}-${index}`} name={name} />)}
      {rest > 0 && <span className="gc-avatar gc-avatar-more">+{rest}</span>}
    </span>
  );
}
