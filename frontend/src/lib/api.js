import axios from "axios";

export const TOKEN_KEY = "forge_token";

export const api = axios.create({ baseURL: import.meta.env.VITE_API_URL });

api.interceptors.request.use((config)=>{
    const token = localStorage.getItem(TOKEN_KEY);
    if(token) config.headers.Authorization = `Bearer ${token}`;
    return config;
});

api.interceptors.response.use(
    (res)=> res,
    (err)=>{
        const hadToken = !!localStorage.getItem(TOKEN_KEY);
        if(err.response?.status === 401 && hadToken){
            localStorage.removeItem(TOKEN_KEY);
            window.dispatchEvent(new Event("auth:logout"));

        }
        return Promise.reject(err);

    }
);

export function getApiError(err){
    const apiError = err.response?.data?.error;
    if(apiError) return {message: apiError.message, details: apiError.details };
    return { message: "Cannot reach the server",details: null};
}