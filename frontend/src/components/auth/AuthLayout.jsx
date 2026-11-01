import { Radio, ShieldCheck, Sparkles } from "lucide-react";
import Logo from "@/components/Logo";
import WorkflowPreview from "@/components/auth/WorkflowPreview";

const FEATURES = [
  { icon: ShieldCheck, text: "HTTP calls with SSRF protection" },
  { icon: Sparkles, text: "AI steps: summarize, classify, extract" },
  { icon: Radio, text: "Live progress, every run saved" },
];

// Sign in and Register: the product on the left (laptop widths and up), the form on the right.
export default function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="flex min-h-screen">
      <section className="hidden min-w-0 flex-1 flex-col justify-center gap-8 border-r px-12 py-10 lg:flex">
        <div className="mx-auto w-full max-w-4xl space-y-8">
          <div className="flex items-center gap-2 text-lg font-medium">
            <Logo className="size-6 text-primary" />
            ForgeFort
          </div>
          <div className="space-y-2">
            <p className="text-2xl font-medium">Build workflows you can watch run.</p>
            <p className="max-w-xl text-muted-foreground">
              Connect APIs, conditions and AI on a canvas. Every run streams live, node by node, and
              is saved so you can come back to it.
            </p>
          </div>
          <WorkflowPreview />
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
            {FEATURES.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-1.5">
                <Icon className="size-3.5" />
                {text}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <main className="flex w-full items-center justify-center p-6 lg:w-[440px] lg:shrink-0">
        <div className="w-full max-w-sm">
          {/* The left panel carries the brand on wide screens; on small ones it is hidden. */}
          <div className="mb-8 flex items-center gap-2 text-lg font-medium lg:hidden">
            <Logo className="size-6 text-primary" />
            ForgeFort
          </div>
          <h1 className="text-xl font-medium">{title}</h1>
          <p className="mt-1 mb-6 text-muted-foreground">{subtitle}</p>
          {children}
          <div className="mt-6 text-muted-foreground">{footer}</div>
        </div>
      </main>
    </div>
  );
}
