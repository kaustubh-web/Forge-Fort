
import * as authService from "../services/authServices.js";

export async function register(req,res){
    const {user,token} = await authService.register(req.body);
    res.status(201).json({ success: true, data: {user,token}});
}

export async function login(req,res){
    const { user,token } = await authService.login(req.body);
    res.json({ success: true, data: { user,token }});
}

export function me(req,res){
    res.json({ success:true, data: {user: req.user}});
}

