import axios from "axios";

export const TOKEN_KEY = "forge_token";

export const api = axios.create({ baseURL: import.meta.env.VITE_API_URL });

api.interceptors.request.use((config)=>{
    const token = localStorage.getItem(TOKEN_KEY);
    if(token) config.headers.Authorization = `Bearer ${token}`;
    return config;
});

// A 401 with a stored token means the token expired or the user is gone: drop it and tell
// AuthContext to log out. Shared by Axios (below) and the fetch-based SSE reader (executionStream.js).
export function handleUnauthorized(){
    if(!localStorage.getItem(TOKEN_KEY)) return;
    localStorage.removeItem(TOKEN_KEY);
    window.dispatchEvent(new Event("auth:logout"));
}

api.interceptors.response.use(
    (res)=> res,
    (err)=>{
        if(err.response?.status === 401) handleUnauthorized();
        return Promise.reject(err);
    }
);

export function getApiError(err){
    const apiError = err.response?.data?.error;
    if(apiError) return {message: apiError.message, details: apiError.details };
    return { message: "Cannot reach the server",details: null};
}