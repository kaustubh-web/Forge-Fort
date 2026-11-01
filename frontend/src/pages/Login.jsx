import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { toast } from "sonner";
import {useAuth} from "@/context/AuthContext";
import { getApiError } from "@/lib/api";
import AuthCard from "@/components/AuthCard";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";


export default function Login(){
    const { user,login } = useAuth();
    const [email,setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [fieldErrors, setFieldErrors] = useState({});

    if(user) return <Navigate to="/" replace />;

    async function onSubmit(e){
        e.preventDefault();
        setSubmitting(true);
        setFieldErrors({});
        try {
            await login ({email,password});
        } catch (err) {
            const{ message, details } = getApiError(err);
            if(Array.isArray(details)){
                setFieldErrors(Object.fromEntries(details.map((d)=>[d.field,d.message])));
            }
            toast.error(message);
            
        }finally{
            setSubmitting(false);
        }
    }
    return (
    <AuthCard
        title="Sign in"
        subtitle="Welcome back to ForgeFort."
        footer={
            <>
             No account?{" "}
             <Link to="/register" className="text-primary hover:underline">
              Create one
             </Link>
            </>
        }
        
        >
        <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
                <Label  htmlFor="email">Email</Label>
                <Input
                id="email"
                type="email"
                value={email}
                onChange={(e)=> setEmail(e.target.value)}
                required
                />
                {fieldErrors.email && <p className="text-xs text-destructive">{fieldErrors.email}</p>}
            </div>
            <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                id="password"
                type="password"
                value={password}
                onChange={(e)=> setPassword(e.target.value)}
                required
                />
                {fieldErrors.password &&(
                    <p className="text-xs text-destructive">{fieldErrors.password}</p>
                )}
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? "Signing in..." : "Sign in"}
            </Button>
        </form>
    </AuthCard>
    );
}