import { createContext, useContext, useState, useEffect } from 'react';
import { authAPI, apiClient } from './apiClient';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Check if user is already logged in on mount
  useEffect(() => {
    const initAuth = async () => {
      if (apiClient.isAuthenticated()) {
        try {
          const profile = await authAPI.getProfile();
          setUser(profile.user);
          setIsAuthenticated(true);
        } catch (err) {
          console.error('Failed to fetch profile:', err);
          apiClient.clearTokens();
          setIsAuthenticated(false);
        }
      }
      setLoading(false);
    };

    initAuth();

    // Listen for auth errors (e.g., token expired)
    const handleAuthError = () => {
      setUser(null);
      setIsAuthenticated(false);
    };
    window.addEventListener('authError', handleAuthError);

    return () => window.removeEventListener('authError', handleAuthError);
  }, []);

  const signup = async (email, password) => {
    setLoading(true);
    setError(null);
    try {
      const response = await authAPI.signup(email, password);
      apiClient.setTokens(response.access_token, response.refresh_token);
      setUser(response.user);
      setIsAuthenticated(true);
      return response;
    } catch (err) {
      const message = err.message || 'Signup failed';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const login = async (email, password) => {
    setLoading(true);
    setError(null);
    try {
      const response = await authAPI.login(email, password);
      apiClient.setTokens(response.access_token, response.refresh_token);
      setUser(response.user);
      setIsAuthenticated(true);
      return response;
    } catch (err) {
      const message = err.message || 'Login failed';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    apiClient.clearTokens();
    setUser(null);
    setIsAuthenticated(false);
    setError(null);
  };

  const clearError = () => {
    setError(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        error,
        isAuthenticated,
        signup,
        login,
        logout,
        clearError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
