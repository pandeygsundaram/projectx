# Auth API

## Register
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password123",
    "name": "John Doe"
  }'
```

**Response (201)**
```json
{
  "user": {
    "id": "uuid-here",
    "email": "user@example.com",
    "name": "John Doe"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

## Login
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password123"
  }'
```

**Response (200)**
```json
{
  "user": {
    "id": "uuid-here",
    "email": "user@example.com",
    "name": "John Doe"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

## Get Profile (Protected)
```bash
curl -X GET http://localhost:3000/api/auth/profile \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

**Response (200)**
```json
{
  "id": "uuid-here",
  "email": "user@example.com",
  "name": "John Doe",
  "createdAt": "2025-11-19T07:58:41.000Z"
}
```

## Errors

**401 Unauthorized**
```json
{ "error": "Invalid credentials" }
```

**409 Conflict (User exists)**
```json
{ "error": "User already exists" }
```

**403 Forbidden (Invalid token)**
```json
{ "error": "Invalid or expired token" }
```
