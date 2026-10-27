export default function AuthCard({title, subtitle, children, footer }){
    return (
        <div className="min-h-screen flex items-center justify-center p-4">
            <div className="w-full max-w-sm rounded-lg border bg-card p-6">
                <h1 className="text-xl font-medium">{title}</h1>
                <p className="mt-1 mb-5 text-muted-foreground">{subtitle}</p>
                 {children}
                <div className="mt-5 text-muted-foreground">{footer}</div>
            </div>

        </div>

    );
}