# Phase 1: Setup and Auth

## 1. What was built
- An Express API (`backend/`) that validates its environment at startup and connects to MongoDB.
- Central error handling that always answers in the `{ success, data | error }` envelope.
- JWT auth: register, login and `GET /api/auth/me`, with hashed passwords, input validation and rate limiting.
- 12 automated backend tests using an in-memory MongoDB.
- A React + Vite frontend (`frontend/`) with Tailwind, shadcn/ui and the design tokens from `docs/DESIGN.md`.
- Login and register pages, a route guard, an app shell with a sidebar, and an empty dashboard.
- No workflow features yet. This phase is the foundation every later route builds on.

## 2. Flow map

**Backend request (register)**
```
POST /api/auth/register
 -> backend/src/server.js            boots: env.js (validate) -> db.js connectDB() -> app.listen
 -> backend/src/app.js               helmet -> cors -> express.json -> routes
 -> routes/authRoutes.js             authLimiter (rate limit) -> validate(registerSchema)
 -> middleware/validate.js           Zod parse of req.body (schema/auth.js); replaces req.body with clean data
 -> controllers/authController.js    register()
 -> services/authServices.js         register(): bcrypt.hash -> User.create -> signToken
 -> models/User.js                   Mongoose model (unique email index) -> MongoDB
 <- 201 { success, data: { user, token } }
Any thrown AppError -> middleware/errorHandler.js -> { success:false, error:{ code, message, details } }
```

**Protected route (`GET /api/auth/me`)**
```
routes/authRoutes.js -> middleware/auth.js requireAuth (Bearer token -> jwt.verify -> User.findById -> req.user)
 -> controllers/authController.js me()
```

**Frontend**
```
frontend/src/main.jsx -> App.jsx
  BrowserRouter
   AuthProvider (context/AuthContext.jsx)  owns user + loading; on mount calls /auth/me if a token exists
    /login, /register -> pages/Login.jsx, Register.jsx -> useAuth().login/register
         -> AuthContext authenticate() -> lib/api.js (Axios) -> backend
         -> saves token in localStorage, sets user, page redirects to "/"
    ProtectedRoute (components/ProtectedRoute.jsx): loading -> skeleton, no user -> /login, else <Outlet/>
     AppShell (components/AppShell.jsx): sidebar + <Outlet/>
      Dashboard (pages/Dashboard.jsx)
lib/api.js interceptors: attach "Authorization: Bearer <token>"; on 401 delete the token and fire "auth:logout"
```

## 3. One concrete trace
Registering `Alice@Test.com` with password `password123`:
1. `Register.jsx` `onSubmit` calls `register({ email: "Alice@Test.com", password: "password123" })`.
2. `AuthContext.authenticate("/auth/register", body)` calls `api.post`, so Axios sends `POST http://localhost:4000/api/auth/register`. The browser first sends a CORS preflight, which `cors({ origin: CORS_ORIGIN })` allows.
3. `authLimiter` counts the request for this IP (limit 20 per 15 minutes).
4. `validate(registerSchema)`: the email is trimmed and lowercased to `alice@test.com`, and the password length (8 to 72) is checked. `req.body` is replaced with `{ email: "alice@test.com", password: "password123" }`.
5. `authServices.register`: `bcrypt.hash(password, 12)` gives something like `$2b$12$...`. `User.create({ email, passwordHash })` inserts the document.
6. `signToken(user)` returns a JWT with payload `{ sub: "<user id>", iat, exp }`, signed with `JWT_SECRET`.
7. The response is `201 { success: true, data: { user: { _id, email: "alice@test.com", createdAt }, token } }`. `toJSON` removed `passwordHash` and `__v`.
8. The frontend stores `forge_token` in localStorage and sets `user`. `Register.jsx` now sees `user` and returns `<Navigate to="/" />`. `ProtectedRoute` allows it, and `AppShell` shows the email in the sidebar.
9. On refresh: `AuthProvider` finds the token, calls `GET /auth/me` (the interceptor adds the Bearer header), and `requireAuth` verifies it and returns the user. Until that returns, `loading` is true and a skeleton shows.

Registering the same email again hits the unique index. MongoDB throws error code 11000, and `authServices.register` turns it into `AppError(409, "EMAIL_TAKEN")`.

## 4. See it working
Run the backend (`cd backend && npm run dev`) and the frontend (`cd frontend && npm run dev`).

```bash
# register
curl -s -X POST localhost:4000/api/auth/register -H "Content-Type: application/json" \
  -d '{"email":"you@test.com","password":"password123"}'
# expect: success true, user without passwordHash, a token

# me (paste the token)
curl -s localhost:4000/api/auth/me -H "Authorization: Bearer <token>"
# expect: { success: true, data: { user } }

# tests
cd backend && npm test      # expect 12 passed
```
In the browser at http://localhost:5173:
- Register, and you land on the dashboard with your email in the sidebar.
- Refresh, and you stay logged in.
- Click Log out, and you return to `/login`.

## 5. Break it on purpose
1. **Remove `JWT_SECRET` from `backend/.env`** and start the server. Expected: it refuses to start and names `JWT_SECRET`.
2. **Register the same email twice.** Expected: 409 `EMAIL_TAKEN`.
3. **Send a 3-character password.** Expected: 400 `VALIDATION_ERROR` with `details: [{ field: "password", ... }]`, and a red field message in the UI.
4. **Edit `forge_token` in browser devtools (Application, Local Storage) and refresh.** Expected: the server returns 401, the token is deleted, and you land on `/login`.
5. **Start Vite on a different port than `CORS_ORIGIN`** (for example remove `strictPort` and occupy 5173). Expected: the browser blocks the call and the UI shows "Cannot reach the server". The backend log shows nothing, because the browser never sends the real request.

## 6. Likely interview questions
1. **Why is `app.js` separate from `server.js`?** Tests import `app` and call it with supertest without opening a port or connecting to a real database. `server.js` only does startup.
2. **Why validate environment variables with Zod at startup?** A misconfigured server fails immediately with a clear message, not on the first request that needs the missing value.
3. **Why return the same error for a wrong email and a wrong password?** If the messages differed, an attacker could discover which emails are registered. `login` also compares against a dummy hash when the user does not exist, so the response time does not give it away either.
4. **How does JWT auth work here, and what are its weaknesses?** The server signs `{ sub: userId }` with a secret. `requireAuth` verifies the signature and expiry on every request and loads the user. The token is stateless, so it cannot be revoked before it expires, and in localStorage an XSS bug could steal it (see `docs/decisions/auth-storage.md`).
5. **Why does `AuthProvider` have a `loading` state?** On refresh, the app does not yet know whether the saved token is valid. Without `loading`, `ProtectedRoute` would see `user === null` and redirect a logged-in user to the login page for a moment.

## 7. Glossary
- **Middleware**: a function that runs on the request before the route handler, such as `helmet`, `validate` or `requireAuth`.
- **Zod**: a schema validation library. It parses and cleans input, and reports exactly which fields are wrong.
- **bcrypt**: a deliberately slow password hashing algorithm with a built-in salt.
- **JWT**: a signed token carrying claims (here, the user id as `sub`, plus an expiry). Anyone can read it, but only the server can create a valid one.
- **Rate limiting**: capping requests per client over a time window, to slow down password guessing.
- **CORS**: the browser rule that stops a page from one origin calling an API at another unless the API allows it.
- **Preflight**: the automatic `OPTIONS` request a browser sends before certain cross-origin requests, to ask if they are allowed.
- **Axios interceptor**: code that runs on every request or response, used here to add the token and to react to 401s.
- **React context**: a way to share state, such as the logged-in user, with any component below a provider, without passing props through every level.
- **`<Outlet />`**: the placeholder in a parent route where React Router renders the matching child route.
- **In-memory MongoDB**: a temporary database started by `mongodb-memory-server` so tests are isolated and never touch real data.
