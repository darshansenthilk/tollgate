"use client";

import { useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { DASHBOARD_PERMISSION_ACTIONS, type DashboardPermissionAction } from "@tollgate/shared";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ApiError, type DashboardRole, type DashboardRolePermissions } from "@/lib/api";

/** Display copy for each toggle, in DASHBOARD_PERMISSION_ACTIONS' order —
 *  keyed by the wire value so a lookup can't drift out of sync with
 *  @tollgate/shared's own list. There is deliberately no ROLE_LABELS beside
 *  this: actions are a fixed compile-time list, roles are rows the host
 *  creates at runtime and so carry their own names. */
const ACTION_LABELS: Record<DashboardPermissionAction, string> = {
  createAgent: "Create agents",
  updateAgent: "Edit agents",
  freezeAgent: "Freeze agents",
  unfreezeAgent: "Unfreeze agents",
  deleteAgent: "Delete agents",
  addDashboardMember: "Add dashboard members",
};

/** A role is created with no dashboard_role_permissions rows at all, and the
 *  api reads "no row" as false — so the popup can show the new role's toggles
 *  immediately from this instead of a round trip that would answer the same. */
function allActionsOff(): Record<DashboardPermissionAction, boolean> {
  const result = {} as Record<DashboardPermissionAction, boolean>;
  for (const action of DASHBOARD_PERMISSION_ACTIONS) result[action] = false;
  return result;
}

interface SharePermissionsDialogProps {
  open: boolean;
  dashboardName: string;
  /** Injected like ShareDashboardDialog's props — decouples this dialog from
   *  lib/api and from which dashboard is active. */
  listDashboardRoles: () => Promise<DashboardRole[]>;
  getDashboardRolePermissions: (roleId: string) => Promise<DashboardRolePermissions>;
  setDashboardRolePermissions: (
    roleId: string,
    permissions: Partial<Record<DashboardPermissionAction, boolean>>,
  ) => Promise<DashboardRolePermissions>;
  createDashboardRole: (name: string) => Promise<DashboardRole>;
  /** Rejects with an ApiError whose MESSAGE carries the reason, including the
   *  holder count for `dashboard_role_in_use` — see lib/api.ts's own
   *  deleteDashboardRole doc comment. Rendered verbatim below. */
  deleteDashboardRole: (roleId: string) => Promise<unknown>;
  onOpenChange: (open: boolean) => void;
}

export function SharePermissionsDialog({
  open,
  dashboardName,
  listDashboardRoles,
  getDashboardRolePermissions,
  setDashboardRolePermissions,
  createDashboardRole,
  deleteDashboardRole,
  onOpenChange,
}: SharePermissionsDialogProps) {
  const [roles, setRoles] = useState<DashboardRole[]>([]);
  // A role ID now, not a role name, and null until the list has loaded (or
  // when the dashboard somehow has no roles at all) — the toggle list renders
  // only once one is actually selected.
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
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
  const [newRoleName, setNewRoleName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // The create form is revealed by the "+" button, never shown on arrival, and
  // deliberately NOT remembered across a close/reopen — it resets in the
  // seeding block below with the rest of the popup-scoped state.
  const [showCreateForm, setShowCreateForm] = useState(false);
  // Which role is queued up in the confirmation dialog, and which one (if any)
  // has a DELETE actually in flight — kept in their own state rather than
  // folded into pendingAction, the same way share-dashboard-dialog.tsx keeps
  // pendingRemoveUserId separate from pendingRoleUserId so two flows can't
  // race one row.
  const [confirmingDeleteRoleId, setConfirmingDeleteRoleId] = useState<string | null>(null);
  const [pendingDeleteRoleId, setPendingDeleteRoleId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const selectedRole = roles.find((r) => r.id === selectedRoleId) ?? null;
  // Always the same role as `selectedRole` while a confirmation is armed —
  // switchToRole disarms — but looked up by its own id so the panel can never
  // render copy naming a role other than the one handleDelete would delete.
  const confirmingRole = roles.find((r) => r.id === confirmingDeleteRoleId) ?? null;

  // Same single-counter-guards-several-async-flows pattern as
  // ShareDashboardDialog — the roles fetch, a permissions fetch, any number of
  // toggle saves, a create and a delete can all be in flight together. Closing
  // the dialog, or switching to a different role, is what invalidates a stale
  // result.
  const generation = useRef(0);

  function loadPermissions(roleId: string) {
    const gen = generation.current;
    setLoading(true);
    setLoadError(null);
    void getDashboardRolePermissions(roleId)
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

  /**
   * Show a different role's toggles. Bumps the generation, which is what stops
   * a toggle save (or a permissions load) still in flight for the PREVIOUS
   * role from painting its result into this one.
   *
   * `known` skips the fetch for a role whose toggle state is already certain —
   * only a freshly created one, which by construction has no rows at all.
   */
  function switchToRole(
    roleId: string | null,
    known?: Record<DashboardPermissionAction, boolean>,
  ) {
    generation.current += 1;
    setSelectedRoleId(roleId);
    setSaveError(null);
    setPendingAction(null);
    setLoadError(null);
    // Disarm any confirmation still showing. The delete confirmation is inline
    // rather than a modal dialog now, so nothing else stops the host changing
    // the selection while it's up — without this they could be looking at a
    // panel that names one role while the dropdown reads another. Clearing it
    // here keeps the armed role and the selected role the same role, which is
    // what the panel's copy assumes.
    setConfirmingDeleteRoleId(null);
    setDeleteError(null);

    if (known !== undefined) {
      setPermissions(known);
      setLoading(false);
      return;
    }

    setPermissions(null);
    if (roleId === null) setLoading(false);
    else loadPermissions(roleId);
  }

  if (open && !seeded) {
    setSeeded(true);
    setRoles([]);
    setSelectedRoleId(null);
    setPermissions(null);
    setLoadError(null);
    setSaveError(null);
    setPendingAction(null);
    setNewRoleName("");
    setCreating(false);
    setCreateError(null);
    setShowCreateForm(false);
    setConfirmingDeleteRoleId(null);
    setPendingDeleteRoleId(null);
    setDeleteError(null);

    const gen = generation.current;
    setLoading(true);
    void listDashboardRoles()
      .then((res) => {
        if (generation.current !== gen) return;
        setRoles(res);
        // The api sorts is_default first, but find() rather than [0] so the
        // starting selection follows the FLAG — the same invariant the api's
        // own delete refusal keys off — instead of an ordering this component
        // would otherwise be silently depending on.
        const initial = res.find((r) => r.isDefault) ?? res[0];
        if (initial === undefined) {
          setLoading(false);
          return;
        }
        setSelectedRoleId(initial.id);
        // loadPermissions takes `loading` from here.
        loadPermissions(initial.id);
      })
      .catch((err: unknown) => {
        if (generation.current !== gen) return;
        setLoadError(err instanceof ApiError ? err.message : "Couldn't load this dashboard's roles.");
        setLoading(false);
      });
  } else if (!open && seeded) {
    setSeeded(false);
    generation.current += 1;
  }

  function handleRoleChange(roleId: string) {
    if (roleId === selectedRoleId) return;
    switchToRole(roleId);
  }

  async function handleToggle(action: DashboardPermissionAction, enabled: boolean) {
    if (selectedRoleId === null) return;

    const gen = generation.current;
    const roleId = selectedRoleId;
    // Optimistic flip so the switch responds immediately; reverted in the
    // catch branch if the save fails.
    setPermissions((prev) => (prev === null ? prev : { ...prev, [action]: enabled }));
    setPendingAction(action);
    setSaveError(null);
    try {
      const result = await setDashboardRolePermissions(roleId, { [action]: enabled });
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

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newRoleName.trim();
    if (trimmed === "") return;

    const gen = generation.current;
    setCreating(true);
    setCreateError(null);
    try {
      const role = await createDashboardRole(trimmed);
      if (generation.current !== gen) return;
      // Append in place rather than refetching the list — the same style
      // ShareDashboardDialog's handleAdd uses. A new role has no toggle rows
      // at all, so its (all-false) state is known without asking.
      setRoles((prev) => [...prev, role]);
      setNewRoleName("");
      setCreating(false);
      switchToRole(role.id, allActionsOff());
    } catch (err) {
      if (generation.current !== gen) return;
      setCreateError(err instanceof ApiError ? err.message : "Couldn't create that role.");
      setCreating(false);
    }
    // No `finally`: the success path bumps the generation itself (switchToRole),
    // so a generation-guarded cleanup there would never run.
  }

  async function handleDelete() {
    if (confirmingDeleteRoleId === null) return;
    const roleId = confirmingDeleteRoleId;

    const gen = generation.current;
    setPendingDeleteRoleId(roleId);
    setDeleteError(null);
    try {
      await deleteDashboardRole(roleId);
      if (generation.current !== gen) return;
      setPendingDeleteRoleId(null);
      setConfirmingDeleteRoleId(null);
      // Functional update, so a role created while this DELETE was in flight
      // isn't dropped by a stale copy of the list.
      setRoles((prev) => prev.filter((r) => r.id !== roleId));
      // Fall back to the default role, which is safe to read from the render's
      // own copy: it's in every version of this list, since the api refuses to
      // delete it.
      const fallback = roles.find((r) => r.isDefault) ?? null;
      switchToRole(fallback?.id ?? null);
    } catch (err) {
      if (generation.current !== gen) return;
      // Deliberately leaves the confirmation panel OPEN. For
      // dashboard_role_in_use the message carries the count of accounts
      // holding this role, which is the entire explanation — dismissing the
      // panel would throw it away.
      setDeleteError(err instanceof ApiError ? err.message : "Couldn't delete that role.");
      setPendingDeleteRoleId(null);
    }
  }

  return (
    // One Dialog, no nesting. Both the create form and the delete confirmation
    // are inline panels inside this content, which has a consequence worth
    // stating: Escape now closes the WHOLE popup, including while a delete is
    // in flight — the nested confirm dialog used to be topmost and swallow it.
    // That is accepted rather than guarded here. Closing mid-request is already
    // allowed for an in-flight toggle save: the `!open && seeded` branch bumps
    // `generation`, the response is discarded, the request still lands
    // server-side, and the next open refetches the roles list from scratch.
    // Locking the host out of the entire popup to protect one request would be
    // a heavier behaviour than the one being removed.
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Role permissions for &quot;{dashboardName}&quot;</DialogTitle>
        </DialogHeader>

        {/* Above the Role section deliberately: the "+" that reveals this sits
            at the top-right of that section, so the form unfolds directly
            against its own trigger instead of appearing somewhere the eye has
            to go looking for it. Inline rather than a nested dialog because
            creating needs no confirmation — and as of this round, neither does
            deleting. */}
        {showCreateForm && (
          <form onSubmit={handleCreate} className="flex flex-col gap-2">
            <Label htmlFor="permissions-new-role">Create a role</Label>
            <div className="flex gap-2">
              <Input
                id="permissions-new-role"
                value={newRoleName}
                onChange={(e) => setNewRoleName(e.target.value)}
                placeholder="Editor"
                maxLength={30}
                // Mounts fresh on every reveal, so this needs no ref and no
                // effect — which matters here: this component syncs all of its
                // state in the render phase and has no useEffect at all.
                autoFocus
                className="min-w-0 flex-1"
              />
              <Button type="submit" disabled={creating || newRoleName.trim() === ""}>
                {creating ? "Creating…" : "Create"}
              </Button>
            </div>
            {createError !== null && (
              <p className="text-sm" style={{ color: "var(--err)" }}>
                {createError}
              </p>
            )}
          </form>
        )}

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="permissions-role-trigger">Role</Label>
            {/* Stays ENABLED at MAX_ROLES_PER_DASHBOARD. Same doctrine as the
                delete button on a held role below: the attempt is what
                produces the explanation (dashboard_role_limit_reached), so
                pre-disabling this would mean that message could never be
                shown. The icon never changes, so aria-label carries the
                open/closed state rather than leaving it to aria-expanded
                alone. */}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              aria-expanded={showCreateForm}
              aria-label={showCreateForm ? "Hide the create-role form" : "Create a role"}
              onClick={() => {
                // Collapsing discards what was typed and any error with it, so
                // the next reveal can't open onto a stale duplicate-name
                // refusal for a name that is no longer in the box.
                if (showCreateForm) {
                  setNewRoleName("");
                  setCreateError(null);
                }
                setShowCreateForm(!showCreateForm);
              }}
            >
              <Plus />
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger
                id="permissions-role-trigger"
                // Locked while a delete is in flight: the confirmation is
                // inline and no longer modal, so without this the host could
                // switch away mid-request and orphan it.
                disabled={roles.length === 0 || pendingDeleteRoleId !== null}
                className="flex h-8 min-w-0 flex-1 items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 md:text-sm"
              >
                <span className="min-w-0 truncate">{selectedRole?.name ?? "No roles yet"}</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {roles.map((role) => (
                  <DropdownMenuItem key={role.id} onClick={() => handleRoleChange(role.id)}>
                    {role.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {/* The default role simply has NO delete button rather than a
                disabled one — a host clicking it could only ever be refused.
                A role someone currently holds DOES keep an enabled button:
                the attempt is what produces the "N accounts have it"
                explanation, so pre-disabling it would mean that message could
                never appear. */}
            {selectedRole !== null && !selectedRole.isDefault && (
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={`Delete the ${selectedRole.name} role`}
                aria-expanded={confirmingDeleteRoleId === selectedRole.id}
                onClick={() => {
                  // Clear any error left over from a previous target role —
                  // otherwise it briefly shows on THIS role's confirmation
                  // panel before any request for it has run.
                  setDeleteError(null);
                  setConfirmingDeleteRoleId(selectedRole.id);
                }}
                disabled={pendingDeleteRoleId !== null}
              >
                <Trash2 className="size-4" style={{ color: "var(--err)" }} />
              </Button>
            )}
          </div>
        </div>

        {/* The delete confirmation, inline directly under the role it targets
            rather than as a second Dialog stacked over this one. Tinted and
            bordered so it reads as a distinct danger zone instead of more body
            copy, and able to name the role now that it isn't confined to a
            dialog title. */}
        {confirmingRole !== null && (
          <div className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <p className="text-sm">
              Delete the &quot;{confirmingRole.name}&quot; role? Its permission settings go with it.
            </p>

            {deleteError !== null && (
              <p className="text-sm" style={{ color: "var(--err)" }}>
                {deleteError}
              </p>
            )}

            <div className="flex justify-end gap-2">
              {/* Focus lands on Cancel, not Delete: this panel appears without
                  a focus trap, so something has to take focus for a keyboard
                  user to know it opened — and the destructive choice is the
                  wrong thing to hand them by default. */}
              <Button
                type="button"
                variant="outline"
                autoFocus
                onClick={() => {
                  setConfirmingDeleteRoleId(null);
                  setDeleteError(null);
                }}
                disabled={pendingDeleteRoleId !== null}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => void handleDelete()}
                disabled={pendingDeleteRoleId !== null}
              >
                {pendingDeleteRoleId !== null ? "Deleting…" : "Delete"}
              </Button>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : loadError !== null ? (
            <p className="text-sm" style={{ color: "var(--err)" }}>
              {loadError}
            </p>
          ) : selectedRoleId === null ? (
            // Names the button, because with the form hidden by default this
            // is otherwise an instruction to use a control that isn't on
            // screen. Only reachable through a failed or empty roles fetch —
            // every dashboard has a seeded default role.
            <p className="text-sm text-muted-foreground">
              Use + above to create a role and start delegating permissions.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {DASHBOARD_PERMISSION_ACTIONS.map((action) => {
                const enabled = permissions?.[action] ?? false;
                return (
                  <li key={action} className="flex items-center justify-between gap-4">
                    <Label htmlFor={`permission-${action}`} className="font-normal">
                      {ACTION_LABELS[action]}
                    </Label>
                    {/* Red/green fill (not the Switch primitive's default
                        neutral/primary) — this toggle specifically represents
                        an allow/deny decision, unlike a generic on/off
                        setting, so it gets the same --ok/--err semantic
                        colors the rest of the dashboard uses for that
                        distinction rather than becoming the shared
                        component's new default look. */}
                    <Switch
                      id={`permission-${action}`}
                      checked={enabled}
                      disabled={permissions === null || pendingAction === action}
                      onCheckedChange={(checked) => void handleToggle(action, checked)}
                      style={{ backgroundColor: enabled ? "var(--ok)" : "var(--err)" }}
                    />
                  </li>
                );
              })}
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
