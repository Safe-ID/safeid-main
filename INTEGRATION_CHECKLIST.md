# SafeID Frontend Integration - Quick Setup Checklist

## Files Created/Modified

### New Files Created
- ✅ `client/api/apiClient.js` - API client with authentication
- ✅ `client/context/AuthContext.jsx` - Authentication state management
- ✅ `client/AuthForm.jsx` - Login/Signup component
- ✅ `client/App.jsx` - Root component with AuthProvider
- ✅ `INTEGRATION_GUIDE.md` - Complete integration documentation

### Modified Files
- ✅ `client/SafeID.jsx` - Updated to use real API and authentication

## Integration Checklist

### 1. Environment Setup
- [ ] Copy `.env.example` to `.env` in client directory
- [ ] Set `REACT_APP_API_URL=http://localhost:3000/api/v1` (development)
- [ ] Verify backend is running on port 3000

### 2. Install Dependencies
```bash
cd client
npm install
```

### 3. Update Entry Point
- [ ] Update your `main.jsx` or `index.jsx` to import and render `App` component
  ```jsx
  import App from './App.jsx'
  // Render App instead of SafeID
  ```

### 4. Start Services

**Backend:**
```bash
cd server
npm install
npm run dev
```

**Frontend:**
```bash
cd client
npm run dev
```

### 5. Test Authentication Flow
- [ ] Navigate to `http://localhost:3001`
- [ ] Test **Signup**
  - Enter new email and password (8+ chars)
  - Verify account is created
  - Verify auto-login works
- [ ] Test **Logout**
  - Click "Sair" button
  - Verify redirected to login form
  - Verify localStorage tokens are cleared
- [ ] Test **Login**
  - Use credentials from signup
  - Verify login works
  - Verify tokens are stored

### 6. Test Scan Functionality
- [ ] After login, enter email in search field
- [ ] Click "Verificar agora"
- [ ] Verify scan request is sent to backend
- [ ] Wait for scan result
- [ ] Verify breach data is displayed correctly
- [ ] Check browser console for API calls

### 7. Test Error Handling
- [ ] Try signup with invalid email (e.g., "noemail")
- [ ] Try signup with short password (< 8 chars)
- [ ] Try login with wrong credentials
- [ ] Verify error messages display correctly
- [ ] Try scan while disconnected from backend

### 8. Check Browser DevTools
- [ ] Open DevTools (F12)
- [ ] Go to **Application → Local Storage**
- [ ] Verify `accessToken` and `refreshToken` are stored after login
- [ ] Verify tokens are cleared after logout
- [ ] Check **Network** tab for API calls
- [ ] Verify requests have `Authorization: Bearer {token}` header

### 9. Backend Integration Verification
- [ ] Check backend logs show incoming requests
- [ ] Verify JWT validation is working
- [ ] Check database has new users created during signup
- [ ] Check scan history is being recorded

### 10. Production Preparation
- [ ] Set up environment variables for production API URL
- [ ] Implement HTTPS for all API calls
- [ ] Consider implementing refresh token rotation
- [ ] Add proper error logging/monitoring
- [ ] Test with actual backend deployment

## API Endpoints Tested

- [ ] POST `/api/v1/auth/signup` - Create new account
- [ ] POST `/api/v1/auth/login` - Login with email/password
- [ ] GET `/api/v1/auth/me` - Get current user profile
- [ ] POST `/api/v1/scan` - Submit email for scan
- [ ] GET `/api/v1/scan/history` - Get user's scan history
- [ ] GET `/api/v1/scan/:jobId` - Get scan details

## Troubleshooting During Setup

### Issue: "Cannot GET /api/v1/..."
- **Solution:** Verify backend is running on port 3000
- Run: `cd server && npm run dev`

### Issue: "CORS error"
- **Solution:** Verify CORS is enabled in backend
- Check `main.ts` has `app.enableCors()` configured
- Verify `CORS_ORIGIN=http://localhost:3001` in backend .env

### Issue: "Cannot read property 'isAuthenticated' of undefined"
- **Solution:** Wrap SafeID with AuthProvider in App.jsx
- Verify App.jsx imports AuthProvider correctly

### Issue: Tokens not persisting
- **Solution:** Check localStorage is enabled in browser
- Try disabling browser extensions
- Clear cache and reload

### Issue: "Unauthorized" error on scan
- **Solution:** Verify user is logged in
- Check tokens exist in localStorage
- Verify backend JWT secret matches

## Next Steps After Setup

1. **Customize UI** (if needed)
   - Colors in COLORS object
   - Form fields and validation
   - Error messages

2. **Enhance Features**
   - Add scan history page
   - Implement password reset
   - Add profile settings
   - Email notifications

3. **Security Improvements**
   - Implement refresh token rotation
   - Add rate limiting
   - Implement CSRF protection
   - Add password strength meter

4. **Performance**
   - Add caching for scan results
   - Implement pagination for history
   - Optimize bundle size
   - Add lazy loading

5. **Monitoring**
   - Add error tracking (Sentry, etc.)
   - Implement analytics
   - Monitor API performance
   - Track user behavior

## File Reference

| File | Purpose | Type |
|------|---------|------|
| `api/apiClient.js` | HTTP client & token management | Utility |
| `context/AuthContext.jsx` | Auth state & hooks | Context |
| `AuthForm.jsx` | Login/Signup UI | Component |
| `SafeID.jsx` | Main dashboard | Component |
| `App.jsx` | Root component | Component |
| `INTEGRATION_GUIDE.md` | Full documentation | Guide |

## Support & Questions

Refer to `INTEGRATION_GUIDE.md` for:
- Detailed architecture explanation
- API endpoint specifications
- Token management details
- Security recommendations
- Troubleshooting guide

## Completed ✅

- ✅ API client with authentication
- ✅ Authentication context and hooks
- ✅ Login/Signup form component
- ✅ Token persistence in localStorage
- ✅ Real API integration in SafeID component
- ✅ Error handling and loading states
- ✅ User profile display in navbar
- ✅ Logout functionality
- ✅ Comprehensive documentation
