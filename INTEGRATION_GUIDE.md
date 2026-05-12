# SafeID Frontend-Backend Integration Guide

## Overview

This document describes the integration of the SafeID frontend (React) with the NestJS backend API.

## Project Structure

```
client/
├── App.jsx                    # Main app component with AuthProvider
├── SafeID.jsx                 # Main dashboard component
├── AuthForm.jsx               # Login/Signup form component
├── api/
│   └── apiClient.js           # API client with authentication
├── context/
│   └── AuthContext.jsx        # Authentication context and hooks
```

## Setup Instructions

### 1. Frontend Dependencies

Make sure you have React 18+ installed. The frontend uses:
- React hooks (`useState`, `useEffect`, `useContext`)
- Context API for state management
- Fetch API for HTTP requests

No additional packages are required beyond standard React.

### 2. Environment Variables

Create a `.env` file in the client directory:

```
REACT_APP_API_URL=http://localhost:3000/api/v1
```

**For production:**
```
REACT_APP_API_URL=https://your-api-domain.com/api/v1
```

### 3. Update Your Main Entry Point

Update your `index.jsx` or `main.jsx` to use the App component:

```jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
```

## Architecture

### Authentication Flow

```
User (Client)
    ↓
AuthForm (Login/Signup)
    ↓
AuthContext (useAuth hook)
    ↓
apiClient (Token management)
    ↓
Backend (JWT validation)
    ↓
Scan Results
```

### Component Hierarchy

```
App (AuthProvider wrapper)
└── SafeID (Main component)
    ├── AuthForm (If not authenticated)
    ├── Navbar (With user info & logout)
    └── Scan Dashboard (If authenticated)
```

## API Client (`api/apiClient.js`)

The API client handles all backend communication with built-in:
- Token management (localStorage)
- Authorization headers
- Error handling
- Request/response formatting

### Usage

```javascript
import { apiClient, authAPI, scanAPI } from './api/apiClient';

// Authentication
const response = await authAPI.login(email, password);
// Returns: { access_token, refresh_token, user }

const response = await authAPI.signup(email, password);
// Same response format as login

// Scanning
const result = await scanAPI.submitScan(email);
// Returns: { jobId, riskScore, classification, breaches, ... }

const history = await scanAPI.getHistory();
// Returns: [{ id, riskScore, classification, ... }]

const detail = await scanAPI.getScanDetail(jobId);
// Returns: { jobId, riskScore, classification, breachData, ... }
```

## Authentication Context (`context/AuthContext.jsx`)

Provides authentication state and methods via `useAuth()` hook.

### Hook Usage

```javascript
const { 
  user,                    // Current user object { id, email, ... }
  loading,                 // Loading state
  error,                   // Error message
  isAuthenticated,         // Boolean
  signup,                  // Async function
  login,                   // Async function
  logout,                  // Sync function
  clearError,              // Clear error message
} = useAuth();

// Example
try {
  await login(email, password);
  // User is now authenticated
} catch (err) {
  console.error('Login failed:', err);
}
```

## SafeID Component (`SafeID.jsx`)

The main dashboard component that:
1. Checks authentication via `useAuth()`
2. Shows `AuthForm` if not authenticated
3. Displays scan dashboard if authenticated
4. Calls `scanAPI.submitScan(email)` to check for breaches
5. Displays results with risk score and breach details

### Key Functions

- `handleSearch(e)`: Submits email for scan
- `handleLogout()`: Logs out user
- `formatBreachData(apiData)`: Formats API response for display

## Token Management

Tokens are automatically managed by the API client:

### Storage
- Access token: `localStorage.accessToken`
- Refresh token: `localStorage.refreshToken`

### Automatic Behavior
- Tokens are set after login/signup via `apiClient.setTokens()`
- Tokens are included in all API requests via Authorization header
- Tokens are cleared on logout via `apiClient.clearTokens()`
- If 401 is received, tokens are cleared and auth error event is dispatched

### Manual Token Access

```javascript
import { apiClient } from './api/apiClient';

const token = apiClient.accessToken;
const isAuth = apiClient.isAuthenticated();

// Clear tokens manually
apiClient.clearTokens();
```

## Error Handling

Errors are handled at multiple levels:

### API Client Level
```javascript
try {
  const data = await apiClient.get('/some-endpoint');
} catch (error) {
  console.error('API Error:', error.message);
}
```

### Auth Context Level
```javascript
const { error } = useAuth();
// Component automatically updates when auth error occurs
```

### Component Level
```javascript
const [error, setError] = useState("");
try {
  await scanAPI.submitScan(email);
} catch (err) {
  setError(err.message);
}
```

## Backend Integration Points

### Authentication Endpoints

#### POST /api/v1/auth/signup
Request:
```json
{
  "email": "user@example.com",
  "password": "secure-password"
}
```

Response:
```json
{
  "access_token": "eyJhbGc...",
  "refresh_token": "optional-refresh-token",
  "user": {
    "id": 1,
    "email": "user@example.com",
    "scanSnapshot": { /* optional */ },
    "scanSnapshotUpdatedAt": "2024-01-01T00:00:00Z"
  }
}
```

#### POST /api/v1/auth/login
Same request/response format as signup.

#### GET /api/v1/auth/me
Requires: `Authorization: Bearer {token}`

Response:
```json
{
  "user": { /* same as above */ }
}
```

### Scan Endpoints

#### POST /api/v1/scan
Requires: `Authorization: Bearer {token}`

Request:
```json
{
  "email": "user@example.com"
}
```

Response:
```json
{
  "jobId": "scan-123abc",
  "riskScore": 75,
  "classification": "CRITICAL",
  "breachesFound": 5,
  "breachData": "[{...breaches...}]", // JSON string
  "recommendation": "Take immediate action...",
  "isVerified": true,
  "processedAt": "2024-01-01T00:00:00Z"
}
```

#### GET /api/v1/scan/history
Requires: `Authorization: Bearer {token}`

Response:
```json
[
  {
    "id": "scan-123abc",
    "riskScore": 75,
    "classification": "CRITICAL",
    "breachesFound": 5,
    "createdAt": "2024-01-01T00:00:00Z"
  },
  // ... more scans
]
```

#### GET /api/v1/scan/:jobId
Requires: `Authorization: Bearer {token}`

Response: Same as POST /scan response

## Testing the Integration

### 1. Start the Backend
```bash
cd server
npm install
npm run dev
```

The backend should be running on `http://localhost:3000`

### 2. Start the Frontend
```bash
cd client
npm install
npm run dev
```

The frontend should be running on `http://localhost:3001`

### 3. Test the Flow

1. **Sign Up**
   - Click "Registre-se" on the login form
   - Enter email and password (8+ characters)
   - Submit
   - You should be logged in and see the dashboard

2. **Submit a Scan**
   - Enter an email address
   - Click "Verificar agora"
   - Wait for the scan to complete
   - View results with breach details

3. **Logout**
   - Click "Sair" in the navbar
   - You should be redirected to the login form
   - Tokens should be cleared

4. **Login Again**
   - Use the same credentials from signup
   - You should be logged in

### 4. Check Browser Console

Monitor the browser console (F12 → Console) for:
- API requests and responses
- Error messages
- State updates

### 5. Check Backend Logs

Monitor the backend logs for:
- Request processing
- Token validation
- Database operations

## CORS Configuration

The backend has CORS enabled for:
- Origin: `http://localhost:3001` (development)
- Methods: GET, POST, PUT, DELETE, PATCH, OPTIONS
- Credentials: true
- Headers: Content-Type, Authorization

For production, update `CORS_ORIGIN` environment variable on the backend.

## Troubleshooting

### "Unauthorized" Error After Login
- Check if tokens are being saved in localStorage
- Verify backend is running and accepting requests
- Check CORS configuration
- Check token expiration

### Login/Signup Fails
- Verify email format
- Password must be 8+ characters
- Email must not be already registered (signup)
- Check backend validation in auth service

### Scan Results Don't Appear
- Verify user is authenticated
- Check API_BASE_URL in apiClient.js
- Check backend scan service is running
- Verify breach data format in response

### Token Not Persisting
- Check localStorage in DevTools
- Verify `apiClient.setTokens()` is being called
- Check if localStorage is disabled in browser

## Security Notes

1. **Tokens in localStorage**
   - Accessible to JavaScript (XSS vulnerable)
   - Consider using httpOnly cookies for production
   - Implement token refresh mechanism

2. **HTTPS in Production**
   - Always use HTTPS for token transmission
   - Set secure flag on cookies
   - Enable HSTS headers

3. **Password Requirements**
   - Minimum 8 characters (enforced by backend)
   - Consider stronger requirements for production
   - Implement password strength meter

4. **Sensitive Data**
   - Email is shown to user
   - Breach data is encrypted in database
   - Never log passwords or tokens

## Next Steps

1. ✅ Set up frontend with API client
2. ✅ Implement authentication
3. ✅ Integrate scan functionality
4. Test end-to-end
5. Deploy to production
6. Monitor and maintain

## Support

For issues or questions:
1. Check this guide
2. Review error messages in browser console
3. Check backend logs
4. Verify environment configuration
5. Test with curl/Postman to isolate issues
