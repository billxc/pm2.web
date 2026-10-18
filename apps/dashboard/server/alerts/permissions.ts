import type { IUser } from "@pm2.web/typings";

// MONITORING is bit 1 in utils/permission.ts. Process overrides replace server permissions.
const canMonitor = (perms: number) => (perms & (1 << 1)) !== 0;
const objectId = /^[a-f\d]{24}$/i;

/** Applied inside the database query, before pagination. Host events require server-level monitoring. */
export function alertVisibilityFilter(user: Pick<IUser, "acl">): Record<string, unknown> {
  if (user.acl.admin || user.acl.owner) return {};
  const clauses: Record<string, unknown>[] = [];
  const servers = user.acl.servers ?? [];
  for (const server of servers) {
    const id = String(server.server);
    if (!objectId.test(id)) continue;
    const overrides = server.processes ?? [];
    if (canMonitor(server.perms)) {
      clauses.push({
        server: id,
        $or: [
          { kind: "host_offline" },
          {
            kind: "restart_storm",
            process: { $nin: overrides.filter((p) => !canMonitor(p.perms)).map((p) => String(p.process)) },
          },
        ],
      });
    } else {
      const processes = overrides
        .filter((p) => canMonitor(p.perms))
        .map((p) => String(p.process))
        .filter((id) => objectId.test(id));
      if (processes.length > 0) clauses.push({ server: id, kind: "restart_storm", process: { $in: processes } });
    }
  }
  // An impossible condition, not an empty filter, for users with no access.
  return clauses.length > 0 ? { $or: clauses } : { _id: { $in: [] } };
}
