import { NavLink, Outlet } from "react-router-dom";
import { Workflow, History, Settings, LogOut } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

// Executions and Settings arrive in later phases, so they are shown but disabled.
const items = [
  { to: "/", label: "Workflows", icon: Workflow, enabled: true },
  { label: "Executions", icon: History, enabled: false },
  { label: "Settings", icon: Settings, enabled: false },
];

export default function AppShell() {
  const { user, logout } = useAuth();

  return (
    <div className="flex min-h-screen">
      <aside className="w-52 shrink-0 border-r flex flex-col bg-sidebar">
        <div className="h-12 px-4 flex items-center font-medium border-b">Forge-fort</div>

        <nav className="flex-1 p-2 space-y-0.5">
          {items.map(({ to, label, icon: Icon, enabled }) =>
            enabled ? (
              <NavLink
                key={label}
                to={to}
                end
                className={({ isActive }) =>
                  `flex items-center gap-2 h-8 px-2 rounded-md text-sm ${
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-muted-foreground hover:bg-sidebar-accent"
                  }`
                }
              >
                <Icon className="size-4" />
                {label}
              </NavLink>
            ) : (
              <div
                key={label}
                title="Coming in a later phase"
                className="flex items-center gap-2 h-8 px-2 rounded-md text-sm text-muted-foreground/50 cursor-not-allowed"
              >
                <Icon className="size-4" />
                {label}
              </div>
            )
          )}
        </nav>

        <div className="p-2 border-t">
          <div className="px-2 py-1 text-xs text-muted-foreground truncate">{user.email}</div>
          <button
            onClick={logout}
            className="w-full flex items-center gap-2 h-8 px-2 rounded-md text-sm text-muted-foreground hover:bg-sidebar-accent"
          >
            <LogOut className="size-4" />
            Log out
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0">
        <Outlet /> {/* the matched child route (Dashboard) renders here */}
      </main>
    </div>
  );
}
