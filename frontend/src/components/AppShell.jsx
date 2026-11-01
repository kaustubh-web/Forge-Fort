import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Workflow, History, Settings, LogOut, Menu } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";
import Logo from "@/components/Logo";

// The app's main sections. Each item opens a page.
const items = [
  { to: "/", label: "Workflows", icon: Workflow, enabled: true },
  { to:"/executions",label: "Executions", icon: History, enabled: true },
  { to: "/settings", label: "Settings", icon: Settings, enabled: true },
];

export default function AppShell() {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();

  // The editor needs the space, so there the sidebar starts collapsed to an icon rail.
  // The editor and the other pages each remember their own choice, so opening a workflow
  // never undoes what you picked on the dashboard (and the other way round).
  const inEditor = pathname.startsWith("/workflows/");
  const [openInEditor, setOpenInEditor] = useState(false);
  const [openElsewhere, setOpenElsewhere] = useState(true);
  const open = inEditor ? openInEditor : openElsewhere;
  const toggle = () => (inEditor ? setOpenInEditor((o) => !o) : setOpenElsewhere((o) => !o));

  return (
    <div className="flex h-screen">
      <aside
        className={cn(
          "flex shrink-0 flex-col border-r bg-sidebar transition-[width] duration-150",
          open ? "w-52" : "w-12"
        )}
      >
        <div className="flex h-12 items-center gap-2 border-b px-2">
          <button
            onClick={toggle}
            title={open ? "Collapse sidebar" : "Expand sidebar"}
            aria-label={open ? "Collapse sidebar" : "Expand sidebar"}
            aria-expanded={open}
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent"
          >
            <Menu className="size-4" />
          </button>
          {open && (
            <span className="flex min-w-0 items-center gap-2 font-medium">
              <Logo className="size-5 shrink-0 text-primary" />
              <span className="truncate">Forge-fort</span>
            </span>
          )}
        </div>

        <nav className="flex-1 space-y-0.5 p-2">
          {items.map(({ to, label, icon: Icon, enabled }) =>
            enabled ? (
              <NavLink
                key={label}
                to={to}
                end
                title={open ? undefined : label} // collapsed: the name shows on hover
                className={({ isActive }) =>
                  cn(
                    "flex h-8 items-center gap-2 rounded-md px-2 text-sm",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-muted-foreground hover:bg-sidebar-accent"
                  )
                }
              >
                <Icon className="size-4 shrink-0" />
                {open && label}
              </NavLink>
            ) : (
              <div
                key={label}
                title={open ? "Coming in a later phase" : `${label} (coming in a later phase)`}
                className="flex h-8 cursor-not-allowed items-center gap-2 rounded-md px-2 text-sm text-muted-foreground/50"
              >
                <Icon className="size-4 shrink-0" />
                {open && label}
              </div>
            )
          )}
        </nav>

        <div className="border-t p-2">
          {open && <div className="truncate px-2 py-1 text-xs text-muted-foreground">{user.email}</div>}
          <button
            onClick={logout}
            title={open ? undefined : `Log out (${user.email})`}
            className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm text-muted-foreground hover:bg-sidebar-accent"
          >
            <LogOut className="size-4 shrink-0" />
            {open && "Log out"}
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-auto">
        <Outlet /> {/* the matched child route renders here */}
      </main>
    </div>
  );
}
