import * as secretService from "../services/secretService.js";

export async function list(req, res) {
    const secrets = await secretService.listSecrets(req.user._id);
    res.json({ success: true, data: { secrets } });
}

export async function create(req, res) {
    const secret = await secretService.createSecret(req.user._id, req.body);
    res.status(201).json({ success: true, data: { secret } });
}

export async function update(req, res) {
    const secret = await secretService.updateSecret(req.user._id, req.params.name, req.body.value);
    res.json({ success: true, data: { secret } });
}

export async function remove(req, res) {
    await secretService.deleteSecret(req.user._id, req.params.name);
    res.json({ success: true, data: { name: req.params.name } });
}
