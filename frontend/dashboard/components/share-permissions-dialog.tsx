"use client";

import { useRef, useState } from "react";
import { DASHBOARD_PERMISSION_ACTIONS, type DashboardMemberRole, type DashboardPermissionAction } from "@tollgate/shared";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ApiError, type DashboardRolePermissions } from "@/lib/api";

/** Display copy for each toggle, in DASHBOARD_PERMISSION_ACTIONS' order —
 *  keyed by the wire value so a lookup can't drift out of sync with
 *  @tollgate/shared's own list. */
const ACTION_LABELS: Record<DashboardPermissionAction, string> = {
  createAgent: "Create agents",
  updateAgent: "Edit agents",
  freezeAgent: "Freeze agents",
  unfreezeAgent: "Unfreeze agents",
  deleteAgent: "Delete agents",
  addDashboardMember: "Add dashboard members",
};

/**
 * Roles the dropdown offers — deliberately just Observer this round (PLAN.md:
 * "Scope for this round: Observer only"). Widening this to
 * Helper/Manager/Moderator/Admin later is just adding entries here; nothing
 * else in this component assumes there's only one.
 */
const ROLE_OPTIONS: { value: DashboardMemberRole; label: string }[] = [
  { value: "observer", label: "Observer" },
];

interface SharePermissionsDialogProps {
  open: boolean;
  dashboardName: string;
  /** Injected like ShareDashboardDialog's props — decouples this dialog from
   *  lib/api and from which dashboard is active. */
  getDashboardRolePermissions: (role: DashboardMemberRole) => Promise<DashboardRolePermissions>;
  setDashboardRolePermissions: (
    role: DashboardMemberRole,
    permissions: Partial<Record<DashboardPermissionAction, boolean>>,
  ) => Promise<DashboardRolePermissions>;
  onOpenChange: (open: boolean) => void;
}

export function SharePermissionsDialog({
  open,
  dashboardName,
  getDashboardRolePermissions,
  setDashboardRolePermissions,
  onOpenChange,
}: SharePermissionsDialogProps) {
  const [selectedRole, setSelectedRole] = useState<DashboardMemberRole>("observer");
  const [seeded, setSeeded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<Record<DashboardPermissionAction, boolean> | null>(
    null,
  );
  // Which toggle has a save in flight, so it (and only it) can disable itself
  // rather than let a second click race the first.
  const [pendingAction, setPendingAction] = useState<DashboardPermissionAction | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Same single-counter-guards-several-async-flows pattern as
  // ShareDashboardDialog — the role fetch and any number of toggle saves can
  // be in flight together; only closing (or switching roles) mid-flight
  // invalidates a stale result.
  const generation = useRef(0);

  function loadPermissions(role: DashboardMemberRole) {
    const gen = generation.current;
    setLoading(true);
    setLoadError(null);
    void getDashboardRolePermissions(role)
      .then((res) => {
        if (generation.current !== gen) return;
        setPermissions(res.permissions);
      })
      .catch((err: unknown) => {
        if (generation.current !== gen) return;
        setLoadError(
          err instanceof ApiError ? err.message : "Couldn't load this role's permissions.",
        );
      })
      .finally(() => {
        if (generation.current === gen) setLoading(false);
      });
  }

  if (open && !seeded) {
    setSeeded(true);
    setSelectedRole("observer");
    setPermissions(null);
    setLoadError(null);
    setSaveError(null);
    setPendingAction(null);
    loadPermissions("observer");
  } else if (!open && seeded) {
    setSeeded(false);
    generation.current += 1;
  }

  function handleRoleChange(role: DashboardMemberRole) {
    if (role === selectedRole) return;
    generation.current += 1;
    setSelectedRole(role);
    setPermissions(null);
    setSaveError(null);
    setPendingAction(null);
    loadPermissions(role);
  }

  async function handleToggle(action: DashboardPermissionAction, enabled: boolean) {
    const gen = generation.current;
    // Optimistic flip so the switch responds immediately; reverted in the
    // catch branch if the save fails.
    setPermissions((prev) => (prev === null ? prev : { ...prev, [action]: enabled }));
    setPendingAction(action);
    setSaveError(null);
    try {
      const result = await setDashboardRolePermissions(selectedRole, { [action]: enabled });
      if (generation.current !== gen) return;
      setPermissions(result.permissions);
    } catch (err) {
      if (generation.current !== gen) return;
      setPermissions((prev) => (prev === null ? prev : { ...prev, [action]: !enabled }));
      setSaveError(err instanceof ApiError ? err.message : "Couldn't save that change.");
    } finally {
      if (generation.current === gen) setPendingAction(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Role permissions for &quot;{dashboardName}&quot;</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor="permissions-role-trigger">Role</Label>
          <DropdownMenu>
            <DropdownMenuTrigger
              id="permissions-role-trigger"
              className="flex h-8 w-full items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
            >
              {ROLE_OPTIONS.find((r) => r.value === selectedRole)?.label ?? selectedRole}
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {ROLE_OPTIONS.map((role) => (
                <DropdownMenuItem key={role.value} onClick={() => handleRoleChange(role.value)}>
                  {role.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex flex-col gap-3">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : loadError !== null ? (
            <p className="text-sm" style={{ color: "var(--err)" }}>
              {loadError}
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {DASHBOARD_PERMISSION_ACTIONS.map((action) => (
                <li key={action} className="flex items-center justify-between gap-4">
                  <Label htmlFor={`permission-${action}`} className="font-normal">
                    {ACTION_LABELS[action]}
                  </Label>
                  <Switch
                    id={`permission-${action}`}
                    checked={permissions?.[action] ?? false}
                    disabled={permissions === null || pendingAction === action}
                    onCheckedChange={(checked) => void handleToggle(action, checked)}
                  />
                </li>
              ))}
            </ul>
          )}
          {saveError !== null && (
            <p className="text-sm" style={{ color: "var(--err)" }}>
              {saveError}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
